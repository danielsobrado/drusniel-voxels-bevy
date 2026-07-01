import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  If,
  Return,
  clamp,
  dot,
  exp2,
  float,
  getScreenPosition,
  getViewPosition,
  instanceIndex,
  instancedArray,
  log2,
  luminance,
  mix,
  mrt,
  output,
  pass,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  toneMappingModeToThree,
  type PostProcessSettings,
} from "../environment/postprocess.js";
import {
  autoExposureWeightTotal,
  centerMeterWeight,
  DEFAULT_POSTFX_AUTO_EXPOSURE,
  type PostFxAutoExposureSettings,
} from "./postfx_auto_exposure.js";
import {
  DEFAULT_POSTFX_COLOR_SCRIPT,
  DEFAULT_POSTFX_GRADE,
  gradeForLighting,
  type PostFxColorScript,
  type PostFxGradeParams,
} from "./postfx_color_script.js";

const TERRAIN_NON_INDEXED_FALLBACK_KEY = "__drusnielWebGpuTerrainNonIndexedFallback";
const WEBGPU_POST_EXPOSURE = 1.0;
const DEFAULT_ALPHA = 1.0;
const VIGNETTE_SCALE = 1.6;
const CONTACT_SHADOW_STEPS = 8;
const CONTACT_SHADOW_MAX_DISTANCE_M = 260;
const CONTACT_SHADOW_FULL_DISTANCE_M = 120;
const CONTACT_SHADOW_DEPTH_RANGE_FACTOR = 0.85;
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

type TslAny = any;
const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;
type NumericUniform = { value: number };
type MatrixUniform = { value: THREE.Matrix4 };
type VectorUniform = { value: THREE.Vector3 };

type WebGpuTerrainFallbackGeometry = THREE.BufferGeometry & {
  [TERRAIN_NON_INDEXED_FALLBACK_KEY]?: boolean;
};

function withPostProcessDefaults(settings: Partial<PostProcessSettings>): Required<PostProcessSettings> {
  return { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
}

function numberKey(value: number | undefined): string {
  return Number(value ?? 0).toFixed(4);
}

function webGpuPostProcessGraphKey(settings: Required<PostProcessSettings>): string {
  return [
    settings.enabled ? "1" : "0",
    settings.debugMode,
    settings.bloomEnabled ? "bloom" : "no-bloom",
    numberKey(settings.bloomThreshold),
    numberKey(settings.bloomStrength),
    numberKey(settings.bloomRadius),
    settings.taaEnabled ? "taa" : "no-taa",
    settings.aerialPerspectiveEnabled ? "aerial" : "no-aerial",
    settings.contactShadowsEnabled ? "contact" : "no-contact",
  ].join("|");
}

/** True when the post-process output graph must be recompiled. */
export function postProcessOutputGraphDirty(
  current: PostProcessSettings,
  settings: Partial<PostProcessSettings>,
): boolean {
  const currentResolved = withPostProcessDefaults(current);
  const nextResolved = withPostProcessDefaults({ ...currentResolved, ...settings });
  return webGpuPostProcessGraphKey(currentResolved) !== webGpuPostProcessGraphKey(nextResolved);
}

function searchParams(): URLSearchParams | null {
  if (typeof globalThis.location === "undefined") return null;
  return new URLSearchParams(globalThis.location.search);
}

function queryFlag(keys: string[], fallback: boolean): boolean {
  const params = searchParams();
  if (!params) return fallback;
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return fallback;
}

function isSetIndexBufferError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("setIndexBuffer") && message.includes("GPUBuffer");
}

function isIndexedTerrainGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.index !== null
    && geometry.getAttribute("paintSlots") !== undefined
    && geometry.getAttribute("paintWeights") !== undefined;
}

