import * as THREE from "three";
import {
  createExtendedCanopyTexture,
  createExtendedHeightTexture,
  type TerrainSummaryField,
} from "../clod/terrain_summary.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { PostProcessSettings } from "../environment/postprocess.js";
import {
  parsePostFxFroxelDebugMode,
  type PostFxAtmosphereSettings,
  type PostFxFroxelDebugMode,
} from "./postfx_atmosphere.js";
import { createHillaireFroxelAerialNode } from "./postfx_atmosphere_nodes.js";
import { createPostFxCloudShadowTexture, type PostFxCloudShadowTexture } from "./postfx_cloud_shadow.js";
import { PostFxFroxelVolume, type PostFxFroxelVolumeTerrainInput } from "./postfx_froxel_volume.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";
import type { WebGPURenderer } from "three/webgpu";

export interface WebGpuPostProcessPipelineOptions {
  froxelTerrainSummary?: TerrainSummaryField | null;
  froxelTerrainRadiusMeters?: number;
  froxelHydrologyTexture?: THREE.Texture | null;
  froxelHydrologyWorldSizeMeters?: number;
}

type MatrixUniform = { value: THREE.Matrix4 };
type VectorUniform = { value: THREE.Vector3 };

/** Owns froxel volume lifecycle and terrain / cloud-shadow bind resources. */
export class WebGpuPostProcessFroxels {
  private froxelVolume: PostFxFroxelVolume | null = null;
  private froxelTerrainInput: PostFxFroxelVolumeTerrainInput | null = null;
  private froxelCloudShadow: PostFxCloudShadowTexture | null = null;
  froxelDebugMode: PostFxFroxelDebugMode;

  constructor(
    private readonly atmosphere: PostFxAtmosphereSettings,
    private readonly options: WebGpuPostProcessPipelineOptions,
    debugQueryValue: string | null,
  ) {
    this.froxelDebugMode = parsePostFxFroxelDebugMode(debugQueryValue);
  }

  /**
   * The debug branch is baked into the TSL graph, so a change here must land before `graphKey()` is
   * re-read (the caller then rebuilds the pipeline). Callers that never mention the froxel debug
   * fields keep whatever the URL asked for.
   */
  applyDebugSettings(settings: Partial<PostProcessSettings>, fallback: Required<PostProcessSettings>): void {
    if (settings.froxelDebugEnabled === undefined && settings.froxelDebugMode === undefined) return;
    const enabled = settings.froxelDebugEnabled ?? fallback.froxelDebugEnabled ?? false;
    const mode = settings.froxelDebugMode ?? fallback.froxelDebugMode ?? "off";
    this.froxelDebugMode = enabled ? mode : "off";
  }

  shouldUse(effectiveFroxelsEnabled: boolean): boolean {
    return effectiveFroxelsEnabled || this.froxelDebugMode !== "off";
  }

  maybeCreateAtStartup(effectiveFroxelsEnabled: boolean): void {
    if (!this.shouldUse(effectiveFroxelsEnabled)) return;
    this.froxelVolume = new PostFxFroxelVolume(this.atmosphere, { terrain: this.ensureTerrainInput() });
  }

  update(
    renderer: WebGPURenderer,
    camera: THREE.Camera,
    sunDirection: THREE.Vector3,
    lighting: EnvironmentLighting | null,
    effectiveFroxelsEnabled: boolean,
    onCreated: () => void,
  ): void {
    if (!this.shouldUse(effectiveFroxelsEnabled)) return;
    if (!this.froxelVolume) {
      this.froxelVolume = new PostFxFroxelVolume(this.atmosphere, { terrain: this.ensureTerrainInput() });
      onCreated();
    }
    this.froxelVolume.update(renderer, camera, sunDirection, lighting);
  }

  createAerialNode(input: {
    sourceRgb: TslAny;
    depthTex: TslAny;
    projectionInverse: MatrixUniform;
    cameraWorld: MatrixUniform;
    cameraPosition: VectorUniform;
    sunDirection: VectorUniform;
    aerialPerspectiveEnabled: boolean;
    aerialStageEnabled: boolean;
    effectiveFroxelsEnabled: boolean;
  }): TslAny {
    const hillaireEnabled = this.atmosphere.hillaire.enabled
      && input.aerialPerspectiveEnabled
      && input.aerialStageEnabled;
    return createHillaireFroxelAerialNode({
      sourceRgb: input.sourceRgb,
      depthTex: input.depthTex,
      projectionInverse: input.projectionInverse as unknown as TslAny,
      cameraWorld: input.cameraWorld as unknown as TslAny,
      cameraPosition: input.cameraPosition as unknown as TslAny,
      sunDirection: input.sunDirection as unknown as TslAny,
      settings: {
        hillaire: {
          ...this.atmosphere.hillaire,
          enabled: hillaireEnabled,
        },
        froxels: {
          ...this.atmosphere.froxels,
          enabled: input.effectiveFroxelsEnabled || this.froxelDebugMode !== "off",
        },
      },
      froxelDebugMode: this.froxelDebugMode,
      froxelVolume: this.froxelVolume?.nodeInput() ?? null,
    });
  }

  dispose(): void {
    this.froxelVolume?.dispose();
    this.froxelVolume = null;
    this.disposeTerrainInput();
    this.disposeCloudShadow();
  }

  private ensureTerrainInput(): PostFxFroxelVolumeTerrainInput | null {
    if (this.froxelTerrainInput) return this.froxelTerrainInput;
    const summary = this.options.froxelTerrainSummary;
    if (!summary) return null;
    const radius = Math.max(1, this.options.froxelTerrainRadiusMeters ?? summary.worldSize);
    const origin = summary.worldSize / 2 - radius;
    const cloudShadow = this.ensureCloudShadow(summary.worldSize);
    this.froxelTerrainInput = {
      heightTexture: createExtendedHeightTexture(summary, radius),
      canopyTexture: createExtendedCanopyTexture(summary, radius, 42),
      hydrologyTexture: this.options.froxelHydrologyTexture ?? null,
      cloudShadowTexture: cloudShadow.texture,
      originX: origin,
      originZ: origin,
      extentMeters: radius * 2,
      hydrologyWorldSizeMeters: this.options.froxelHydrologyWorldSizeMeters ?? summary.worldSize,
      cloudShadowWorldSizeMeters: cloudShadow.worldSizeMeters,
      cloudShadowStrength: cloudShadow.strength,
    };
    return this.froxelTerrainInput;
  }

  private ensureCloudShadow(worldSizeMeters: number): PostFxCloudShadowTexture {
    if (this.froxelCloudShadow) return this.froxelCloudShadow;
    this.froxelCloudShadow = createPostFxCloudShadowTexture({
      worldSizeMeters: Math.max(1, worldSizeMeters),
      resolution: 256,
      strength: 0.55,
      seed: 17,
    });
    return this.froxelCloudShadow;
  }

  private disposeTerrainInput(): void {
    this.froxelTerrainInput?.heightTexture.dispose();
    this.froxelTerrainInput?.canopyTexture?.dispose();
    this.froxelTerrainInput = null;
  }

  private disposeCloudShadow(): void {
    this.froxelCloudShadow?.texture.dispose();
    this.froxelCloudShadow = null;
  }
}
