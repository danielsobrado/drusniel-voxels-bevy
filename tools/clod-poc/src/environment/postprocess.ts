import { load } from "js-yaml";
import * as THREE from "three";
import postProcessYaml from "./config/postprocess.yaml?raw";

/**
 * God-rays / light-shaft mode.
 * - `off`: no light shafts.
 * - `cheap`: screen-space radial-blur shafts at a low raymarch budget. Cheapest, default-friendly.
 * - `heavy`: same screen-space technique with a higher raymarch budget for smoother shafts.
 * - `volumetric`: physically-based volumetric shafts that raymarch a real shadow map. Requires the
 *   volumetric controller to stand up a shadow-casting directional light, so it is the most costly.
 */
export type GodRaysMode = "off" | "cheap" | "heavy" | "volumetric";
export type PostProcessDebugMode = "output" | "copy" | "off";
export type PostProcessToneMapping = "aces" | "agx" | "linear" | "none";

export interface PostProcessSettings {
  enabled: boolean;
  opacity: number;
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  debugMode: PostProcessDebugMode;
  toneMapping?: PostProcessToneMapping;
  bloomEnabled?: boolean;
  bloomThreshold?: number;
  bloomStrength?: number;
  bloomRadius?: number;
  /** Light-shaft technique to apply after grading (WebGPU pipeline only). */
  godRaysMode: GodRaysMode;
  /** Step size of the screen-space raymarch toward the sun. Higher = longer shafts. */
  godRaysDensity: number;
  /** Per-sample falloff for the screen-space march. Must stay below 1. */
  godRaysDecay: number;
  /** Per-sample contribution weight for the screen-space march. */
  godRaysWeight: number;
  /** Output gain applied to the accumulated shafts. */
  godRaysExposure: number;
}

const POST_PROCESS_FALLBACK_SETTINGS: Required<PostProcessSettings> = {
  enabled: true,
  opacity: 1.0,
  exposure: 1.0,
  contrast: 1.04,
  saturation: 1.05,
  vignette: 0.0,
  debugMode: "output",
  toneMapping: "aces",
  bloomEnabled: true,
  bloomThreshold: 0.85,
  bloomStrength: 0.18,
  bloomRadius: 0.35,
  godRaysMode: "off",
  godRaysDensity: 0.96,
  godRaysDecay: 0.92,
  godRaysWeight: 0.35,
  godRaysExposure: 0.6,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function debugMode(value: unknown, fallback: PostProcessDebugMode): PostProcessDebugMode {
  return value === "output" || value === "copy" || value === "off" ? value : fallback;
}

function toneMapping(value: unknown, fallback: PostProcessToneMapping): PostProcessToneMapping {
  return value === "aces" || value === "agx" || value === "linear" || value === "none" ? value : fallback;
}

function godRaysMode(value: unknown, fallback: GodRaysMode): GodRaysMode {
  return value === "off" || value === "cheap" || value === "heavy" || value === "volumetric"
    ? value
    : fallback;
}

function withPostProcessDefaults(settings: Partial<PostProcessSettings>): Required<PostProcessSettings> {
  return { ...POST_PROCESS_FALLBACK_SETTINGS, ...settings };
}

export function parsePostProcessSettings(yamlText = postProcessYaml): Required<PostProcessSettings> {
  const fallback = POST_PROCESS_FALLBACK_SETTINGS;
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return fallback;
    const postprocess = isRecord(raw.postprocess) ? raw.postprocess : raw;
    const bloom = isRecord(postprocess.bloom) ? postprocess.bloom : {};
    const godRays = isRecord(postprocess.god_rays) ? postprocess.god_rays : {};
    return {
      enabled: booleanValue(postprocess.enabled, fallback.enabled),
      opacity: finiteNumber(postprocess.opacity, fallback.opacity),
      exposure: finiteNumber(postprocess.exposure, fallback.exposure),
      contrast: finiteNumber(postprocess.contrast, fallback.contrast),
      saturation: finiteNumber(postprocess.saturation, fallback.saturation),
      vignette: finiteNumber(postprocess.vignette, fallback.vignette),
      debugMode: debugMode(postprocess.debug_mode, fallback.debugMode),
      toneMapping: toneMapping(postprocess.tone_mapping, fallback.toneMapping),
      bloomEnabled: booleanValue(bloom.enabled, fallback.bloomEnabled),
      bloomThreshold: finiteNumber(bloom.threshold, fallback.bloomThreshold),
      bloomStrength: finiteNumber(bloom.strength, fallback.bloomStrength),
      bloomRadius: finiteNumber(bloom.radius, fallback.bloomRadius),
      godRaysMode: godRaysMode(godRays.mode, fallback.godRaysMode),
      godRaysDensity: finiteNumber(godRays.density, fallback.godRaysDensity),
      godRaysDecay: finiteNumber(godRays.decay, fallback.godRaysDecay),
      godRaysWeight: finiteNumber(godRays.weight, fallback.godRaysWeight),
      godRaysExposure: finiteNumber(godRays.exposure, fallback.godRaysExposure),
    };
  } catch (error) {
    console.warn("[postprocess] failed to parse postprocess.yaml; using fallback settings", error);
    return fallback;
  }
}