function convertTerrainGeometryToNonIndexed(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return false;
  const fallbackGeometry = geometry as WebGpuTerrainFallbackGeometry;
  if (fallbackGeometry[TERRAIN_NON_INDEXED_FALLBACK_KEY] || !isIndexedTerrainGeometry(geometry)) return false;

  const replacement = geometry.toNonIndexed() as WebGpuTerrainFallbackGeometry;
  replacement.name = geometry.name ? `${geometry.name}-webgpu-nonindexed` : "clod-terrain-webgpu-nonindexed";
  replacement[TERRAIN_NON_INDEXED_FALLBACK_KEY] = true;
  mesh.geometry = replacement;
  geometry.dispose();
  return true;
}

function convertVisibleTerrainMeshesToNonIndexed(scene: THREE.Scene): number {
  let converted = 0;
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Mesh && convertTerrainGeometryToNonIndexed(object)) converted += 1;
  });
  return converted;
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
  private exposureErrorReported = false;
  private exposureBuffer: TslAny | null = null;
  private exposureKernel: TslAny | null = null;
  private readonly projectionInverse = new THREE.Matrix4();
  private readonly colorScript: PostFxColorScript = DEFAULT_POSTFX_COLOR_SCRIPT;
  private readonly autoExposure: PostFxAutoExposureSettings = DEFAULT_POSTFX_AUTO_EXPOSURE;
  private readonly autoExposureEnabled: boolean;
  private readonly lockExposure: boolean;
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
  private readonly uAerialStart = uniform(120.0) as unknown as NumericUniform;
  private readonly uAerialEnd = uniform(1800.0) as unknown as NumericUniform;
  private readonly uAerialStrength = uniform(0.0) as unknown as NumericUniform;
  private readonly uAerialColor = uniform(new THREE.Vector3(0.62, 0.72, 0.86)) as unknown as VectorUniform;
  private readonly uProjectionInverse = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uCameraWorld = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uProjection = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uView = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uPrevView = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;
  private readonly uPrevProjection = uniform(new THREE.Matrix4()) as unknown as MatrixUniform;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
    private readonly getLighting: (() => EnvironmentLighting) | null = null,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.settings = withPostProcessDefaults(settings);
    this.autoExposureEnabled = queryFlag(["autoExposure", "autoexposure"], this.autoExposure.enabled);
    this.lockExposure = queryFlag(["lockexp", "lockExposure", "lockexposure"], this.autoExposure.lock);
    this.applyRendererSettings();
    this.updateUniforms();
  }

  setSize(_width?: number, _height?: number): void {
    // RenderPipeline tracks the renderer size; the method preserves AppPostProcess parity.
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const previousKey = webGpuPostProcessGraphKey(this.settings);
    this.settings = withPostProcessDefaults({ ...this.settings, ...settings });
    this.applyRendererSettings();
    this.updateUniforms();
    const nextKey = webGpuPostProcessGraphKey(this.settings);
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

    this.updateColorScriptUniforms();
    this.syncCameraUniforms(camera);
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
  }

  private applyRendererSettings(): void {
    this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
    (this.renderer as unknown as { toneMappingExposure?: number }).toneMappingExposure = WEBGPU_POST_EXPOSURE;
  }

  private updateUniforms(): void {
    this.uExposure.value = this.settings.exposure;
    this.uVignette.value = this.settings.vignette;
    this.uOpacity.value = this.settings.opacity;
    this.uContactStrength.value = this.settings.contactShadowsEnabled ? this.settings.contactShadowsStrength : 0;
    this.uContactRadius.value = Math.max(0.01, this.settings.contactShadowsRadiusPx);
    this.uContactDepthBias.value = Math.max(0.0001, this.settings.contactShadowsDepthBias);
    this.uAerialStart.value = this.settings.aerialPerspectiveStart;
    this.uAerialEnd.value = this.settings.aerialPerspectiveEnd;
    this.uAerialStrength.value = this.settings.aerialPerspectiveStrength;
    this.uAerialColor.value.set(...this.settings.aerialPerspectiveColor);
    this.updateColorScriptUniforms();
  }

  private updateColorScriptUniforms(): void {
    const lighting = this.resolveLighting();
    const grade = lighting ? gradeForLighting(lighting, this.colorScript) : DEFAULT_POSTFX_GRADE;
    if (lighting) this.uSunDirection.value.copy(lighting.sunDirection).normalize();
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
    const key = webGpuPostProcessGraphKey(this.settings);
    if (this.pipeline && this.pipelineKey === key) return this.pipeline;
    this.disposePipeline();
    this.pipeline = this.createPipeline(scene, camera);
    this.pipelineKey = key;
    return this.pipeline;
  }

  private createPipeline(scene: THREE.Scene, camera: THREE.Camera): RenderPipeline {
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output }));
    const beauty = scenePass.getTextureNode("output") as TslAny;
    const depthTex = scenePass.getTextureNode("depth") as TslAny;
    const pipeline = new RenderPipeline(this.renderer);
    if (this.settings.debugMode === "copy") {
      this.exposureKernel = null;
      pipeline.outputNode = beauty;
    } else {
      this.configureAutoExposure(beauty);
      pipeline.outputNode = this.createOutputNode(beauty, depthTex, camera);
    }
    return pipeline;
  }

  private createOutputNode(beauty: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    const aerialRgb = this.settings.aerialPerspectiveEnabled
      ? this.createAerialNode(beauty.rgb, depthTex)
      : beauty.rgb;
    const temporalColor = this.settings.taaEnabled
      ? this.createTraaNode(aerialRgb, depthTex, camera)
      : vec4(aerialRgb, DEFAULT_ALPHA);
    const temporalRgb = (temporalColor as TslAny).rgb;
    const bloomRgb = this.settings.bloomEnabled
      ? temporalRgb.add((bloom(
          temporalColor,
          this.settings.bloomThreshold,
          this.settings.bloomStrength,
          this.settings.bloomRadius,
        ) as TslAny).rgb)
      : temporalRgb;
    const contactRgb = this.settings.contactShadowsEnabled
      ? bloomRgb.mul(this.createContactShadowNode(depthTex))
      : bloomRgb;
    return this.createGradeNode(beauty.rgb, contactRgb);
  }

  private createAerialNode(sourceRgb: TslAny, depthTex: TslAny): TslAny {
    const uProjectionInverse = this.uProjectionInverse as unknown as TslAny;
    const uAerialStart = this.uAerialStart as unknown as TslAny;
    const uAerialEnd = this.uAerialEnd as unknown as TslAny;
    const uAerialStrength = this.uAerialStrength as unknown as TslAny;
    const uAerialColor = this.uAerialColor as unknown as TslAny;

    return Fn((): TslAny => {
      const depth = depthTex.x;
      const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
      const viewPosition = getViewPosition(screenUV, depth, uProjectionInverse) as TslAny;
      const distance = viewPosition.length();
      const geometryMask = isSky.select(float(0), float(1));
      const haze = smoothstep(uAerialStart, uAerialEnd, distance)
        .mul(uAerialStrength)
        .mul(geometryMask);
      return tslMix(sourceRgb, uAerialColor, clamp(haze, 0, 1));
    })();
  }

  private createTraaNode(sourceRgb: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    const uProjectionInverse = this.uProjectionInverse as unknown as TslAny;
    const uCameraWorld = this.uCameraWorld as unknown as TslAny;
    const uPrevView = this.uPrevView as unknown as TslAny;
    const uPrevProjection = this.uPrevProjection as unknown as TslAny;

    const velocity = {
      load: (texel: TslAny): TslAny => {
        const uv = texel.div(screenSize);
        const depth = (depthTex.load(texel) as TslAny).x;
        const posView = getViewPosition(uv, depth, uProjectionInverse) as TslAny;
        const posWorld = uCameraWorld.mul(vec4(posView, 1)).xyz;
        const posPrevView = uPrevView.mul(vec4(posWorld, 1)).xyz;
        const clipPrev = uPrevProjection.mul(vec4(posPrevView, 1));
        const uvPrevRaw = clipPrev.xy.div(clipPrev.w).mul(0.5).add(0.5);
        const uvPrev = vec2(uvPrevRaw.x, uvPrevRaw.y.oneMinus());
        return vec4(uv.sub(uvPrev).mul(vec2(2, -2)), 0, 1);
      },
    } as TslAny;

    return traa(vec4(sourceRgb, DEFAULT_ALPHA), depthTex, velocity, camera as TslAny) as TslAny;
  }

  private createContactShadowNode(depthTex: TslAny): TslAny {
    const uProjectionInverse = this.uProjectionInverse as unknown as TslAny;
    const uProjection = this.uProjection as unknown as TslAny;
    const uView = this.uView as unknown as TslAny;
    const uSunDirection = this.uSunDirection as unknown as TslAny;
    const uContactStrength = this.uContactStrength as unknown as TslAny;
    const uContactRadius = this.uContactRadius as unknown as TslAny;
    const uContactDepthBias = this.uContactDepthBias as unknown as TslAny;

    return Fn((): TslAny => {
      const result = float(1).toVar();
      const depth = depthTex.x;
      const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
      const viewPosition = getViewPosition(screenUV, depth, uProjectionInverse) as TslAny;
      const distance = viewPosition.length();
      If(isSky.not().and(distance.lessThan(CONTACT_SHADOW_MAX_DISTANCE_M)), () => {
        const sunView = uView.mul(vec4(uSunDirection, 0)).xyz.normalize();
        const hitF = float(2).toVar();
        for (let step = 1; step <= CONTACT_SHADOW_STEPS; step++) {
          const fraction = (step / CONTACT_SHADOW_STEPS) ** 1.6;
          If(hitF.greaterThan(1.5), () => {
            const sampleView = viewPosition.add(sunView.mul(uContactRadius).mul(fraction));
            const uvSample = getScreenPosition(sampleView, uProjection);
            const inFrame = uvSample.x
              .greaterThan(0.001)
              .and(uvSample.x.lessThan(0.999))
              .and(uvSample.y.greaterThan(0.001))
              .and(uvSample.y.lessThan(0.999));
            const depthSample = texture(depthTex.value, uvSample).x;
            const bufferView = getViewPosition(uvSample, depthSample, uProjectionInverse) as TslAny;
            const depthDelta = bufferView.z.sub(sampleView.z);
            const hit = depthDelta
              .greaterThan(uContactDepthBias)
              .and(depthDelta.lessThan(uContactRadius.mul(CONTACT_SHADOW_DEPTH_RANGE_FACTOR)))
              .and(inFrame);
            If(hit, () => {
              hitF.assign(fraction);
            });
          });
        }
        const occlusion = hitF.lessThan(1.5).select(float(1).sub(hitF.mul(0.5)), float(0));
        const fade = smoothstep(CONTACT_SHADOW_MAX_DISTANCE_M, CONTACT_SHADOW_FULL_DISTANCE_M, distance);
        result.assign(float(1).sub(occlusion.mul(uContactStrength).mul(fade)));
      });
      return result;
    })();
  }

  private createGradeNode(sourceRgb: TslAny, postRgb: TslAny): TslAny {
    const uExposure = this.uExposure as unknown as TslAny;
    const uContrast = this.uContrast as unknown as TslAny;
    const uSaturation = this.uSaturation as unknown as TslAny;
    const uVignette = this.uVignette as unknown as TslAny;
    const uOpacity = this.uOpacity as unknown as TslAny;
    const uWhiteBalance = this.uWhiteBalance as unknown as TslAny;
    const uShadowTint = this.uShadowTint as unknown as TslAny;
    const uShadowAmount = this.uShadowAmount as unknown as TslAny;
    const uHighlightTint = this.uHighlightTint as unknown as TslAny;
    const uHighlightAmount = this.uHighlightAmount as unknown as TslAny;
    const autoExposure = this.autoExposureEnabled && this.exposureBuffer
      ? this.exposureBuffer.element(0)
      : float(1);

    return Fn((): TslAny => {
      const balanced = postRgb.mul(uExposure).mul(autoExposure).mul(uWhiteBalance);
      const luma = dot(balanced, vec3(...LUMA_WEIGHTS));
      const shadowMask = smoothstep(0.45, 0.08, luma).mul(uShadowAmount);
      const shadowed = tslMix(balanced, balanced.mul(uShadowTint), shadowMask);
      const highlightMask = smoothstep(0.35, 0.95, luma).mul(uHighlightAmount);
      const tinted = tslMix(shadowed, shadowed.mul(uHighlightTint), highlightMask);
      const contrasted = tinted.sub(0.5).mul(uContrast).add(0.5);
      const saturated = tslMix(luminance(contrasted) as TslAny, contrasted, uSaturation);
      const center = screenUV.sub(0.5);
      const vignette = clamp(float(1).sub(dot(center, center).mul(uVignette).mul(VIGNETTE_SCALE)), 0, 1);
      const graded = saturated.mul(vignette);
      return tslMix(sourceRgb, graded, clamp(uOpacity, 0, 1));
    })();
  }

  private configureAutoExposure(beauty: TslAny): void {
    this.exposureKernel = null;
    if (!this.autoExposureEnabled) return;
    this.ensureExposureBuffer();
    this.exposureKernel = this.createExposureKernel(beauty);
    this.exposureKernel.setName?.("autoExposure");
  }

  private ensureExposureBuffer(): void {
    if (this.exposureBuffer) return;
    this.exposureBuffer = instancedArray(2, "float") as TslAny;
    const exposureBuffer = this.exposureBuffer;
    const initKernel = Fn((): void => {
      exposureBuffer.element(0).assign(1);
      exposureBuffer.element(1).assign(1);
    })().compute(1);
    this.runExposureCompute(initKernel, true);
  }

  private createExposureKernel(beauty: TslAny): TslAny {
    const exposureBuffer = this.exposureBuffer as TslAny;
    const settings = this.autoExposure;
    const samples = settings.samplesPerAxis;
    const weightTotal = autoExposureWeightTotal(samples, settings.centerWeightStrength);

    return Fn((): void => {
      If(instanceIndex.greaterThanEqual(1), () => {
        Return();
      });
      const logSum = float(0).toVar();
      for (let gy = 0; gy < samples; gy++) {
        for (let gx = 0; gx < samples; gx++) {
          const u = (gx + 0.5) / samples;
          const v = (gy + 0.5) / samples;
          const weight = centerMeterWeight(u, v, settings.centerWeightStrength);
          const color = texture(beauty.value, vec2(u, v)).rgb;
          const lum = luminance(color).max(1e-4);
          logSum.addAssign(log2(lum).mul(weight));
        }
      }
      const averageLum = exp2(logSum.div(weightTotal));
      const target = clamp(float(settings.targetLuminance).div(averageLum), settings.minExposure, settings.maxExposure);
      const previous = exposureBuffer.element(0);
      exposureBuffer.element(0).assign(tslMix(previous, target, settings.adaptationRate));
    })().compute(1);
  }

  private meterExposure(): void {
    if (this.lockExposure || !this.exposureKernel) return;
    this.runExposureCompute(this.exposureKernel, false);
  }

  private runExposureCompute(kernel: TslAny, preferAsync: boolean): void {
    const renderer = this.renderer as unknown as {
      compute?: (node: TslAny) => void;
      computeAsync?: (node: TslAny) => Promise<unknown>;
    };
    try {
      if (preferAsync && renderer.computeAsync) {
        void renderer.computeAsync(kernel).catch((error: unknown) => this.reportExposureError(error));
        return;
      }
      renderer.compute?.(kernel);
    } catch (error) {
      this.reportExposureError(error);
    }
  }

  private reportExposureError(error: unknown): void {
    if (this.exposureErrorReported) return;
    this.exposureErrorReported = true;
    console.warn("[webgpu-post] auto-exposure compute failed; continuing with last exposure", error);
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
    this.exposureKernel = null;
  }
}
