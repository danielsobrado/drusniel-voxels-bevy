import { load } from "js-yaml";
import { parsePostFxFroxelDebugMode, type PostFxFroxelDebugMode } from "../gpu/postfx_atmosphere.js";
import aerialPerspectiveYaml from "./config/aerial_perspective.yaml?raw";
import postProcessYaml from "./config/postprocess.yaml?raw";

/**
 * God-rays / light-shaft mode.
 * - `off`: no light shafts.
 * - `cheap`: screen-space radial-blur shafts at a low raymarch budget. Cheapest, default-friendly.
 * - `heavy`: same screen-space technique with a higher raymarch budget for smoother shafts.
 * - `volumetric`: on WebGPU, `heavy` shafts plus the froxel fog layer forced on as the ambience
 *   underneath. The frozen WebGL fallback aliases this to `heavy`.
 */
export type GodRaysMode = "off" | "cheap" | "heavy" | "volumetric";

export const GOD_RAYS_MODES: readonly GodRaysMode[] = ["off", "cheap", "heavy", "volumetric"] as const;
export type PostProcessDebugMode = "output" | "copy" | "off";
export type PostProcessToneMapping = "aces" | "agx" | "linear" | "none";
export type PostProcessColor = [number, number, number];

export interface PostProcessSettings {
  enabled: boolean;
  opacity: number;
  renderScale?: number;
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
  fxaaEnabled?: boolean;
  fxaaEdgeThreshold?: number;
  fxaaSubpixelBlend?: number;
  taaEnabled?: boolean;
  taaHistoryWeight?: number;
  taaDepthThreshold?: number;
  taaSharpen?: number;
  taaJitterEnabled?: boolean;
  taaJitterScale?: number;
  taaHistoryClampEnabled?: boolean;
  taaHistoryClampStrength?: number;
  contactShadowsEnabled?: boolean;
  contactShadowsStrength?: number;
  contactShadowsRadiusPx?: number;
  contactShadowsDepthBias?: number;
  clarityEnabled?: boolean;
  claritySharpen?: number;
  clarityDither?: number;
  aerialPerspectiveEnabled?: boolean;
  aerialPerspectiveStart?: number;
  aerialPerspectiveEnd?: number;
  aerialPerspectiveStrength?: number;
  aerialPerspectiveColor?: PostProcessColor;
  /** WebGPU volumetric cloud post stage. WebGL ignores this flag. */
  cloudsEnabled?: boolean;
  /** WebGPU GTAO stage. WebGL ignores this flag. */
  gtaoEnabled?: boolean;
  /** WebGPU froxel volumetrics stage. WebGL ignores this flag. */
  froxelsEnabled?: boolean;
  /** WebGPU screen-space bounce stage. WebGL ignores this flag. */
  bounceEnabled?: boolean;
  /**
   * WebGPU froxel debug overlay. When enabled, the froxel volume replaces the final image with the
   * buffer named by `froxelDebugMode`, and the volume runs even if `froxelsEnabled` is off. WebGL
   * ignores this flag.
   */
  froxelDebugEnabled?: boolean;
  /** Which froxel buffer the debug overlay visualizes. `off` renders the normal image. */
  froxelDebugMode?: PostFxFroxelDebugMode;
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
  /** Blend of the animated beam-space dust striation over clean shafts. 0 = classic shafts. */
  godRaysDustStrength: number;
  /** Spatial frequency of the dust striation noise in beam space. */
  godRaysDustScale: number;
  /** Drift speed of the dust striation noise. */
  godRaysDustSpeed: number;
}

