import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  clamp,
  dot,
  float,
  getViewPosition,
  luminance,
  mix,
  mrt,
  output,
  pass,
  screenSize,
  screenUV,
  smoothstep,
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
  private readonly projectionInverse = new THREE.Matrix4();
  private readonly colorScript: PostFxColorScript = DEFAULT_POSTFX_COLOR_SCRIPT;
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
    } catch (error) {
      if (!isSetIndexBufferError(error)) {
        reportPostProcessError(error);
        throw error;
      }
      const converted = convertVisibleTerrainMeshesToNonIndexed(scene);
      if (converted <= 0) throw error;
      console.warn(`[webgpu-post] converted ${converted} indexed terrain mesh(es) to non-indexed geometry after setIndexBuffer failure`);
      pipeline.render();
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
    this.uAerialStart.value = this.settings.aerialPerspectiveStart;
    this.uAerialEnd.value = this.settings.aerialPerspectiveEnd;
    this.uAerialStrength.value = this.settings.aerialPerspectiveStrength;
    this.uAerialColor.value.set(...this.settings.aerialPerspectiveColor);
    this.updateColorScriptUniforms();
  }

  private updateColorScriptUniforms(): void {
    const grade = this.resolveGrade();
    this.uContrast.value = this.settings.contrast * grade.contrast;
    this.uSaturation.value = this.settings.saturation * grade.saturation;
    this.uWhiteBalance.value.set(...grade.whiteBalance);
    this.uShadowTint.value.set(...grade.shadowTint);
    this.uHighlightTint.value.set(...grade.highlightTint);
    this.uShadowAmount.value = grade.shadowAmount;
    this.uHighlightAmount.value = grade.highlightAmount;
  }

  private resolveGrade(): PostFxGradeParams {
    if (!this.getLighting) return DEFAULT_POSTFX_GRADE;
    try {
      return gradeForLighting(this.getLighting(), this.colorScript);
    } catch (error) {
      if (!this.lightingErrorReported) {
        this.lightingErrorReported = true;
        console.warn("[webgpu-post] failed to read lighting for color script; using default grade", error);
      }
      return DEFAULT_POSTFX_GRADE;
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
    pipeline.outputNode = this.settings.debugMode === "copy"
      ? beauty
      : this.createOutputNode(beauty, depthTex, camera);
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
    return this.createGradeNode(beauty.rgb, bloomRgb);
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

    return Fn((): TslAny => {
      const balanced = postRgb.mul(uExposure).mul(uWhiteBalance);
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
  }
}
