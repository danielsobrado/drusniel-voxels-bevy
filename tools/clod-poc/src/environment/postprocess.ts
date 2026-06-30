import { load } from "js-yaml";
import * as THREE from "three";
import aerialPerspectiveYaml from "./config/aerial_perspective.yaml?raw";
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
export type PostProcessColor = [number, number, number];

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
  taaEnabled?: boolean;
  taaHistoryWeight?: number;
  taaDepthThreshold?: number;
  taaSharpen?: number;
  contactShadowsEnabled?: boolean;
  contactShadowsStrength?: number;
  contactShadowsRadiusPx?: number;
  contactShadowsDepthBias?: number;
  aerialPerspectiveEnabled?: boolean;
  aerialPerspectiveStart?: number;
  aerialPerspectiveEnd?: number;
  aerialPerspectiveStrength?: number;
  aerialPerspectiveColor?: PostProcessColor;
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
  taaEnabled: false,
  taaHistoryWeight: 0.88,
  taaDepthThreshold: 0.0025,
  taaSharpen: 0.06,
  contactShadowsEnabled: false,
  contactShadowsStrength: 0.25,
  contactShadowsRadiusPx: 2.0,
  contactShadowsDepthBias: 0.002,
  aerialPerspectiveEnabled: true,
  aerialPerspectiveStart: 120,
  aerialPerspectiveEnd: 1800,
  aerialPerspectiveStrength: 0.35,
  aerialPerspectiveColor: [0.62, 0.72, 0.86],
  godRaysMode: "off",
  godRaysDensity: 0.96,
  godRaysDecay: 0.92,
  godRaysWeight: 0.35,
  godRaysExposure: 0.6,
};

type AerialPerspectiveSettings = Pick<
  Required<PostProcessSettings>,
  | "aerialPerspectiveEnabled"
  | "aerialPerspectiveStart"
  | "aerialPerspectiveEnd"
  | "aerialPerspectiveStrength"
  | "aerialPerspectiveColor"
>;

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

function colorValue(value: unknown, fallback: PostProcessColor): PostProcessColor {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : fallback;
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

function flagValue(params: URLSearchParams, key: string): boolean | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return null;
}

function neutralGrade(settings: Required<PostProcessSettings>): void {
  settings.exposure = 1.0;
  settings.contrast = 1.0;
  settings.saturation = 1.0;
  settings.vignette = 0.0;
}

function browserSearchParams(): URLSearchParams | null {
  if (typeof globalThis.location === "undefined") return null;
  return new URLSearchParams(globalThis.location.search);
}

export function applyPostProcessQueryOverrides(
  settings: Partial<PostProcessSettings>,
  searchParams: URLSearchParams | null,
): Required<PostProcessSettings> {
  const next = withPostProcessDefaults(settings);
  if (!searchParams) return next;

  const fx = flagValue(searchParams, "fx");
  if (fx === false) {
    next.enabled = false;
    next.debugMode = "off";
    next.bloomEnabled = false;
    next.taaEnabled = false;
    next.contactShadowsEnabled = false;
    next.aerialPerspectiveEnabled = false;
    next.godRaysMode = "off";
  }

  const postProcess = flagValue(searchParams, "postprocess") ?? flagValue(searchParams, "postProcess");
  if (postProcess !== null) {
    next.enabled = postProcess;
    if (!postProcess) next.debugMode = "off";
  }

  const postMin = flagValue(searchParams, "postmin") ?? flagValue(searchParams, "postMin");
  if (postMin === true) {
    next.enabled = true;
    next.debugMode = "output";
    neutralGrade(next);
    next.bloomEnabled = false;
    next.taaEnabled = false;
    next.contactShadowsEnabled = false;
    next.aerialPerspectiveEnabled = false;
    next.godRaysMode = "off";
  }

  const grade = flagValue(searchParams, "grade");
  if (grade === false) neutralGrade(next);

  const bloom = flagValue(searchParams, "bloom");
  if (bloom !== null) next.bloomEnabled = bloom;

  const taa = flagValue(searchParams, "taa");
  if (taa !== null) next.taaEnabled = taa;

  const contactShadows = flagValue(searchParams, "contactShadows")
    ?? flagValue(searchParams, "contactshadows")
    ?? flagValue(searchParams, "contact");
  if (contactShadows !== null) next.contactShadowsEnabled = contactShadows;

  const aerial = flagValue(searchParams, "aerial") ?? flagValue(searchParams, "aerialPerspective");
  if (aerial !== null) next.aerialPerspectiveEnabled = aerial;

  const fog = flagValue(searchParams, "fog") ?? flagValue(searchParams, "haze");
  if (fog === false) next.aerialPerspectiveEnabled = false;

  const godRays = flagValue(searchParams, "godRays") ?? flagValue(searchParams, "godrays");
  if (godRays === false) next.godRaysMode = "off";

  const toneMap = searchParams.get("toneMap") ?? searchParams.get("toneMapping");
  next.toneMapping = toneMapping(toneMap, next.toneMapping);

  return next;
}