const POST_PROCESS_FALLBACK_SETTINGS: Required<PostProcessSettings> = {
  enabled: true,
  opacity: 1.0,
  renderScale: 0.75,
  exposure: 1.0,
  contrast: 1.02,
  saturation: 1.03,
  vignette: 0.0,
  debugMode: "output",
  toneMapping: "aces",
  bloomEnabled: false,
  bloomThreshold: 0.85,
  bloomStrength: 0.18,
  bloomRadius: 0.35,
  fxaaEnabled: true,
  fxaaEdgeThreshold: 0.125,
  fxaaSubpixelBlend: 0.75,
  taaEnabled: true,
  taaHistoryWeight: 0.88,
  taaDepthThreshold: 0.0025,
  taaSharpen: 0.06,
  taaJitterEnabled: false,
  taaJitterScale: 1.0,
  taaHistoryClampEnabled: false,
  taaHistoryClampStrength: 1.0,
  contactShadowsEnabled: false,
  contactShadowsStrength: 0.25,
  contactShadowsRadiusPx: 2.0,
  contactShadowsDepthBias: 0.002,
  clarityEnabled: true,
  claritySharpen: 0.06,
  clarityDither: 0.002,
  aerialPerspectiveEnabled: true,
  aerialPerspectiveStart: 120,
  aerialPerspectiveEnd: 1800,
  aerialPerspectiveStrength: 0.35,
  aerialPerspectiveColor: [0.62, 0.72, 0.86],
  cloudsEnabled: false,
  gtaoEnabled: false,
  froxelsEnabled: false,
  bounceEnabled: false,
  froxelDebugEnabled: false,
  froxelDebugMode: "off",
  godRaysMode: "off",
  godRaysDensity: 0.96,
  godRaysDecay: 0.92,
  godRaysWeight: 0.35,
  godRaysExposure: 0.6,
  godRaysDustStrength: 0.55,
  godRaysDustScale: 6.0,
  godRaysDustSpeed: 0.05,
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

/**
 * Parses a `?godrays=` query value: mode names select a mode, boolean-ish values map to
 * `off` (false) or the provided on-mode (true). Unknown values return null (no override).
 */
export function parseGodRaysModeParam(raw: string, onMode: GodRaysMode = "cheap"): GodRaysMode | null {
  const value = raw.trim().toLowerCase();
  if ((GOD_RAYS_MODES as readonly string[]).includes(value)) return value as GodRaysMode;
  if (value === "0" || value === "false" || value === "no") return "off";
  if (value === "1" || value === "true" || value === "on" || value === "yes") return onMode;
  return null;
}

export function withPostProcessDefaults(settings: Partial<PostProcessSettings>): Required<PostProcessSettings> {
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

function numberValue(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function clampedRenderScale(value: number): number {
  return Math.min(1, Math.max(0.5, value));
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

  const renderScale = numberValue(searchParams, "renderScale")
    ?? numberValue(searchParams, "renderscale")
    ?? numberValue(searchParams, "postScale")
    ?? numberValue(searchParams, "postprocessScale");
  if (renderScale !== null) next.renderScale = clampedRenderScale(renderScale);

  const fx = flagValue(searchParams, "fx");
  if (fx === false) {
    next.enabled = false;
    next.debugMode = "off";
    next.bloomEnabled = false;
    next.fxaaEnabled = false;
    next.taaEnabled = false;
    next.taaJitterEnabled = false;
    next.taaHistoryClampEnabled = false;
    next.contactShadowsEnabled = false;
    next.clarityEnabled = false;
    next.aerialPerspectiveEnabled = false;
    next.cloudsEnabled = false;
    next.gtaoEnabled = false;
    next.froxelsEnabled = false;
    next.bounceEnabled = false;
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
    next.fxaaEnabled = false;
    next.taaEnabled = false;
    next.taaJitterEnabled = false;
    next.taaHistoryClampEnabled = false;
    next.contactShadowsEnabled = false;
    next.clarityEnabled = false;
    next.aerialPerspectiveEnabled = false;
    next.cloudsEnabled = false;
    next.gtaoEnabled = false;
    next.froxelsEnabled = false;
    next.bounceEnabled = false;
    next.godRaysMode = "off";
  }

  const grade = flagValue(searchParams, "grade");
  if (grade === false) neutralGrade(next);

  const bloom = flagValue(searchParams, "bloom");
  if (bloom !== null) next.bloomEnabled = bloom;

  const fxaa = flagValue(searchParams, "fxaa") ?? flagValue(searchParams, "aa");
  if (fxaa !== null) next.fxaaEnabled = fxaa;

  const taa = flagValue(searchParams, "taa") ?? flagValue(searchParams, "traa");
  if (taa !== null) next.taaEnabled = taa;

  const taaJitter = flagValue(searchParams, "taaJitter")
    ?? flagValue(searchParams, "taajitter")
    ?? flagValue(searchParams, "jitter");
  if (taaJitter !== null) next.taaJitterEnabled = taaJitter;

  const taaClamp = flagValue(searchParams, "taaClamp")
    ?? flagValue(searchParams, "taaclamp")
    ?? flagValue(searchParams, "historyClamp");
  if (taaClamp !== null) next.taaHistoryClampEnabled = taaClamp;

  const contactShadows = flagValue(searchParams, "contactShadows")
    ?? flagValue(searchParams, "contactshadows")
    ?? flagValue(searchParams, "contact");
  if (contactShadows !== null) next.contactShadowsEnabled = contactShadows;

  const clarity = flagValue(searchParams, "clarity") ?? flagValue(searchParams, "sharpen");
  if (clarity !== null) next.clarityEnabled = clarity;

  const aerial = flagValue(searchParams, "aerial") ?? flagValue(searchParams, "aerialPerspective");
  if (aerial !== null) next.aerialPerspectiveEnabled = aerial;

  const fog = flagValue(searchParams, "fog") ?? flagValue(searchParams, "haze");
  if (fog === false) next.aerialPerspectiveEnabled = false;

  const clouds = flagValue(searchParams, "clouds")
    ?? flagValue(searchParams, "cloud")
    ?? flagValue(searchParams, "volumetricClouds")
    ?? flagValue(searchParams, "volumetricclouds");
  if (clouds !== null) next.cloudsEnabled = clouds;

  const gtao = flagValue(searchParams, "gtao")
    ?? flagValue(searchParams, "ao")
    ?? flagValue(searchParams, "ambientOcclusion")
    ?? flagValue(searchParams, "ambientocclusion");
  if (gtao !== null) next.gtaoEnabled = gtao;

  const froxels = flagValue(searchParams, "froxels")
    ?? flagValue(searchParams, "froxel")
    ?? flagValue(searchParams, "volumetrics")
    ?? flagValue(searchParams, "volumetricFog")
    ?? flagValue(searchParams, "volumetricfog");
  if (froxels !== null) next.froxelsEnabled = froxels;

  const froxelDebug = searchParams.get("froxelDebug")
    ?? searchParams.get("froxelsDebug")
    ?? searchParams.get("volumetricDebug")
    ?? searchParams.get("volumetricsDebug");
  if (froxelDebug !== null) {
    // A named mode implies the overlay is on; `off` turns it back off.
    const mode = parsePostFxFroxelDebugMode(froxelDebug);
    next.froxelDebugMode = mode;
    next.froxelDebugEnabled = mode !== "off";
  }

  const bounce = flagValue(searchParams, "bounce")
    ?? flagValue(searchParams, "ssBounce")
    ?? flagValue(searchParams, "ssbounce")
    ?? flagValue(searchParams, "colorBounce")
    ?? flagValue(searchParams, "colorbounce");
  if (bounce !== null) next.bounceEnabled = bounce;

  const godRaysRaw = searchParams.get("godRays") ?? searchParams.get("godrays");
  if (godRaysRaw !== null) {
    const mode = parseGodRaysModeParam(godRaysRaw, next.godRaysMode === "off" ? "cheap" : next.godRaysMode);
    if (mode !== null) next.godRaysMode = mode;
  }

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
    const fxaa = isRecord(postprocess.fxaa) ? postprocess.fxaa : {};
    const taa = isRecord(postprocess.taa) ? postprocess.taa : {};
    const contactShadows = isRecord(postprocess.contact_shadows) ? postprocess.contact_shadows : {};
    const clarity = isRecord(postprocess.clarity) ? postprocess.clarity : {};
    const webgpu = isRecord(postprocess.webgpu) ? postprocess.webgpu : {};
    const godRays = isRecord(postprocess.god_rays) ? postprocess.god_rays : {};
    return {
      ...fallback,
      enabled: booleanValue(postprocess.enabled, fallback.enabled),
      opacity: finiteNumber(postprocess.opacity, fallback.opacity),
      renderScale: clampedRenderScale(finiteNumber(postprocess.render_scale, fallback.renderScale)),
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
      fxaaEnabled: booleanValue(fxaa.enabled, fallback.fxaaEnabled),
      fxaaEdgeThreshold: finiteNumber(fxaa.edge_threshold, fallback.fxaaEdgeThreshold),
      fxaaSubpixelBlend: finiteNumber(fxaa.subpixel_blend, fallback.fxaaSubpixelBlend),
      taaEnabled: booleanValue(taa.enabled, fallback.taaEnabled),
      taaHistoryWeight: finiteNumber(taa.history_weight, fallback.taaHistoryWeight),
      taaDepthThreshold: finiteNumber(taa.depth_threshold, fallback.taaDepthThreshold),
      taaSharpen: finiteNumber(taa.sharpen, fallback.taaSharpen),
      taaJitterEnabled: booleanValue(taa.jitter_enabled, fallback.taaJitterEnabled),
      taaJitterScale: finiteNumber(taa.jitter_scale, fallback.taaJitterScale),
      taaHistoryClampEnabled: booleanValue(taa.history_clamp_enabled, fallback.taaHistoryClampEnabled),
      taaHistoryClampStrength: finiteNumber(taa.history_clamp_strength, fallback.taaHistoryClampStrength),
      contactShadowsEnabled: booleanValue(contactShadows.enabled, fallback.contactShadowsEnabled),
      contactShadowsStrength: finiteNumber(contactShadows.strength, fallback.contactShadowsStrength),
      contactShadowsRadiusPx: finiteNumber(contactShadows.radius_px, fallback.contactShadowsRadiusPx),
      contactShadowsDepthBias: finiteNumber(contactShadows.depth_bias, fallback.contactShadowsDepthBias),
      clarityEnabled: booleanValue(clarity.enabled, fallback.clarityEnabled),
      claritySharpen: finiteNumber(clarity.sharpen, fallback.claritySharpen),
      clarityDither: finiteNumber(clarity.dither, fallback.clarityDither),
      cloudsEnabled: booleanValue(webgpu.clouds_enabled, fallback.cloudsEnabled),
      gtaoEnabled: booleanValue(webgpu.gtao_enabled, fallback.gtaoEnabled),
      froxelsEnabled: booleanValue(webgpu.froxels_enabled, fallback.froxelsEnabled),
      bounceEnabled: booleanValue(webgpu.bounce_enabled, fallback.bounceEnabled),
      godRaysMode: godRaysMode(godRays.mode, fallback.godRaysMode),
      godRaysDensity: finiteNumber(godRays.density, fallback.godRaysDensity),
      godRaysDecay: finiteNumber(godRays.decay, fallback.godRaysDecay),
      godRaysWeight: finiteNumber(godRays.weight, fallback.godRaysWeight),
      godRaysExposure: finiteNumber(godRays.exposure, fallback.godRaysExposure),
      godRaysDustStrength: finiteNumber(godRays.dust_strength, fallback.godRaysDustStrength),
      godRaysDustScale: finiteNumber(godRays.dust_scale, fallback.godRaysDustScale),
      godRaysDustSpeed: finiteNumber(godRays.dust_speed, fallback.godRaysDustSpeed),
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

/** Full-res tap counts for the frozen WebGL fallback pipeline only. */
export const GOD_RAYS_SCREEN_SAMPLES: Record<"cheap" | "heavy", number> = {
  cheap: 24,
  heavy: 60,
};

/**
 * Half-res tap counts for the WebGPU dust god-rays stage. The interleaved-gradient-noise start
 * jitter (plus TAA when enabled) makes these low counts band-free.
 */
export const GOD_RAYS_HALF_RES_SAMPLES: Record<"cheap" | "heavy", number> = {
  cheap: 16,
  heavy: 28,
};

/** Compile-time raymarch tap count for a mode in the WebGPU dust stage (0 disables the stage). */
export function godRaysHalfResSamples(mode: GodRaysMode): number {
  if (mode === "cheap") return GOD_RAYS_HALF_RES_SAMPLES.cheap;
  if (mode === "heavy" || mode === "volumetric") return GOD_RAYS_HALF_RES_SAMPLES.heavy;
  return 0;
}
