import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import {
  mrt,
  output,
  pass,
  screenUV,
  uniform,
  vec4,
} from "three/tsl";
import {
  createExtendedCanopyTexture,
  createExtendedHeightTexture,
  type TerrainSummaryField,
} from "../clod/terrain_summary.js";
import { tagGpu } from "../core/gpu_profiler.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  godRaysHalfResSamples,
  toneMappingModeToThree,
  type GodRaysMode,
  type PostProcessSettings,
} from "../environment/postprocess.js";
import { buildDustGodRays, projectSunToScreen, sunScreenFade } from "./god_rays_screen.js";
import {
  DEFAULT_POSTFX_ATMOSPHERE,
  parsePostFxFroxelDebugMode,
  type PostFxAtmosphereSettings,
  type PostFxFroxelDebugMode,
} from "./postfx_atmosphere.js";
import { createHillaireFroxelAerialNode } from "./postfx_atmosphere_nodes.js";
import {
  DEFAULT_POSTFX_AUTO_EXPOSURE,
} from "./postfx_auto_exposure.js";
import {
  DEFAULT_POSTFX_BOUNCE,
  type PostFxBounceSettings,
} from "./postfx_bounce.js";
import {
  DEFAULT_POSTFX_CLOUDS,
  type PostFxCloudSettings,
} from "./postfx_clouds.js";
import {
  createVolumetricCloudCompositeNode,
  createVolumetricCloudLayerNode,
} from "./postfx_cloud_nodes.js";
import {
  DEFAULT_POSTFX_COLOR_SCRIPT,
  DEFAULT_POSTFX_GRADE,
  gradeForLighting,
  type PostFxColorScript,
  type PostFxGradeParams,
} from "./postfx_color_script.js";
import {
  DEFAULT_POSTFX_GTAO,
  type PostFxGtaoSettings,
} from "./postfx_gtao.js";
import { createPostFxCloudShadowTexture, type PostFxCloudShadowTexture } from "./postfx_cloud_shadow.js";
import { PostFxFroxelVolume, type PostFxFroxelVolumeTerrainInput } from "./postfx_froxel_volume.js";
import { PostFxHillaireLuts } from "./postfx_hillaire_luts.js";
import {
  parsePostFxStageFlags,
  stageAllowed,
  type PostFxStage,
  type PostFxStageFlags,
} from "./postfx_stage_flags.js";
import {
  POSTFX_GRAPH_STAGES,
  queryFlag,
  queryValue,
  searchParams,
  webGpuPostProcessGraphKey,
  withPostProcessDefaults,
} from "./webgpu_postprocess_config.js";
import {
  createBounceCompositeNode,
  createBounceHalfResLayerNode,
  createBouncePostProcessNode,
  createContactShadowPostProcessNode,
  createGradePostProcessNode,
  createGtaoBilateralUpsampleNode,
  createGtaoHalfResLayerNode,
  createGtaoPostProcessNode,
  createTraaPostProcessNode,
  type TslAny,
} from "./webgpu_postprocess_nodes.js";
import { HalfResMrtNode, type HalfResEntry } from "./postfx_half_res_mrt.js";
import {
  convertVisibleTerrainMeshesToNonIndexed,
  isSetIndexBufferError,
} from "./webgpu_terrain_fallback.js";
import { WebGpuAutoExposureMeter } from "./webgpu_auto_exposure.js";

const WEBGPU_POST_EXPOSURE = 1.0;
const DEFAULT_ALPHA = 1.0;

const NEUTRAL_GRADE: PostFxGradeParams = {
  whiteBalance: [1.0, 1.0, 1.0],
  shadowTint: [1.0, 1.0, 1.0],
  shadowAmount: 0.0,
  highlightTint: [1.0, 1.0, 1.0],
  highlightAmount: 0.0,
  saturation: 1.0,
  contrast: 1.0,
};

type NumericUniform = { value: number };
type MatrixUniform = { value: THREE.Matrix4 };
type VectorUniform = { value: THREE.Vector3 };
type Vector2Uniform = { value: THREE.Vector2 };

export { postProcessOutputGraphDirty } from "./webgpu_postprocess_config.js";

export interface WebGpuPostProcessPipelineOptions {
  froxelTerrainSummary?: TerrainSummaryField | null;
  froxelTerrainRadiusMeters?: number;
  froxelHydrologyTexture?: THREE.Texture | null;
  froxelHydrologyWorldSizeMeters?: number;
}

function reportPostProcessError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[webgpu-post] render pipeline failed", error);
  if (window.__drusnielClod) window.__drusnielClod.error = `WebGPU post-process failed: ${message}`;
}