export function parseAerialPerspectiveSettings(yamlText = aerialPerspectiveYaml): AerialPerspectiveSettings {
  const fallback = POST_PROCESS_FALLBACK_SETTINGS;
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) {
      return {
        aerialPerspectiveEnabled: fallback.aerialPerspectiveEnabled,
        aerialPerspectiveStart: fallback.aerialPerspectiveStart,
        aerialPerspectiveEnd: fallback.aerialPerspectiveEnd,
        aerialPerspectiveStrength: fallback.aerialPerspectiveStrength,
        aerialPerspectiveColor: fallback.aerialPerspectiveColor,
      };
    }
    const aerial = isRecord(raw.aerial_perspective) ? raw.aerial_perspective : raw;
    return {
      aerialPerspectiveEnabled: booleanValue(aerial.enabled, fallback.aerialPerspectiveEnabled),
      aerialPerspectiveStart: finiteNumber(aerial.start_m, fallback.aerialPerspectiveStart),
      aerialPerspectiveEnd: finiteNumber(aerial.end_m, fallback.aerialPerspectiveEnd),
      aerialPerspectiveStrength: finiteNumber(aerial.strength, fallback.aerialPerspectiveStrength),
      aerialPerspectiveColor: colorValue(aerial.color, fallback.aerialPerspectiveColor),
    };
  } catch (error) {
    console.warn("[postprocess] failed to parse aerial_perspective.yaml; using fallback settings", error);
    return {
      aerialPerspectiveEnabled: fallback.aerialPerspectiveEnabled,
      aerialPerspectiveStart: fallback.aerialPerspectiveStart,
      aerialPerspectiveEnd: fallback.aerialPerspectiveEnd,
      aerialPerspectiveStrength: fallback.aerialPerspectiveStrength,
      aerialPerspectiveColor: fallback.aerialPerspectiveColor,
    };
  }
}

