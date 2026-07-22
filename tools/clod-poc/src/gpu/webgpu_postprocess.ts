import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import {
  mrt,
  output,
  pass,
  uniform,
  vec4,
} from "three/tsl";
import { tagGpu } from "../core/gpu_profiler.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  godRaysHalfResSamples,
  toneMappingModeToThree,
  type GodRaysMode,
  type PostProcessSettings,
} from "../environment/postprocess.js";
import {
  DEFAULT_POSTFX_ATMOSPHERE,
  type PostFxAtmosphereSettings,
} from "./postfx_atmosphere.js";
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
  DEFAULT_POSTFX_GTAO,
  type PostFxGtaoSettings,
} from "./postfx_gtao.js";
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
import { WebGpuPostProcessExposure } from "./webgpu_postprocess_exposure.js";
import {
  WebGpuPostProcessFroxels,
  type WebGpuPostProcessPipelineOptions,
} from "./webgpu_postprocess_froxels.js";
import {
  WebGpuPostProcessGraphBuilder,
  updatePostProcessGodRaysUniforms,
  type WebGpuPostProcessGraphHost,
  type WebGpuPostProcessGraphUniforms,
} from "./webgpu_postprocess_graph.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";
import {
  convertVisibleTerrainMeshesToNonIndexed,
  isSetIndexBufferError,
} from "./webgpu_terrain_fallback.js";

const WEBGPU_POST_EXPOSURE = 1.0;

type NumericUniform = { value: number };
type MatrixUniform = { value: THREE.Matrix4 };
type VectorUniform = { value: THREE.Vector3 };
type Vector2Uniform = { value: THREE.Vector2 };

