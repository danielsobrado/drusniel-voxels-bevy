import { load } from "js-yaml";
import configYaml from "../../config/long_view_materials.yaml?raw";

export type MaterialQuality =
  | "full_debug"
  | "slope_tint_debug"
  | "single_projection_far"
  | "horizon_proxy"
  | "atlas_only_debug";

const ALLOWED_QUALITIES: readonly MaterialQuality[] = [
  "full_debug",
  "slope_tint_debug",
  "single_projection_far",
  "horizon_proxy",
  "atlas_only_debug",
];

export interface TerrainBandConfig {
  waterline_m: number;
  sand_max_height_m: number;
  grass_max_slope: number;
  dirt_max_slope: number;
  rock_min_slope: number;
  snow_min_height_m: number;
  snow_min_slope: number;
}

export interface MacroVariationConfig {
  enabled: boolean;
  world_scale_1: number;
  world_scale_2: number;
  strength: number;
  slope_strength: number;
  height_strength: number;
}

export interface FarNormalConfig {
  mode: string;
  strength: number;
  finite_difference_m: number;
  flatten_with_distance: boolean;
  flatten_start_m: number;
  flatten_end_m: number;
}

export interface LightingConfig {
  hemisphere_strength: number;
  sun_strength: number;
  wrap_lighting: number;
  roughness: number;
  ambient_floor: number;
}

export interface HazeConfig {
  enabled: boolean;
  start_m: number;
  end_m: number;
  color: [number, number, number];
  strength: number;
  height_falloff: number;
}

export interface SeamBlendConfig {
  page_to_shell_blend_m: number;
  shell_inner_drop_m: number;
  normal_blend_m: number;
  material_blend_m: number;
}

export interface DebugConfig {
  show_material_bands: boolean;
  show_slope: boolean;
  show_macro_noise: boolean;
  show_far_normals: boolean;
  show_haze_factor: boolean;
  freeze_material_lod: boolean;
}

export interface MaterialQualityConfig {
  default: MaterialQuality;
  allowed: readonly MaterialQuality[];
}

export interface LongViewMaterialsConfig {
  enabled: boolean;
  material_quality: MaterialQualityConfig;
  terrain_bands: TerrainBandConfig;
  macro_variation: MacroVariationConfig;
  far_normals: FarNormalConfig;
  lighting: LightingConfig;
  haze: HazeConfig;
  seam_blend: SeamBlendConfig;
  debug: DebugConfig;
}

const DEFAULT_CONFIG: LongViewMaterialsConfig = {
  enabled: true,
  material_quality: {
    default: "horizon_proxy",
    allowed: ALLOWED_QUALITIES,
  },
  terrain_bands: {
    waterline_m: 0.0,
    sand_max_height_m: 4.0,
    grass_max_slope: 0.62,
    dirt_max_slope: 0.82,
    rock_min_slope: 0.72,
    snow_min_height_m: 96.0,
    snow_min_slope: 0.15,
  },
  macro_variation: {
    enabled: true,
    world_scale_1: 180.0,
    world_scale_2: 720.0,
    strength: 0.18,
    slope_strength: 0.12,
    height_strength: 0.10,
  },
  far_normals: {
    mode: "analytic_summary",
    strength: 0.65,
    finite_difference_m: 8.0,
    flatten_with_distance: true,
    flatten_start_m: 2200.0,
    flatten_end_m: 4096.0,
  },
  lighting: {
    hemisphere_strength: 0.45,
    sun_strength: 0.85,
    wrap_lighting: 0.20,
    roughness: 0.92,
    ambient_floor: 0.16,
  },
  haze: {
    enabled: true,
    start_m: 1800.0,
    end_m: 4096.0,
    color: [0.62, 0.70, 0.76] as [number, number, number],
    strength: 0.72,
    height_falloff: 0.035,
  },
  seam_blend: {
    page_to_shell_blend_m: 160.0,
    shell_inner_drop_m: 2.0,
    normal_blend_m: 128.0,
    material_blend_m: 192.0,
  },
  debug: {
    show_material_bands: false,
    show_slope: false,
    show_macro_noise: false,
    show_far_normals: false,
    show_haze_factor: false,
    freeze_material_lod: false,
  },
};

function getDefault(key: string): unknown {
  const parts = key.split(".");
  let obj: unknown = DEFAULT_CONFIG;
  for (const p of parts) {
    if (obj && typeof obj === "object") obj = (obj as Record<string, unknown>)[p];
    else return undefined;
  }
  return obj;
}