export function parsePostProcessSettings(yamlText = postProcessYaml): Required<PostProcessSettings> {
  const fallback = POST_PROCESS_FALLBACK_SETTINGS;
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return fallback;
    const postprocess = isRecord(raw.postprocess) ? raw.postprocess : raw;
    const bloom = isRecord(postprocess.bloom) ? postprocess.bloom : {};
    const taa = isRecord(postprocess.taa) ? postprocess.taa : {};
    const contactShadows = isRecord(postprocess.contact_shadows) ? postprocess.contact_shadows : {};
    const godRays = isRecord(postprocess.god_rays) ? postprocess.god_rays : {};
    return {
      ...fallback,
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
      taaEnabled: booleanValue(taa.enabled, fallback.taaEnabled),
      taaHistoryWeight: finiteNumber(taa.history_weight, fallback.taaHistoryWeight),
      taaDepthThreshold: finiteNumber(taa.depth_threshold, fallback.taaDepthThreshold),
      taaSharpen: finiteNumber(taa.sharpen, fallback.taaSharpen),
      contactShadowsEnabled: booleanValue(contactShadows.enabled, fallback.contactShadowsEnabled),
      contactShadowsStrength: finiteNumber(contactShadows.strength, fallback.contactShadowsStrength),
      contactShadowsRadiusPx: finiteNumber(contactShadows.radius_px, fallback.contactShadowsRadiusPx),
      contactShadowsDepthBias: finiteNumber(contactShadows.depth_bias, fallback.contactShadowsDepthBias),
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

export const DEFAULT_POST_PROCESS_SETTINGS: Required<PostProcessSettings> = applyPostProcessQueryOverrides(
  {
    ...parsePostProcessSettings(),
    ...parseAerialPerspectiveSettings(),
  },
  browserSearchParams(),
);

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
  uniform sampler2D tDepth;
  uniform sampler2D tHistory;
  uniform sampler2D tHistoryDepth;
  uniform vec2 uTexelSize;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform mat4 uInvCurrentViewProjection;
  uniform mat4 uPrevViewProjection;
  uniform float uHistoryReady;
  uniform float uTaaEnabled;
  uniform float uTaaHistoryWeight;
  uniform float uTaaDepthThreshold;
  uniform float uTaaSharpen;
  uniform float uContactShadowsEnabled;
  uniform float uContactShadowsStrength;
  uniform float uContactShadowsRadiusPx;
  uniform float uContactShadowsDepthBias;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uBloomEnabled;
  uniform float uBloomThreshold;
  uniform float uBloomStrength;
  uniform float uBloomRadius;
  uniform float uAerialPerspectiveEnabled;
  uniform float uAerialPerspectiveStart;
  uniform float uAerialPerspectiveEnd;
  uniform float uAerialPerspectiveStrength;
  uniform vec3 uAerialPerspectiveColor;
  varying vec2 vUv;

  #include <packing>

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

  vec3 sharpenCurrent(vec3 color) {
    vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)).rgb;
    vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y)).rgb;
    vec3 east = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 west = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0)).rgb;
    vec3 blur = (north + south + east + west) * 0.25;
    return max(color + (color - blur) * clamp(uTaaSharpen, 0.0, 1.0), vec3(0.0));
  }

  vec3 temporalSceneColor(vec3 currentColor) {
    if (uTaaEnabled < 0.5 || uHistoryReady < 0.5) return sharpenCurrent(currentColor);

    float depth = texture2D(tDepth, vUv).x;
    if (depth >= 0.999999) return currentColor;

    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world = uInvCurrentViewProjection * ndc;
    world /= max(abs(world.w), 0.000001);

    vec4 prevClip = uPrevViewProjection * world;
    if (prevClip.w <= 0.000001) return currentColor;

    vec3 prevNdc = prevClip.xyz / prevClip.w;
    vec2 prevUv = prevNdc.xy * 0.5 + 0.5;
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) return currentColor;

    float historyDepth = texture2D(tHistoryDepth, prevUv).x;
    float expectedHistoryDepth = prevNdc.z * 0.5 + 0.5;
    float depthDelta = abs(historyDepth - expectedHistoryDepth);
    if (historyDepth >= 0.999999 || depthDelta > uTaaDepthThreshold) return currentColor;

    vec3 historyColor = texture2D(tHistory, prevUv).rgb;
    float historyWeight = clamp(uTaaHistoryWeight, 0.0, 0.97);
    return sharpenCurrent(mix(currentColor, historyColor, historyWeight));
  }

  float contactShadowSample(float centerDepth, vec2 offset) {
    float sampleDepth = texture2D(tDepth, clamp(vUv + offset, vec2(0.0), vec2(1.0))).x;
    if (centerDepth >= 0.999999 || sampleDepth >= 0.999999) return 0.0;
    float closerDelta = centerDepth - sampleDepth;
    return smoothstep(uContactShadowsDepthBias, uContactShadowsDepthBias + 0.02, closerDelta);
  }

  float contactShadowFactor() {
    if (uContactShadowsEnabled < 0.5) return 1.0;
    float centerDepth = texture2D(tDepth, vUv).x;
    if (centerDepth >= 0.999999) return 1.0;
    vec2 radius = uTexelSize * max(uContactShadowsRadiusPx, 0.5);
    float occlusion = 0.0;
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0,  0.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0,  0.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 0.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 0.0, -1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0, -1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0, -1.0));
    occlusion *= 0.125;
    return 1.0 - clamp(occlusion * uContactShadowsStrength, 0.0, 0.55);
  }

  vec3 aerialPerspective(vec3 color) {
    float depth = texture2D(tDepth, vUv).x;
    float geometryMask = 1.0 - step(0.999999, depth);
    float viewZ = perspectiveDepthToViewZ(depth, uCameraNear, uCameraFar);
    float distanceM = max(-viewZ, 0.0);
    float startM = min(uAerialPerspectiveStart, uAerialPerspectiveEnd - 0.001);
    float haze = smoothstep(startM, uAerialPerspectiveEnd, distanceM);
    haze *= clamp(uAerialPerspectiveStrength, 0.0, 1.0) * uAerialPerspectiveEnabled * geometryMask;
    return mix(color, uAerialPerspectiveColor, haze);
  }

  void main() {
    vec4 sampled = texture2D(tDiffuse, vUv);
    vec3 color = temporalSceneColor(sampled.rgb) * contactShadowFactor() * uExposure;
    color += bloomColor() * uBloomStrength * uBloomEnabled;
    color = aerialPerspective(color);
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

function cameraClip(camera: THREE.Camera, key: "near" | "far", fallback: number): number {
  const value = (camera as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createSceneTarget(name: string): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.name = `${name}-depth`;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    depthTexture,
    stencilBuffer: false,
    // Multisampled so grass alpha-to-coverage (and general edge AA) survive this offscreen
    // pass. WebGL2 resolves the multisample buffer automatically on read.
    samples: 4,
  });
  target.texture.name = `${name}-color`;
  return target;
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
  private target = createSceneTarget("clod-poc-postprocess-current");
  private historyTarget = createSceneTarget("clod-poc-postprocess-history");
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreenGeometry = createFullscreenTriangle();
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly outputMaterial: THREE.ShaderMaterial;
  private readonly fullscreenMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly currentViewProjection = new THREE.Matrix4();
  private readonly inverseCurrentViewProjection = new THREE.Matrix4();
  private readonly previousViewProjection = new THREE.Matrix4();
  private historyReady = false;
  private settings: Required<PostProcessSettings>;

  constructor(renderer: THREE.WebGLRenderer, settings: PostProcessSettings) {
    this.renderer = renderer;
    this.settings = withPostProcessDefaults(settings);

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
        tDepth: { value: this.target.depthTexture },
        tHistory: { value: this.historyTarget.texture },
        tHistoryDepth: { value: this.historyTarget.depthTexture },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 8000 },
        uInvCurrentViewProjection: { value: this.inverseCurrentViewProjection },
        uPrevViewProjection: { value: this.previousViewProjection },
        uHistoryReady: { value: 0 },
        uTaaEnabled: { value: this.settings.taaEnabled ? 1 : 0 },
        uTaaHistoryWeight: { value: this.settings.taaHistoryWeight },
        uTaaDepthThreshold: { value: this.settings.taaDepthThreshold },
        uTaaSharpen: { value: this.settings.taaSharpen },
        uContactShadowsEnabled: { value: this.settings.contactShadowsEnabled ? 1 : 0 },
        uContactShadowsStrength: { value: this.settings.contactShadowsStrength },
        uContactShadowsRadiusPx: { value: this.settings.contactShadowsRadiusPx },
        uContactShadowsDepthBias: { value: this.settings.contactShadowsDepthBias },
        uExposure: { value: this.settings.exposure },
        uContrast: { value: this.settings.contrast },
        uSaturation: { value: this.settings.saturation },
        uVignette: { value: this.settings.vignette },
        uBloomEnabled: { value: this.settings.bloomEnabled ? 1 : 0 },
        uBloomThreshold: { value: this.settings.bloomThreshold },
        uBloomStrength: { value: this.settings.bloomStrength },
        uBloomRadius: { value: this.settings.bloomRadius },
        uAerialPerspectiveEnabled: { value: this.settings.aerialPerspectiveEnabled ? 1 : 0 },
        uAerialPerspectiveStart: { value: this.settings.aerialPerspectiveStart },
        uAerialPerspectiveEnd: { value: this.settings.aerialPerspectiveEnd },
        uAerialPerspectiveStrength: { value: this.settings.aerialPerspectiveStrength },
        uAerialPerspectiveColor: { value: new THREE.Color(...this.settings.aerialPerspectiveColor) },
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
    this.historyTarget.setSize(Math.max(1, targetWidth), Math.max(1, targetHeight));
    this.historyReady = false;
    this.outputMaterial.uniforms.uTexelSize.value.set(
      1 / Math.max(1, targetWidth),
      1 / Math.max(1, targetHeight),
    );
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const previousTaaEnabled = this.settings?.taaEnabled ?? false;
    this.settings = withPostProcessDefaults({ ...this.settings, ...settings });
    if (previousTaaEnabled !== this.settings.taaEnabled) this.historyReady = false;
    this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
    this.copyMaterial.uniforms.uOpacity.value = this.settings.opacity;
    this.outputMaterial.uniforms.uTaaEnabled.value = this.settings.taaEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uTaaHistoryWeight.value = this.settings.taaHistoryWeight;
    this.outputMaterial.uniforms.uTaaDepthThreshold.value = this.settings.taaDepthThreshold;
    this.outputMaterial.uniforms.uTaaSharpen.value = this.settings.taaSharpen;
    this.outputMaterial.uniforms.uContactShadowsEnabled.value = this.settings.contactShadowsEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uContactShadowsStrength.value = this.settings.contactShadowsStrength;
    this.outputMaterial.uniforms.uContactShadowsRadiusPx.value = this.settings.contactShadowsRadiusPx;
    this.outputMaterial.uniforms.uContactShadowsDepthBias.value = this.settings.contactShadowsDepthBias;
    this.outputMaterial.uniforms.uExposure.value = this.settings.exposure;
    this.outputMaterial.uniforms.uContrast.value = this.settings.contrast;
    this.outputMaterial.uniforms.uSaturation.value = this.settings.saturation;
    this.outputMaterial.uniforms.uVignette.value = this.settings.vignette;
    this.outputMaterial.uniforms.uBloomEnabled.value = this.settings.bloomEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uBloomThreshold.value = this.settings.bloomThreshold;
    this.outputMaterial.uniforms.uBloomStrength.value = this.settings.bloomStrength;
    this.outputMaterial.uniforms.uBloomRadius.value = this.settings.bloomRadius;
    this.outputMaterial.uniforms.uAerialPerspectiveEnabled.value = this.settings.aerialPerspectiveEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uAerialPerspectiveStart.value = this.settings.aerialPerspectiveStart;
    this.outputMaterial.uniforms.uAerialPerspectiveEnd.value = this.settings.aerialPerspectiveEnd;
    this.outputMaterial.uniforms.uAerialPerspectiveStrength.value = this.settings.aerialPerspectiveStrength;
    this.outputMaterial.uniforms.uAerialPerspectiveColor.value.setRGB(...this.settings.aerialPerspectiveColor);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.historyReady = false;
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    camera.updateMatrixWorld();
    this.currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inverseCurrentViewProjection.copy(this.currentViewProjection).invert();

    this.outputMaterial.uniforms.tDiffuse.value = this.target.texture;
    this.outputMaterial.uniforms.tDepth.value = this.target.depthTexture;
    this.outputMaterial.uniforms.tHistory.value = this.historyTarget.texture;
    this.outputMaterial.uniforms.tHistoryDepth.value = this.historyTarget.depthTexture;
    this.outputMaterial.uniforms.uHistoryReady.value = this.historyReady && this.settings.taaEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uCameraNear.value = cameraClip(camera, "near", 0.1);
    this.outputMaterial.uniforms.uCameraFar.value = cameraClip(camera, "far", 8000);
    this.outputMaterial.uniforms.uInvCurrentViewProjection.value.copy(this.inverseCurrentViewProjection);
    this.outputMaterial.uniforms.uPrevViewProjection.value.copy(this.previousViewProjection);
    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture;

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);

    this.renderer.setRenderTarget(null);
    this.fullscreenMesh.material = this.settings.debugMode === "copy"
      ? this.copyMaterial
      : this.outputMaterial;
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);

    if (this.settings.taaEnabled) {
      this.previousViewProjection.copy(this.currentViewProjection);
      const renderedTarget = this.target;
      this.target = this.historyTarget;
      this.historyTarget = renderedTarget;
      this.historyReady = true;
    } else {
      this.previousViewProjection.copy(this.currentViewProjection);
      this.historyReady = false;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.historyTarget.dispose();
    this.fullscreenGeometry.dispose();
    this.copyMaterial.dispose();
    this.outputMaterial.dispose();
  }
}