export { postProcessOutputGraphDirty } from "./webgpu_postprocess_config.js";
export type { WebGpuPostProcessPipelineOptions } from "./webgpu_postprocess_froxels.js";

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
  private readonly froxels: WebGpuPostProcessFroxels;
  private readonly exposure: WebGpuPostProcessExposure;
  private readonly graph: WebGpuPostProcessGraphBuilder;
  private readonly projectionInverse = new THREE.Matrix4();
  private readonly atmosphere: PostFxAtmosphereSettings = DEFAULT_POSTFX_ATMOSPHERE;
  private readonly bounce: PostFxBounceSettings = DEFAULT_POSTFX_BOUNCE;
  private readonly clouds: PostFxCloudSettings = DEFAULT_POSTFX_CLOUDS;
  private readonly gtao: PostFxGtaoSettings = DEFAULT_POSTFX_GTAO;
  private readonly stageFlags: PostFxStageFlags;
  private bounceEnabled = false;
  private cloudsEnabled = false;
  private froxelsEnabled = false;
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
    getLighting: (() => EnvironmentLighting) | null = null,
    options: WebGpuPostProcessPipelineOptions = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.settings = withPostProcessDefaults(settings);
    this.stageFlags = parsePostFxStageFlags(searchParams() ?? "");
    this.syncStageSettings();
    this.exposure = new WebGpuPostProcessExposure(
      this.renderer,
      this.stageEnabled("autoExposure") && queryFlag(["autoExposure", "autoexposure"], DEFAULT_POSTFX_AUTO_EXPOSURE.enabled),
      queryFlag(["lockexp", "lockExposure", "lockexposure"], DEFAULT_POSTFX_AUTO_EXPOSURE.lock),
      getLighting,
    );
    this.froxels = new WebGpuPostProcessFroxels(
      this.atmosphere,
      options,
      queryValue(["froxelDebug", "froxelsDebug", "volumetricDebug", "volumetricsDebug"]),
    );
    this.froxels.applyDebugSettings(settings, this.settings);
    this.halfResEnabled = queryFlag(["halfres", "halfResScreenSpace", "halfresscreenspace"], true);
    this.godRaysFullRes = queryFlag(["godraysFullres", "godraysfullres", "godRaysFullres"], false);
    this.froxels.maybeCreateAtStartup(this.effectiveFroxelsEnabled());
    this.graph = new WebGpuPostProcessGraphBuilder(
      this.asGraphHost(),
      this.graphUniforms(),
    );
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
    this.froxels.applyDebugSettings(settings, this.settings);
    this.applyRendererSettings();
    this.updateUniforms();
    const nextKey = this.graphKey();
    if (nextKey !== previousKey) this.disposePipeline();
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

    this.exposure.updateGradeUniforms(
      this.settings,
      {
        uSunDirection: this.uSunDirection,
        uContrast: this.uContrast,
        uSaturation: this.uSaturation,
        uWhiteBalance: this.uWhiteBalance,
        uShadowTint: this.uShadowTint,
        uHighlightTint: this.uHighlightTint,
        uShadowAmount: this.uShadowAmount,
        uHighlightAmount: this.uHighlightAmount,
      },
      this.stageEnabled("colorScript"),
    );
    this.syncCameraUniforms(camera);
    updatePostProcessGodRaysUniforms({
      enabled: this.godRaysEnabled(),
      camera,
      sunDirection: this.uSunDirection.value,
      lighting: this.exposure.resolveLighting(),
      uSunScreenUv: this.uSunScreenUv,
      uGodRaysIntensity: this.uGodRaysIntensity,
      uGodRaysTint: this.uGodRaysTint,
    });
    this.froxels.update(
      this.renderer,
      camera,
      this.uSunDirection.value,
      this.exposure.resolveLighting(),
      this.effectiveFroxelsEnabled(),
      () => this.disposePipeline(),
    );
    const pipeline = this.ensurePipeline(scene, camera);
    try {
      pipeline.render();
      this.exposure.meterFrame();
    } catch (error) {
      if (!isSetIndexBufferError(error)) {
        reportPostProcessError(error);
        throw error;
      }
      const converted = convertVisibleTerrainMeshesToNonIndexed(scene);
      if (converted <= 0) throw error;
      console.warn(`[webgpu-post] converted ${converted} indexed terrain mesh(es) to non-indexed geometry after setIndexBuffer failure`);
      pipeline.render();
      this.exposure.meterFrame();
    }
  }

  dispose(): void {
    this.disposePipeline();
    this.froxels.dispose();
  }

  private graphUniforms(): WebGpuPostProcessGraphUniforms {
    return {
      uExposure: this.uExposure,
      uContrast: this.uContrast,
      uSaturation: this.uSaturation,
      uVignette: this.uVignette,
      uOpacity: this.uOpacity,
      uWhiteBalance: this.uWhiteBalance,
      uShadowTint: this.uShadowTint,
      uHighlightTint: this.uHighlightTint,
      uShadowAmount: this.uShadowAmount,
      uHighlightAmount: this.uHighlightAmount,
      uSunDirection: this.uSunDirection,
      uContactStrength: this.uContactStrength,
      uContactRadius: this.uContactRadius,
      uContactDepthBias: this.uContactDepthBias,
      uBounceStrength: this.uBounceStrength,
      uBounceRadius: this.uBounceRadius,
      uBounceMaxDistance: this.uBounceMaxDistance,
      uBounceDepthTolerance: this.uBounceDepthTolerance,
      uBounceMinUvRadius: this.uBounceMinUvRadius,
      uBounceMaxUvRadius: this.uBounceMaxUvRadius,
      uGtaoStrength: this.uGtaoStrength,
      uGtaoRadius: this.uGtaoRadius,
      uGtaoMaxDistance: this.uGtaoMaxDistance,
      uGtaoFadeEnd: this.uGtaoFadeEnd,
      uGtaoDepthBias: this.uGtaoDepthBias,
      uGtaoDepthTolerance: this.uGtaoDepthTolerance,
      uGtaoMinUvRadius: this.uGtaoMinUvRadius,
      uGtaoMaxUvRadius: this.uGtaoMaxUvRadius,
      uProjectionInverse: this.uProjectionInverse,
      uCameraWorld: this.uCameraWorld,
      uCameraPosition: this.uCameraPosition,
      uProjection: this.uProjection,
      uView: this.uView,
      uPrevView: this.uPrevView,
      uPrevProjection: this.uPrevProjection,
      uSunScreenUv: this.uSunScreenUv,
      uGodRaysIntensity: this.uGodRaysIntensity,
      uGodRaysDensity: this.uGodRaysDensity,
      uGodRaysDecay: this.uGodRaysDecay,
      uGodRaysWeight: this.uGodRaysWeight,
      uGodRaysExposure: this.uGodRaysExposure,
      uGodRaysDustStrength: this.uGodRaysDustStrength,
      uGodRaysDustScale: this.uGodRaysDustScale,
      uGodRaysDustSpeed: this.uGodRaysDustSpeed,
      uGodRaysTint: this.uGodRaysTint,
    };
  }

  private asGraphHost(): WebGpuPostProcessGraphHost {
    const self = this;
    return {
      get settings() { return self.settings; },
      get bounce() { return self.bounce; },
      get clouds() { return self.clouds; },
      get gtao() { return self.gtao; },
      get bounceEnabled() { return self.bounceEnabled; },
      get gtaoEnabled() { return self.gtaoEnabled; },
      get halfResEnabled() { return self.halfResEnabled; },
      get godRaysFullRes() { return self.godRaysFullRes; },
      get froxelDebugMode() { return self.froxels.froxelDebugMode; },
      get exposureNode() { return self.exposure.exposureNode; },
      stageEnabled: (stage) => self.stageEnabled(stage),
      shouldRunClouds: () => self.shouldRunClouds(),
      godRaysEnabled: () => self.godRaysEnabled(),
      godRaysSamples: () => self.godRaysSamples(),
      effectiveFroxelsEnabled: () => self.effectiveFroxelsEnabled(),
      createAerialNode: (sourceRgb, depthTex) => self.createAerialNode(sourceRgb, depthTex),
    };
  }

  private graphKey(): string {
    return [
      webGpuPostProcessGraphKey(this.settings),
      this.stageFlags.postMin ? "postmin" : "postfull",
      this.stageKey(),
      this.bounceEnabled ? "bounce" : "no-bounce",
      this.shouldRunClouds() ? "clouds" : "no-clouds",
      this.effectiveFroxelsEnabled() ? "froxels" : "no-froxels",
      `froxel-debug-${this.froxels.froxelDebugMode}`,
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

  private createAerialNode(sourceRgb: TslAny, depthTex: TslAny): TslAny {
    return this.froxels.createAerialNode({
      sourceRgb,
      depthTex,
      projectionInverse: this.uProjectionInverse,
      cameraWorld: this.uCameraWorld,
      cameraPosition: this.uCameraPosition,
      sunDirection: this.uSunDirection,
      aerialPerspectiveEnabled: this.settings.aerialPerspectiveEnabled,
      aerialStageEnabled: this.stageEnabled("aerial"),
      effectiveFroxelsEnabled: this.effectiveFroxelsEnabled(),
    });
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
    this.exposure.updateGradeUniforms(
      this.settings,
      {
        uSunDirection: this.uSunDirection,
        uContrast: this.uContrast,
        uSaturation: this.uSaturation,
        uWhiteBalance: this.uWhiteBalance,
        uShadowTint: this.uShadowTint,
        uHighlightTint: this.uHighlightTint,
        uShadowAmount: this.uShadowAmount,
        uHighlightAmount: this.uHighlightAmount,
      },
      this.stageEnabled("colorScript"),
    );
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
      const depth = depthTex.r.min(65535 / 65536);
      const scaled = depth.mul(256);
      const high = scaled.floor().div(255);
      const low = scaled.fract();
      this.exposure.clearKernel();
      pipeline.outputNode = vec4(high, low, 0, 1);
    } else if (this.settings.debugMode === "copy") {
      this.exposure.clearKernel();
      pipeline.outputNode = beauty;
    } else {
      this.exposure.configure(beauty);
      pipeline.outputNode = this.graph.createOutputNode(beauty, depthTex, camera);
    }
    return pipeline;
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
    this.exposure.clearKernel();
    this.graph.disposeHalfRes();
  }
}