function clampNumeric(value: unknown, min: number, max: number, key: string, warn: boolean): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    if (warn) console.warn(`[LongViewMaterialsConfig] Invalid numeric value for "${key}", using default.`);
    const def = getDefault(key);
    return typeof def === "number" ? def : 0;
  }
  return Math.min(max, Math.max(min, n));
}

function parseBool(value: unknown, key: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  const def = getDefault(key);
  return typeof def === "boolean" ? def : false;
}

function parseQuality(value: unknown, logWarning: boolean): MaterialQuality {
  const s = String(value).trim();
  if (ALLOWED_QUALITIES.includes(s as MaterialQuality)) return s as MaterialQuality;
  if (logWarning) console.warn(`[LongViewMaterialsConfig] Invalid material quality "${s}", allowed: ${ALLOWED_QUALITIES.join(", ")}, using default "${DEFAULT_CONFIG.material_quality.default}".`);
  return DEFAULT_CONFIG.material_quality.default;
}

function parseVec3(value: unknown, key: string): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) {
    return DEFAULT_CONFIG.haze.color;
  }
  const c0 = clampNumeric(value[0], 0, 1, `${key}[0]`, false);
  const c1 = clampNumeric(value[1], 0, 1, `${key}[1]`, false);
  const c2 = clampNumeric(value[2], 0, 1, `${key}[2]`, false);
  return [c0, c1, c2];
}

export interface OverrideFlags {
  terrainMaterial?: string;
  debugMaterialBands?: boolean;
  debugSlope?: boolean;
  debugMacroNoise?: boolean;
  debugFarNormals?: boolean;
  debugHaze?: boolean;
  freezeMaterialLod?: boolean;
}

export function loadLongViewMaterialsConfig(yamlText?: string, overrides?: OverrideFlags): LongViewMaterialsConfig {
  let cfg: LongViewMaterialsConfig;
  const yamlSrc = yamlText ?? configYaml;
  try {
    const parsed = load(yamlSrc) as Record<string, unknown>;
    const root = parsed?.long_view_materials as Record<string, unknown> | undefined;
    if (!root || typeof root !== "object") {
      console.warn("[LongViewMaterialsConfig] Config missing 'long_view_materials' key, using defaults.");
      cfg = { ...DEFAULT_CONFIG };
      cfg.material_quality = { ...DEFAULT_CONFIG.material_quality };
      Object.assign(cfg, DEFAULT_CONFIG);
    } else {
      cfg = parseConfigObject(root, false);
    }
  } catch (e) {
    console.warn(`[LongViewMaterialsConfig] Failed to parse YAML: ${e instanceof Error ? e.message : String(e)}. Using defaults.`);
    cfg = { ...DEFAULT_CONFIG };
  }

  if (overrides) {
    cfg.material_quality = { ...cfg.material_quality };
    if (overrides.terrainMaterial !== undefined) {
      cfg.material_quality.default = parseQuality(overrides.terrainMaterial, true);
    }
    cfg.debug = { ...cfg.debug };
    if (overrides.debugMaterialBands !== undefined) cfg.debug.show_material_bands = overrides.debugMaterialBands;
    if (overrides.debugSlope !== undefined) cfg.debug.show_slope = overrides.debugSlope;
    if (overrides.debugMacroNoise !== undefined) cfg.debug.show_macro_noise = overrides.debugMacroNoise;
    if (overrides.debugFarNormals !== undefined) cfg.debug.show_far_normals = overrides.debugFarNormals;
    if (overrides.debugHaze !== undefined) cfg.debug.show_haze_factor = overrides.debugHaze;
    if (overrides.freezeMaterialLod !== undefined) cfg.debug.freeze_material_lod = overrides.freezeMaterialLod;
  }

  return cfg;
}