export class WebGpuPostProcessPipeline {
  private settings: Required<PostProcessSettings>;
  private pipeline: RenderPipeline | null = null;
  private pipelineKey = "";
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private firstCameraSync = true;
  private lightingErrorReported = false;
  private froxelVolume: PostFxFroxelVolume | null = null;
  private halfResPass: HalfResMrtNode | null = null;
  private froxelTerrainInput: PostFxFroxelVolumeTerrainInput | null = null;
  private froxelCloudShadow: PostFxCloudShadowTexture | null = null;
  private hillaireLuts: PostFxHillaireLuts | null = null;
  private readonly autoExposureMeter: WebGpuAutoExposureMeter;
  private readonly projectionInverse = new THREE.Matrix4();
  private readonly colorScript: PostFxColorScript = DEFAULT_POSTFX_COLOR_SCRIPT;
  private readonly atmosphere: PostFxAtmosphereSettings = DEFAULT_POSTFX_ATMOSPHERE;
  private readonly bounce: PostFxBounceSettings = DEFAULT_POSTFX_BOUNCE;
  private readonly clouds: PostFxCloudSettings = DEFAULT_POSTFX_CLOUDS;
  private readonly gtao: PostFxGtaoSettings = DEFAULT_POSTFX_GTAO;
  private readonly stageFlags: PostFxStageFlags;
  private bounceEnabled = false;
  private cloudsEnabled = false;
  private froxelsEnabled = false;
  private froxelDebugMode: PostFxFroxelDebugMode;
  private gtaoEnabled = false;
  private qaDiagnosticBuffer: "final" | "depth" = "final";
  private readonly halfResEnabled: boolean;
  private readonly godRaysFullRes: boolean;
  private readonly uExposure = uniform(WEBGPU_POST_EXPOSURE) as unknown as NumericUniform;
  private readonly uContrast = uniform(1.0) as unknown as NumericUniform;
  private readonly uSaturation = uniform(1.0) as unknown as NumericUniform;
  private readonly uVignette = uniform(0.0) as unknown as NumericUniform;
  private readonly uOpacity = uniform(1.0) as unknown as NumericUniform;
  private readonly uWhiteBalance = uniform(new THREE.Vector3(1.0, 1.0, 1.0)) as unknown as VectorUniform;
  private readonly uShadowTint = uniform(new THREE.Vector3(1.0, 1.0, 1.0)) as unknown as VectorUniform;
  private readonly uHighlightTint = uniform(new THREE.Vector3(1.0, 1.0, 1.0)) as unknown as VectorUniform;
  private readonly uShadowAmount = uniform(0.0) as unknown as NumericUniform;
  private readonly uHighlightAmount = uniform(0.0) as unknown as NumericUniform;
  private readonly uSunDirection = uniform(new THREE.Vector3(0.0, 1.0, 0.0)) as unknown as VectorUniform;
  private readonly uContactStrength = uniform(0.0) as unknown as NumericUniform;
  private readonly uContactRadius = uniform(1.7) as unknown as NumericUniform;
  private readonly uContactDepthBias = uniform(0.05) as unknown as NumericUniform;
  private readonly uBounceStrength = uniform(0.0) as unknown as NumericUniform;
  private readonly uBounceRadius = uniform(0.55) as unknown as NumericUniform;
  private readonly uBounceMaxDistance = uniform(180.0) as unknown as NumericUniform;
  private readonly uBounceDepthTolerance = uniform(1.8) as unknown as NumericUniform;
  private readonly uBounceMinUvRadius = uniform(0.004) as unknown as NumericUniform;
  private readonly uBounceMaxUvRadius = uniform(0.07) as unknown as NumericUniform;
  private readonly uGtaoStrength = uniform(0.0) as unknown as NumericUniform;
  private readonly uGtaoRadius = uniform(1.6) as unknown as NumericUniform;
  private readonly uGtaoMaxDistance = uniform(700.0) as unknown as NumericUniform;
  private readonly uGtaoFadeEnd = uniform(1800.0) as unknown as NumericUniform;
  private readonly uGtaoDepthBias = uniform(0.05) as unknown as NumericUniform;
  private readonly uGtaoDepthTolerance = uniform(1.2) as unknown as NumericUniform;
  private readonly uGtaoMinUvRadius = uniform(0.002) as unknown as NumericUniform;
  private readonly uGtaoMaxUvRadius = uniform(0.035) as unknown as NumericUniform;
  private readonly uProjectionInverse = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uCameraWorld = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uCameraPosition = uniform(new THREE.Vector3()) as unknown as VectorUniform;
  private readonly uProjection = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uView = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uPrevView = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uPrevProjection = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uSunScreenUv = uniform(new THREE.Vector2(0.5, 0.5)) as unknown as Vector2Uniform;
  private readonly uGodRaysIntensity = uniform(0.0) as unknown as NumericUniform;
  private readonly uGodRaysDensity = uniform(0.96) as unknown as NumericUniform;
  private readonly uGodRaysDecay = uniform(0.92) as unknown as NumericUniform;
  private readonly uGodRaysWeight = uniform(0.35) as unknown as NumericUniform;
  private readonly uGodRaysExposure = uniform(0.6) as unknown as NumericUniform;
  private readonly uGodRaysDustStrength = uniform(0.55) as unknown as NumericUniform;
  private readonly uGodRaysDustScale = uniform(6.0) as unknown as NumericUniform;
  private readonly uGodRaysDustSpeed = uniform(0.05) as unknown as NumericUniform;
  private readonly uGodRaysTint = uniform(new THREE.Vector3(1.0, 1.0, 1.0)) as unknown as VectorUniform;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
    private readonly getLighting: (() => EnvironmentLighting) | null = null,
    private readonly options: WebGpuPostProcessPipelineOptions = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.settings = withPostProcessDefaults(settings);
    this.stageFlags = parsePostFxStageFlags(searchParams() ?? "");
    this.syncStageSettings();
    this.autoExposureMeter = new WebGpuAutoExposureMeter(
      this.renderer,
      DEFAULT_POSTFX_AUTO_EXPOSURE,
      this.stageEnabled("autoExposure") && queryFlag(["autoExposure", "autoexposure"], DEFAULT_POSTFX_AUTO_EXPOSURE.enabled),
      queryFlag(["lockexp", "lockExposure", "lockexposure"], DEFAULT_POSTFX_AUTO_EXPOSURE.lock),
    );
    this.froxelDebugMode = parsePostFxFroxelDebugMode(queryValue(["froxelDebug", "froxelsDebug", "volumetricDebug", "volumetricsDebug"]));
    this.applyFroxelDebugSettings(settings);
    this.halfResEnabled = queryFlag(["halfres", "halfResScreenSpace", "halfresscreenspace"], true);
    this.godRaysFullRes = queryFlag(["godraysFullres", "godraysfullres", "godRaysFullres"], false);
    if (this.shouldUseFroxelVolume()) {
      this.froxelVolume = new PostFxFroxelVolume(this.atmosphere, { terrain: this.ensureFroxelTerrainInput() });
    }
    this.applyRendererSettings();
    this.updateUniforms();
  }

  setSize(_width?: number, _height?: number): void {
    // RenderPipeline tracks the renderer size; the method preserves AppPostProcess parity.
  }

  setQaDiagnosticBuffer(kind: "final" | "depth"): void {
    if (this.qaDiagnosticBuffer === kind) return;
    this.qaDiagnosticBuffer = kind;
    this.disposePipeline();
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const previousKey = this.graphKey();
    this.settings = withPostProcessDefaults({ ...this.settings, ...settings });
    this.syncStageSettings();
    this.applyFroxelDebugSettings(settings);
    this.applyRendererSettings();
    this.updateUniforms();
    const nextKey = this.graphKey();
    if (nextKey !== previousKey) this.disposePipeline();
  }

  /**
   * The debug branch is baked into the TSL graph, so a change here must land before `graphKey()` is
   * re-read (the caller then rebuilds the pipeline). Callers that never mention the froxel debug
   * fields keep whatever the URL asked for.
   */
  private applyFroxelDebugSettings(settings: Partial<PostProcessSettings>): void {
    if (settings.froxelDebugEnabled === undefined && settings.froxelDebugMode === undefined) return;
    const enabled = settings.froxelDebugEnabled ?? this.settings.froxelDebugEnabled ?? false;
    const mode = settings.froxelDebugMode ?? this.settings.froxelDebugMode ?? "off";
    this.froxelDebugMode = enabled ? mode : "off";
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (scene !== this.scene || camera !== this.camera) {
      this.scene = scene;
      this.camera = camera;
      this.firstCameraSync = true;
      this.disposePipeline();
    }

    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.firstCameraSync = true;
      this.renderSceneDirect(scene, camera);
      return;
    }

    this.updateColorScriptUniforms();
    this.syncCameraUniforms(camera);
    this.updateGodRaysUniforms(camera);
    this.updateFroxelVolume(camera);
    const pipeline = this.ensurePipeline(scene, camera);
    try {
      pipeline.render();
      this.meterExposure();
    } catch (error) {
      if (!isSetIndexBufferError(error)) {
        reportPostProcessError(error);
        throw error;
      }
      const converted = convertVisibleTerrainMeshesToNonIndexed(scene);
      if (converted <= 0) throw error;
      console.warn(`[webgpu-post] converted ${converted} indexed terrain mesh(es) to non-indexed geometry after setIndexBuffer failure`);
      pipeline.render();
      this.meterExposure();
    }
  }

  dispose(): void {
    this.disposePipeline();
    this.froxelVolume?.dispose();
    this.froxelVolume = null;
    this.disposeFroxelTerrainInput();
    this.disposeFroxelCloudShadow();
    this.hillaireLuts?.dispose();
    this.hillaireLuts = null;
  }

  private graphKey(): string {
    return [
      webGpuPostProcessGraphKey(this.settings),
      this.stageFlags.postMin ? "postmin" : "postfull",
      this.stageKey(),
      this.bounceEnabled ? "bounce" : "no-bounce",
      this.shouldRunClouds() ? "clouds" : "no-clouds",
      this.effectiveFroxelsEnabled() ? "froxels" : "no-froxels",
      `froxel-debug-${this.froxelDebugMode}`,
      `qa-buffer-${this.qaDiagnosticBuffer}`,
      this.gtaoEnabled ? "gtao" : "no-gtao",
      this.halfResEnabled ? "halfres" : "fullres",
      `godrays-${this.godRaysMode()}${this.godRaysFullRes ? "-fullres" : ""}`,
    ].join("|");
  }

  private stageKey(): string {
    return POSTFX_GRAPH_STAGES
      .map((stage) => `${this.stageEnabled(stage) ? "" : "no-"}${stage}`)
      .join("|");
  }

  private stageEnabled(stage: PostFxStage): boolean {
    return stageAllowed(this.stageFlags, stage);
  }

  private syncStageSettings(): void {
    this.bounceEnabled = this.stageEnabled("bounce") && this.settings.bounceEnabled;
    this.cloudsEnabled = this.stageEnabled("clouds") && this.settings.cloudsEnabled;
    this.froxelsEnabled = this.stageEnabled("froxels") && this.settings.froxelsEnabled;
    this.gtaoEnabled = this.stageEnabled("gtao") && this.settings.gtaoEnabled;
  }

  private shouldRunClouds(): boolean {
    return this.cloudsEnabled && this.settings.cloudsEnabled && this.stageEnabled("clouds");
  }

  private godRaysMode(): GodRaysMode {
    return this.stageEnabled("godrays") ? this.settings.godRaysMode : "off";
  }

  private godRaysSamples(): number {
    return godRaysHalfResSamples(this.godRaysMode());
  }

  private godRaysEnabled(): boolean {
    return this.godRaysSamples() > 0;
  }

  /** `volumetric` god rays force the froxel fog layer on as the ambience under the shafts. */
  private effectiveFroxelsEnabled(): boolean {
    return this.froxelsEnabled
      || (this.stageEnabled("froxels") && this.godRaysMode() === "volumetric");
  }

  private shouldUseFroxelVolume(): boolean {
    return this.effectiveFroxelsEnabled() || this.froxelDebugMode !== "off";
  }

  private updateFroxelVolume(camera: THREE.Camera): void {
    if (!this.shouldUseFroxelVolume()) return;
    if (!this.froxelVolume) {
      this.froxelVolume = new PostFxFroxelVolume(this.atmosphere, { terrain: this.ensureFroxelTerrainInput() });
      this.disposePipeline();
    }
    this.froxelVolume.update(this.renderer, camera, this.uSunDirection.value, this.resolveLighting());
  }

  private ensureFroxelTerrainInput(): PostFxFroxelVolumeTerrainInput | null {
    if (this.froxelTerrainInput) return this.froxelTerrainInput;
    const summary = this.options.froxelTerrainSummary;
    if (!summary) return null;
    const radius = Math.max(1, this.options.froxelTerrainRadiusMeters ?? summary.worldSize);
    const origin = summary.worldSize / 2 - radius;
    const cloudShadow = this.ensureFroxelCloudShadow(summary.worldSize);
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

  private ensureFroxelCloudShadow(worldSizeMeters: number): PostFxCloudShadowTexture {
    if (this.froxelCloudShadow) return this.froxelCloudShadow;
    this.froxelCloudShadow = createPostFxCloudShadowTexture({
      worldSizeMeters: Math.max(1, worldSizeMeters),
      resolution: 256,
      strength: 0.55,
      seed: 17,
    });
    return this.froxelCloudShadow;
  }

  private disposeFroxelTerrainInput(): void {
    this.froxelTerrainInput?.heightTexture.dispose();
    this.froxelTerrainInput?.canopyTexture?.dispose();
    this.froxelTerrainInput = null;
  }

  private disposeFroxelCloudShadow(): void {
    this.froxelCloudShadow?.texture.dispose();
    this.froxelCloudShadow = null;
  }

  private applyRendererSettings(): void {
    this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
    (this.renderer as unknown as { toneMappingExposure?: number }).toneMappingExposure = WEBGPU_POST_EXPOSURE;
  }

  private updateUniforms(): void {
    this.uExposure.value = this.settings.exposure;
    this.uVignette.value = this.settings.vignette;
    this.uOpacity.value = this.settings.opacity;
    this.uContactStrength.value = this.settings.contactShadowsEnabled && this.stageEnabled("contact") ? this.settings.contactShadowsStrength : 0;
    this.uContactRadius.value = Math.max(0.01, this.settings.contactShadowsRadiusPx);
    this.uContactDepthBias.value = Math.max(0.0001, this.settings.contactShadowsDepthBias);
    this.uBounceStrength.value = this.bounceEnabled ? this.bounce.strength : 0;
    this.uBounceRadius.value = this.bounce.radiusMeters;
    this.uBounceMaxDistance.value = this.bounce.maxDistanceMeters;
    this.uBounceDepthTolerance.value = this.bounce.depthToleranceMeters;
    this.uBounceMinUvRadius.value = this.bounce.minUvRadius;
    this.uBounceMaxUvRadius.value = this.bounce.maxUvRadius;
    this.uGtaoStrength.value = this.gtaoEnabled ? this.gtao.strength : 0;
    this.uGtaoRadius.value = this.gtao.radiusMeters;
    this.uGtaoMaxDistance.value = this.gtao.maxDistanceMeters;
    this.uGtaoFadeEnd.value = this.gtao.fadeEndMeters;
    this.uGtaoDepthBias.value = this.gtao.depthBiasMeters;
    this.uGtaoDepthTolerance.value = this.gtao.depthToleranceMeters;
    this.uGtaoMinUvRadius.value = this.gtao.minUvRadius;
    this.uGtaoMaxUvRadius.value = this.gtao.maxUvRadius;
    this.uGodRaysDensity.value = this.settings.godRaysDensity;
    this.uGodRaysDecay.value = this.settings.godRaysDecay;
    this.uGodRaysWeight.value = this.settings.godRaysWeight;
    this.uGodRaysExposure.value = this.settings.godRaysExposure;
    this.uGodRaysDustStrength.value = this.settings.godRaysDustStrength;
    this.uGodRaysDustScale.value = this.settings.godRaysDustScale;
    this.uGodRaysDustSpeed.value = this.settings.godRaysDustSpeed;
    this.updateColorScriptUniforms();
  }

  /**
   * Per-frame god-rays state: the sun's screen UV, the soft sun-behind/off-screen fade folded
   * into the intensity gain, and the transmittance tint from the live sun colour (warm at low
   * sun by construction — the shafts share the scene's atmosphere).
   */
  private updateGodRaysUniforms(camera: THREE.Camera): void {
    if (!this.godRaysEnabled()) {
      this.uGodRaysIntensity.value = 0;
      return;
    }
    const info = projectSunToScreen(this.uSunDirection.value, camera);
    this.uSunScreenUv.value.set(info.u, info.v);
    this.uGodRaysIntensity.value = sunScreenFade(info);
    const lighting = this.resolveLighting();
    if (lighting) {
      const sun = lighting.sunColor;
      const peak = Math.max(sun.r, sun.g, sun.b, 1e-4);
      this.uGodRaysTint.value.set(sun.r / peak, sun.g / peak, sun.b / peak);
    }
  }

  private updateColorScriptUniforms(): void {
    const lighting = this.resolveLighting();
    if (lighting) this.uSunDirection.value.copy(lighting.sunDirection).normalize();
    const grade = this.stageEnabled("colorScript")
      ? (lighting ? gradeForLighting(lighting, this.colorScript) : DEFAULT_POSTFX_GRADE)
      : NEUTRAL_GRADE;
    this.uContrast.value = this.settings.contrast * grade.contrast;
    this.uSaturation.value = this.settings.saturation * grade.saturation;
    this.uWhiteBalance.value.set(...grade.whiteBalance);
    this.uShadowTint.value.set(...grade.shadowTint);
    this.uHighlightTint.value.set(...grade.highlightTint);
    this.uShadowAmount.value = grade.shadowAmount;
    this.uHighlightAmount.value = grade.highlightAmount;
  }

  private resolveLighting(): EnvironmentLighting | null {
    if (!this.getLighting) return null;
    try {
      return this.getLighting();
    } catch (error) {
      if (!this.lightingErrorReported) {
        this.lightingErrorReported = true;
        console.warn("[webgpu-post] failed to read lighting for color script; using default grade", error);
      }
      return null;
    }
  }

  private ensurePipeline(scene: THREE.Scene, camera: THREE.Camera): RenderPipeline {
    const key = this.graphKey();
    if (this.pipeline && this.pipelineKey === key) return this.pipeline;
    this.disposePipeline();
    this.pipeline = this.createPipeline(scene, camera);
    this.pipelineKey = key;
    return this.pipeline;
  }

  private createPipeline(scene: THREE.Scene, camera: THREE.Camera): RenderPipeline {
    const scenePass = pass(scene, camera, { samples: 0 });
    tagGpu(scenePass.renderTarget as object, "postfxScene");
    scenePass.setMRT(mrt({ output }));
    const beauty = scenePass.getTextureNode("output") as TslAny;
    const depthTex = scenePass.getTextureNode("depth") as TslAny;
    const pipeline = new RenderPipeline(this.renderer);
    if (this.qaDiagnosticBuffer === "depth") {
      const depth = depthTex.r;
      this.autoExposureMeter.clearKernel();
      pipeline.outputNode = vec4(depth, depth, depth, 1);
    } else if (this.settings.debugMode === "copy") {
      this.autoExposureMeter.clearKernel();
      pipeline.outputNode = beauty;
    } else {
      this.configureAutoExposure(beauty);
      pipeline.outputNode = this.createOutputNode(beauty, depthTex, camera);
    }
    return pipeline;
  }

  private createOutputNode(beauty: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    const shouldRunAerial = this.froxelDebugMode !== "off"
      || this.effectiveFroxelsEnabled()
      || (this.settings.aerialPerspectiveEnabled && this.stageEnabled("aerial"));
    const aerialRgb = shouldRunAerial
      ? this.createAerialNode(beauty.rgb, depthTex)
      : beauty.rgb;
    if (this.froxelDebugMode !== "off") return aerialRgb;
    const wantsHalfResGodRays = this.godRaysEnabled() && !this.godRaysFullRes;
    const wantsHalfRes = this.gtaoEnabled || this.bounceEnabled || this.shouldRunClouds() || wantsHalfResGodRays;
    const halfRes = this.halfResEnabled && wantsHalfRes
      ? this.buildHalfResPass(beauty, depthTex)
      : null;
    const cloudRgb = this.shouldRunClouds()
      ? this.createCloudCompositeNode(
          aerialRgb,
          halfRes?.cloudTex ?? this.createCloudLayerNode(depthTex),
        )
      : aerialRgb;
    const aoRgb = this.gtaoEnabled
      ? cloudRgb.mul(
          halfRes?.aoTex
            ? this.createGtaoUpsampleNode(halfRes.aoTex, beauty.rgb, depthTex)
            : this.createGtaoNode(cloudRgb, depthTex),
        )
      : cloudRgb;
    // Shafts are added in linear before TRAA so the temporal resolve smooths both the IGN
    // start jitter and the dust noise for free when TAA is enabled.
    const shaftRgb = this.godRaysEnabled()
      ? aoRgb.add(
          (halfRes?.godRaysTex
            ? halfRes.godRaysTex.rgb
            : this.createGodRaysLayerNode(beauty, depthTex)
          ).mul(this.uGodRaysTint as unknown as TslAny),
        )
      : aoRgb;
    const temporalColor = this.settings.taaEnabled && this.stageEnabled("taa")
      ? this.createTraaNode(shaftRgb, depthTex, camera)
      : vec4(shaftRgb, DEFAULT_ALPHA);
    const temporalRgb = (temporalColor as TslAny).rgb;
    const bloomRgb = this.settings.bloomEnabled && this.stageEnabled("bloom")
      ? temporalRgb.add((bloom(
          temporalColor,
          this.settings.bloomThreshold,
          this.settings.bloomStrength,
          this.settings.bloomRadius,
        ) as TslAny).rgb)
      : temporalRgb;
    const contactRgb = this.settings.contactShadowsEnabled && this.stageEnabled("contact")
      ? bloomRgb.mul(this.createContactShadowNode(depthTex))
      : bloomRgb;
    const bounceRgb = this.bounceEnabled
      ? (halfRes?.bounceTex
          ? createBounceCompositeNode({
              sourceRgb: contactRgb,
              bounceTex: halfRes.bounceTex,
              strength: this.uBounceStrength as unknown as TslAny,
            })
          : this.createBounceNode(contactRgb, beauty, depthTex))
      : contactRgb;
    return this.createGradeNode(beauty.rgb, bounceRgb);
  }

  private buildHalfResPass(beauty: TslAny, depthTex: TslAny): { aoTex: TslAny | null; bounceTex: TslAny | null; cloudTex: TslAny | null; godRaysTex: TslAny | null } {
    const entries: HalfResEntry[] = [];
    const wantsGodRays = this.godRaysEnabled() && !this.godRaysFullRes;
    if (this.shouldRunClouds()) {
      entries.push({
        name: "clouds",
        node: this.createCloudLayerNode(depthTex),
      });
    }
    if (wantsGodRays) {
      entries.push({
        name: "godrays",
        node: this.createGodRaysLayerNode(beauty, depthTex),
      });
    }
    if (this.gtaoEnabled) {
      entries.push({
        name: "ao",
        red: true,
        node: createGtaoHalfResLayerNode({
          depthTex,
          projectionInverse: this.uProjectionInverse as unknown as TslAny,
          strength: this.uGtaoStrength as unknown as TslAny,
          radius: this.uGtaoRadius as unknown as TslAny,
          fadeEnd: this.uGtaoFadeEnd as unknown as TslAny,
          depthBias: this.uGtaoDepthBias as unknown as TslAny,
          depthTolerance: this.uGtaoDepthTolerance as unknown as TslAny,
          minUvRadius: this.uGtaoMinUvRadius as unknown as TslAny,
          maxUvRadius: this.uGtaoMaxUvRadius as unknown as TslAny,
          samples: this.gtao.samples,
        }),
      });
    }
    if (this.bounceEnabled) {
      entries.push({
        name: "bounce",
        node: createBounceHalfResLayerNode({
          beauty,
          depthTex,
          projectionInverse: this.uProjectionInverse as unknown as TslAny,
          radius: this.uBounceRadius as unknown as TslAny,
          maxDistance: this.uBounceMaxDistance as unknown as TslAny,
          depthTolerance: this.uBounceDepthTolerance as unknown as TslAny,
          minUvRadius: this.uBounceMinUvRadius as unknown as TslAny,
          maxUvRadius: this.uBounceMaxUvRadius as unknown as TslAny,
          taps: this.bounce.taps,
        }),
      });
    }
    if (entries.length === 0) return { aoTex: null, bounceTex: null, cloudTex: null, godRaysTex: null };
    this.halfResPass = new HalfResMrtNode(entries);
    return {
      aoTex: this.gtaoEnabled ? (this.halfResPass.getTextureNode("ao") as unknown as TslAny) : null,
      bounceTex: this.bounceEnabled ? (this.halfResPass.getTextureNode("bounce") as unknown as TslAny) : null,
      cloudTex: this.shouldRunClouds() ? (this.halfResPass.getTextureNode("clouds") as unknown as TslAny) : null,
      godRaysTex: wantsGodRays ? (this.halfResPass.getTextureNode("godrays") as unknown as TslAny) : null,
    };
  }

  /**
   * The dust god-rays accumulation layer (pre-tint). Rendered at half res inside the shared MRT
   * pass by default; the same builder also serves the `?godraysFullres=1` A/B path at full res.
   */
  private createGodRaysLayerNode(beauty: TslAny, depthTex: TslAny): TslAny {
    return buildDustGodRays({
      sceneTex: beauty,
      depthTex,
      uvNode: screenUV,
      sunUv: this.uSunScreenUv as unknown as TslAny,
      intensity: this.uGodRaysIntensity as unknown as TslAny,
      density: this.uGodRaysDensity as unknown as TslAny,
      decay: this.uGodRaysDecay as unknown as TslAny,
      weight: this.uGodRaysWeight as unknown as TslAny,
      exposure: this.uGodRaysExposure as unknown as TslAny,
      samples: this.godRaysSamples(),
      dustStrength: this.uGodRaysDustStrength as unknown as TslAny,
      dustScale: this.uGodRaysDustScale as unknown as TslAny,
      dustSpeed: this.uGodRaysDustSpeed as unknown as TslAny,
    });
  }

  private createGtaoUpsampleNode(aoTex: TslAny, beautyRgb: TslAny, depthTex: TslAny): TslAny {
    return createGtaoBilateralUpsampleNode({
      aoTex,
      depthTex,
      beautyRgb,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      fadeStart: this.uGtaoMaxDistance as unknown as TslAny,
      fadeEnd: this.uGtaoFadeEnd as unknown as TslAny,
    });
  }

  private createAerialNode(sourceRgb: TslAny, depthTex: TslAny): TslAny {
    const hillaireEnabled = this.atmosphere.hillaire.enabled
      && this.settings.aerialPerspectiveEnabled
      && this.stageEnabled("aerial");
    return createHillaireFroxelAerialNode({
      sourceRgb,
      depthTex,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      cameraWorld: this.uCameraWorld as unknown as TslAny,
      cameraPosition: this.uCameraPosition as unknown as TslAny,
      sunDirection: this.uSunDirection as unknown as TslAny,
      settings: {
        hillaire: {
          ...this.atmosphere.hillaire,
          enabled: hillaireEnabled,
        },
        froxels: {
          ...this.atmosphere.froxels,
          enabled: this.effectiveFroxelsEnabled() || this.froxelDebugMode !== "off",
        },
      },
      froxelDebugMode: this.froxelDebugMode,
      froxelVolume: this.froxelVolume?.nodeInput() ?? null,
      hillaireLuts: hillaireEnabled ? this.ensureHillaireLuts().nodeInput() : null,
    });
  }

  private createCloudLayerNode(depthTex: TslAny): TslAny {
    return createVolumetricCloudLayerNode({
      depthTex,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      cameraWorld: this.uCameraWorld as unknown as TslAny,
      cameraPosition: this.uCameraPosition as unknown as TslAny,
      sunDirection: this.uSunDirection as unknown as TslAny,
      settings: this.clouds,
    });
  }

  private createCloudCompositeNode(sourceRgb: TslAny, cloudTex: TslAny): TslAny {
    return createVolumetricCloudCompositeNode({ sourceRgb, cloudTex });
  }

  private ensureHillaireLuts(): PostFxHillaireLuts {
    if (!this.hillaireLuts) this.hillaireLuts = new PostFxHillaireLuts(this.atmosphere.hillaire);
    return this.hillaireLuts;
  }

  private createTraaNode(sourceRgb: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    return createTraaPostProcessNode({
      sourceRgb,
      depthTex,
      camera,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      cameraWorld: this.uCameraWorld as unknown as TslAny,
      prevView: this.uPrevView as unknown as TslAny,
      prevProjection: this.uPrevProjection as unknown as TslAny,
    });
  }

  private createGtaoNode(sourceRgb: TslAny, depthTex: TslAny): TslAny {
    return createGtaoPostProcessNode({
      sourceRgb,
      depthTex,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      strength: this.uGtaoStrength as unknown as TslAny,
      radius: this.uGtaoRadius as unknown as TslAny,
      maxDistance: this.uGtaoMaxDistance as unknown as TslAny,
      fadeEnd: this.uGtaoFadeEnd as unknown as TslAny,
      depthBias: this.uGtaoDepthBias as unknown as TslAny,
      depthTolerance: this.uGtaoDepthTolerance as unknown as TslAny,
      minUvRadius: this.uGtaoMinUvRadius as unknown as TslAny,
      maxUvRadius: this.uGtaoMaxUvRadius as unknown as TslAny,
      samples: this.gtao.samples,
    });
  }

  private createContactShadowNode(depthTex: TslAny): TslAny {
    return createContactShadowPostProcessNode({
      depthTex,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      projection: this.uProjection as unknown as TslAny,
      view: this.uView as unknown as TslAny,
      sunDirection: this.uSunDirection as unknown as TslAny,
      strength: this.uContactStrength as unknown as TslAny,
      radius: this.uContactRadius as unknown as TslAny,
      depthBias: this.uContactDepthBias as unknown as TslAny,
    });
  }

  private createBounceNode(sourceRgb: TslAny, beauty: TslAny, depthTex: TslAny): TslAny {
    return createBouncePostProcessNode({
      sourceRgb,
      beauty,
      depthTex,
      projectionInverse: this.uProjectionInverse as unknown as TslAny,
      strength: this.uBounceStrength as unknown as TslAny,
      radius: this.uBounceRadius as unknown as TslAny,
      maxDistance: this.uBounceMaxDistance as unknown as TslAny,
      depthTolerance: this.uBounceDepthTolerance as unknown as TslAny,
      minUvRadius: this.uBounceMinUvRadius as unknown as TslAny,
      maxUvRadius: this.uBounceMaxUvRadius as unknown as TslAny,
      taps: this.bounce.taps,
    });
  }

  private createGradeNode(sourceRgb: TslAny, postRgb: TslAny): TslAny {
    return createGradePostProcessNode({
      sourceRgb,
      postRgb,
      autoExposure: this.autoExposureMeter.exposureNode,
      exposure: this.uExposure as unknown as TslAny,
      contrast: this.uContrast as unknown as TslAny,
      saturation: this.uSaturation as unknown as TslAny,
      vignette: this.uVignette as unknown as TslAny,
      opacity: this.uOpacity as unknown as TslAny,
      whiteBalance: this.uWhiteBalance as unknown as TslAny,
      shadowTint: this.uShadowTint as unknown as TslAny,
      shadowAmount: this.uShadowAmount as unknown as TslAny,
      highlightTint: this.uHighlightTint as unknown as TslAny,
      highlightAmount: this.uHighlightAmount as unknown as TslAny,
    });
  }

  private configureAutoExposure(beauty: TslAny): void {
    this.autoExposureMeter.configure(beauty);
  }

  private meterExposure(): void {
    this.autoExposureMeter.meter();
  }

  private syncCameraUniforms(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    const cameraWithInverse = camera as THREE.Camera & { projectionMatrixInverse?: THREE.Matrix4 };
    if (cameraWithInverse.projectionMatrixInverse) {
      this.projectionInverse.copy(cameraWithInverse.projectionMatrixInverse);
    } else {
      this.projectionInverse.copy(camera.projectionMatrix).invert();
    }

    this.uPrevView.value.copy(this.firstCameraSync ? camera.matrixWorldInverse : this.uView.value);
    this.uPrevProjection.value.copy(this.firstCameraSync ? camera.projectionMatrix : this.uProjection.value);
    this.firstCameraSync = false;
    this.uProjectionInverse.value.copy(this.projectionInverse);
    this.uCameraWorld.value.copy(camera.matrixWorld);
    this.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    this.uProjection.value.copy(camera.projectionMatrix);
    this.uView.value.copy(camera.matrixWorldInverse);
  }

  private renderSceneDirect(scene: THREE.Scene, camera: THREE.Camera): void {
    try {
      this.renderer.render(scene, camera);
    } catch (error) {
      if (!isSetIndexBufferError(error)) throw error;
      const converted = convertVisibleTerrainMeshesToNonIndexed(scene);
      if (converted <= 0) throw error;
      console.warn(`[webgpu] converted ${converted} indexed terrain mesh(es) to non-indexed geometry after setIndexBuffer failure`);
      this.renderer.render(scene, camera);
    }
  }

  private disposePipeline(): void {
    (this.pipeline as unknown as { dispose?: () => void } | null)?.dispose?.();
    this.pipeline = null;
    this.pipelineKey = "";
    this.autoExposureMeter.clearKernel();
    this.halfResPass?.dispose();
    this.halfResPass = null;
  }
}