export const DEFAULT_POST_PROCESS_SETTINGS: Required<PostProcessSettings> = parsePostProcessSettings();

/** Screen-space raymarch sample count per god-rays mode. Drives shader cost. */
export const GOD_RAYS_SCREEN_SAMPLES: Record<"cheap" | "heavy", number> = {
  cheap: 24,
  heavy: 60,
};

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const OUTPUT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexelSize;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uBloomEnabled;
  uniform float uBloomThreshold;
  uniform float uBloomStrength;
  uniform float uBloomRadius;
  varying vec2 vUv;

  vec3 brightPass(vec2 uv) {
    vec3 sampleColor = texture2D(tDiffuse, uv).rgb;
    float brightness = max(max(sampleColor.r, sampleColor.g), sampleColor.b);
    float range = max(1.0 - uBloomThreshold, 0.0001);
    float mask = clamp((brightness - uBloomThreshold) / range, 0.0, 1.0);
    return sampleColor * mask;
  }

  vec3 bloomSample(vec2 offset, float weight) {
    vec2 spread = uTexelSize * max(uBloomRadius, 0.0) * 8.0;
    return brightPass(vUv + offset * spread) * weight;
  }

  vec3 bloomColor() {
    vec3 bloom = brightPass(vUv) * 0.18;
    bloom += bloomSample(vec2(1.0, 0.0), 0.10);
    bloom += bloomSample(vec2(-1.0, 0.0), 0.10);
    bloom += bloomSample(vec2(0.0, 1.0), 0.10);
    bloom += bloomSample(vec2(0.0, -1.0), 0.10);
    bloom += bloomSample(vec2(1.0, 1.0), 0.07);
    bloom += bloomSample(vec2(-1.0, 1.0), 0.07);
    bloom += bloomSample(vec2(1.0, -1.0), 0.07);
    bloom += bloomSample(vec2(-1.0, -1.0), 0.07);
    bloom += bloomSample(vec2(2.0, 0.0), 0.04);
    bloom += bloomSample(vec2(-2.0, 0.0), 0.04);
    bloom += bloomSample(vec2(0.0, 2.0), 0.04);
    bloom += bloomSample(vec2(0.0, -2.0), 0.04);
    return bloom;
  }

  void main() {
    vec4 sampled = texture2D(tDiffuse, vUv);
    vec3 color = sampled.rgb * uExposure;
    color += bloomColor() * uBloomStrength * uBloomEnabled;
    color = (color - 0.5) * uContrast + 0.5;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);

    vec2 center = vUv - 0.5;
    float vignetteMask = smoothstep(0.2, 0.75, length(center));
    color *= 1.0 - uVignette * vignetteMask;
    color = max(color, vec3(0.0));

    gl_FragColor = vec4(color, sampled.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const POSTPROCESS_SHADER_TEST_HOOKS = {
  fullscreenVertex: FULLSCREEN_VERT,
  copyFragment: COPY_FRAG,
  outputFragment: OUTPUT_FRAG,
} as const;

function createFullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

export function toneMappingModeToThree(mode: PostProcessToneMapping) {
  switch (mode) {
    case "agx":
      return THREE.AgXToneMapping;
    case "linear":
      return THREE.LinearToneMapping;
    case "none":
      return THREE.NoToneMapping;
    case "aces":
    default:
      return THREE.ACESFilmicToneMapping;
  }
}

export class PostProcessPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreenGeometry = createFullscreenTriangle();
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly outputMaterial: THREE.ShaderMaterial;
  private readonly fullscreenMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly drawingBufferSize = new THREE.Vector2();
  private settings: Required<PostProcessSettings>;

  constructor(renderer: THREE.WebGLRenderer, settings: PostProcessSettings) {
    this.renderer = renderer;
    this.settings = withPostProcessDefaults(settings);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      // Multisampled so grass alpha-to-coverage (and general edge AA) survive this offscreen
      // pass. Without it the post-process target is single-sample and A2C collapses to a hard
      // 1-bit cutout. WebGL2 resolves the multisample buffer automatically on read.
      samples: 4,
    });
    this.target.texture.name = "clod-poc-postprocess-color";

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uOpacity: { value: this.settings.opacity },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: true,
    });
    this.outputMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: this.settings.exposure },
        uContrast: { value: this.settings.contrast },
        uSaturation: { value: this.settings.saturation },
        uVignette: { value: this.settings.vignette },
        uBloomEnabled: { value: this.settings.bloomEnabled ? 1 : 0 },
        uBloomThreshold: { value: this.settings.bloomThreshold },
        uBloomStrength: { value: this.settings.bloomStrength },
        uBloomRadius: { value: this.settings.bloomRadius },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OUTPUT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    this.fullscreenMesh = new THREE.Mesh(this.fullscreenGeometry, this.outputMaterial);
    this.fullscreenMesh.frustumCulled = false;
    this.fullscreenScene.add(this.fullscreenMesh);
    this.updateSettings(this.settings);
  }

  setSize(width: number, height: number): void {
    // The render target uses physical pixels so it tracks renderer pixel ratio without
    // changing the public resize API, which continues to receive CSS pixel dimensions.
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const pixelRatio = this.renderer.getPixelRatio();
    const targetWidth = this.drawingBufferSize.x || Math.floor(width * pixelRatio);
    const targetHeight = this.drawingBufferSize.y || Math.floor(height * pixelRatio);
    this.target.setSize(Math.max(1, targetWidth), Math.max(1, targetHeight));
    this.outputMaterial.uniforms.uTexelSize.value.set(
      1 / Math.max(1, targetWidth),
      1 / Math.max(1, targetHeight),
    );
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    this.settings = withPostProcessDefaults({ ...this.settings, ...settings });
    this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
    this.copyMaterial.uniforms.uOpacity.value = this.settings.opacity;
    this.outputMaterial.uniforms.uExposure.value = this.settings.exposure;
    this.outputMaterial.uniforms.uContrast.value = this.settings.contrast;
    this.outputMaterial.uniforms.uSaturation.value = this.settings.saturation;
    this.outputMaterial.uniforms.uVignette.value = this.settings.vignette;
    this.outputMaterial.uniforms.uBloomEnabled.value = this.settings.bloomEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uBloomThreshold.value = this.settings.bloomThreshold;
    this.outputMaterial.uniforms.uBloomStrength.value = this.settings.bloomStrength;
    this.outputMaterial.uniforms.uBloomRadius.value = this.settings.bloomRadius;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);

    this.renderer.setRenderTarget(null);
    this.fullscreenMesh.material = this.settings.debugMode === "copy"
      ? this.copyMaterial
      : this.outputMaterial;
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.fullscreenGeometry.dispose();
    this.copyMaterial.dispose();
    this.outputMaterial.dispose();
  }
}