function parseConfigObject(root: Record<string, unknown>, _warn: boolean): LongViewMaterialsConfig {
  const cfg: LongViewMaterialsConfig = {
    enabled: root.enabled !== undefined ? parseBool(root.enabled, "enabled") : DEFAULT_CONFIG.enabled,
    material_quality: { ...DEFAULT_CONFIG.material_quality },
    terrain_bands: { ...DEFAULT_CONFIG.terrain_bands },
    macro_variation: { ...DEFAULT_CONFIG.macro_variation },
    far_normals: { ...DEFAULT_CONFIG.far_normals },
    lighting: { ...DEFAULT_CONFIG.lighting },
    haze: { ...DEFAULT_CONFIG.haze },
    seam_blend: { ...DEFAULT_CONFIG.seam_blend },
    debug: { ...DEFAULT_CONFIG.debug },
  };

  if (root.material_quality && typeof root.material_quality === "object") {
    const mq = root.material_quality as Record<string, unknown>;
    if (mq.default !== undefined) cfg.material_quality.default = parseQuality(mq.default, true);
  }

  if (root.terrain_bands && typeof root.terrain_bands === "object") {
    const tb = root.terrain_bands as Record<string, unknown>;
    if (tb.waterline_m !== undefined) cfg.terrain_bands.waterline_m = clampNumeric(tb.waterline_m, -100, 100, "terrain_bands.waterline_m", true);
    if (tb.sand_max_height_m !== undefined) cfg.terrain_bands.sand_max_height_m = clampNumeric(tb.sand_max_height_m, 0, 200, "terrain_bands.sand_max_height_m", true);
    if (tb.grass_max_slope !== undefined) cfg.terrain_bands.grass_max_slope = clampNumeric(tb.grass_max_slope, 0, 1, "terrain_bands.grass_max_slope", true);
    if (tb.dirt_max_slope !== undefined) cfg.terrain_bands.dirt_max_slope = clampNumeric(tb.dirt_max_slope, 0, 1, "terrain_bands.dirt_max_slope", true);
    if (tb.rock_min_slope !== undefined) cfg.terrain_bands.rock_min_slope = clampNumeric(tb.rock_min_slope, 0, 1, "terrain_bands.rock_min_slope", true);
    if (tb.snow_min_height_m !== undefined) cfg.terrain_bands.snow_min_height_m = clampNumeric(tb.snow_min_height_m, 0, 500, "terrain_bands.snow_min_height_m", true);
    if (tb.snow_min_slope !== undefined) cfg.terrain_bands.snow_min_slope = clampNumeric(tb.snow_min_slope, 0, 1, "terrain_bands.snow_min_slope", true);
  }

  if (root.macro_variation && typeof root.macro_variation === "object") {
    const mv = root.macro_variation as Record<string, unknown>;
    if (mv.enabled !== undefined) cfg.macro_variation.enabled = parseBool(mv.enabled, "macro_variation.enabled");
    if (mv.world_scale_1 !== undefined) cfg.macro_variation.world_scale_1 = clampNumeric(mv.world_scale_1, 1, 10000, "macro_variation.world_scale_1", true);
    if (mv.world_scale_2 !== undefined) cfg.macro_variation.world_scale_2 = clampNumeric(mv.world_scale_2, 1, 10000, "macro_variation.world_scale_2", true);
    if (mv.strength !== undefined) cfg.macro_variation.strength = clampNumeric(mv.strength, 0, 1, "macro_variation.strength", true);
    if (mv.slope_strength !== undefined) cfg.macro_variation.slope_strength = clampNumeric(mv.slope_strength, 0, 1, "macro_variation.slope_strength", true);
    if (mv.height_strength !== undefined) cfg.macro_variation.height_strength = clampNumeric(mv.height_strength, 0, 1, "macro_variation.height_strength", true);
  }

  if (root.far_normals && typeof root.far_normals === "object") {
    const fn = root.far_normals as Record<string, unknown>;
    if (fn.mode !== undefined) cfg.far_normals.mode = String(fn.mode);
    if (fn.strength !== undefined) cfg.far_normals.strength = clampNumeric(fn.strength, 0, 2, "far_normals.strength", true);
    if (fn.finite_difference_m !== undefined) cfg.far_normals.finite_difference_m = clampNumeric(fn.finite_difference_m, 0.1, 100, "far_normals.finite_difference_m", true);
    if (fn.flatten_with_distance !== undefined) cfg.far_normals.flatten_with_distance = parseBool(fn.flatten_with_distance, "far_normals.flatten_with_distance");
    if (fn.flatten_start_m !== undefined) cfg.far_normals.flatten_start_m = clampNumeric(fn.flatten_start_m, 0, 10000, "far_normals.flatten_start_m", true);
    if (fn.flatten_end_m !== undefined) cfg.far_normals.flatten_end_m = clampNumeric(fn.flatten_end_m, 0, 10000, "far_normals.flatten_end_m", true);
  }

  if (root.lighting && typeof root.lighting === "object") {
    const li = root.lighting as Record<string, unknown>;
    if (li.hemisphere_strength !== undefined) cfg.lighting.hemisphere_strength = clampNumeric(li.hemisphere_strength, 0, 2, "lighting.hemisphere_strength", true);
    if (li.sun_strength !== undefined) cfg.lighting.sun_strength = clampNumeric(li.sun_strength, 0, 2, "lighting.sun_strength", true);
    if (li.wrap_lighting !== undefined) cfg.lighting.wrap_lighting = clampNumeric(li.wrap_lighting, 0, 1, "lighting.wrap_lighting", true);
    if (li.roughness !== undefined) cfg.lighting.roughness = clampNumeric(li.roughness, 0, 1, "lighting.roughness", true);
    if (li.ambient_floor !== undefined) cfg.lighting.ambient_floor = clampNumeric(li.ambient_floor, 0, 1, "lighting.ambient_floor", true);
  }

  if (root.haze && typeof root.haze === "object") {
    const hz = root.haze as Record<string, unknown>;
    if (hz.enabled !== undefined) cfg.haze.enabled = parseBool(hz.enabled, "haze.enabled");
    if (hz.start_m !== undefined) cfg.haze.start_m = clampNumeric(hz.start_m, 0, 10000, "haze.start_m", true);
    if (hz.end_m !== undefined) cfg.haze.end_m = clampNumeric(hz.end_m, 0, 10000, "haze.end_m", true);
    if (hz.color !== undefined) cfg.haze.color = parseVec3(hz.color, "haze.color");
    if (hz.strength !== undefined) cfg.haze.strength = clampNumeric(hz.strength, 0, 1, "haze.strength", true);
    if (hz.height_falloff !== undefined) cfg.haze.height_falloff = clampNumeric(hz.height_falloff, 0, 1, "haze.height_falloff", true);
  }

  if (root.seam_blend && typeof root.seam_blend === "object") {
    const sb = root.seam_blend as Record<string, unknown>;
    if (sb.page_to_shell_blend_m !== undefined) cfg.seam_blend.page_to_shell_blend_m = clampNumeric(sb.page_to_shell_blend_m, 0, 1000, "seam_blend.page_to_shell_blend_m", true);
    if (sb.shell_inner_drop_m !== undefined) cfg.seam_blend.shell_inner_drop_m = clampNumeric(sb.shell_inner_drop_m, 0, 50, "seam_blend.shell_inner_drop_m", true);
    if (sb.normal_blend_m !== undefined) cfg.seam_blend.normal_blend_m = clampNumeric(sb.normal_blend_m, 0, 1000, "seam_blend.normal_blend_m", true);
    if (sb.material_blend_m !== undefined) cfg.seam_blend.material_blend_m = clampNumeric(sb.material_blend_m, 0, 1000, "seam_blend.material_blend_m", true);
  }

  if (root.debug && typeof root.debug === "object") {
    const db = root.debug as Record<string, unknown>;
    if (db.show_material_bands !== undefined) cfg.debug.show_material_bands = parseBool(db.show_material_bands, "debug.show_material_bands");
    if (db.show_slope !== undefined) cfg.debug.show_slope = parseBool(db.show_slope, "debug.show_slope");
    if (db.show_macro_noise !== undefined) cfg.debug.show_macro_noise = parseBool(db.show_macro_noise, "debug.show_macro_noise");
    if (db.show_far_normals !== undefined) cfg.debug.show_far_normals = parseBool(db.show_far_normals, "debug.show_far_normals");
    if (db.show_haze_factor !== undefined) cfg.debug.show_haze_factor = parseBool(db.show_haze_factor, "debug.show_haze_factor");
    if (db.freeze_material_lod !== undefined) cfg.debug.freeze_material_lod = parseBool(db.freeze_material_lod, "debug.freeze_material_lod");
  }

  return cfg;
}

export function parseQueryOverrides(searchParams: URLSearchParams): OverrideFlags {
  const overrides: OverrideFlags = {};
  const terrainMaterial = searchParams.get("terrainMaterial");
  if (terrainMaterial !== null) overrides.terrainMaterial = terrainMaterial;
  if (searchParams.get("debugMaterialBands") === "1") overrides.debugMaterialBands = true;
  if (searchParams.get("debugSlope") === "1") overrides.debugSlope = true;
  if (searchParams.get("debugMacroNoise") === "1") overrides.debugMacroNoise = true;
  if (searchParams.get("debugFarNormals") === "1") overrides.debugFarNormals = true;
  if (searchParams.get("debugHaze") === "1") overrides.debugHaze = true;
  if (searchParams.get("freezeMaterialLod") === "1") overrides.freezeMaterialLod = true;
  return overrides;
}
