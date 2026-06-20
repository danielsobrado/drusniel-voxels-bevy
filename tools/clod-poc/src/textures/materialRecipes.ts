import { load } from "js-yaml";

export const PROCEDURAL_MATERIAL_IDS = [
  "grass",
  "rock",
  "sand",
  "snow",
  "dirt",
  "moss",
  "gravel",
  "wet_soil",
] as const;

export type ProceduralMaterialId = typeof PROCEDURAL_MATERIAL_IDS[number];

export interface ProceduralMaterialRecipe {
  base_color: [number, number, number];
  roughness: number;
  macro_strength: number;
  normal_strength: number;
  strata_strength?: number;
  moisture_bias?: number;
  sparkle_strength?: number;
}

export interface ProceduralTextureConfig {
  enabled: boolean;
  seed: number;
  runtime_mode: "cache_only" | "generate_if_missing" | "force_regenerate";
  noise: {
    resolution: number;
    periods: { value: number; fbm: number; ridged: number; worley: number };
  };
  terrain: {
    layer_resolution: number;
    macro_variation_m: [number, number];
    meso_variation_m: [number, number];
    micro_variation_m: [number, number];
    micro_normal: {
      enabled: boolean;
      fade_start_m: number;
      fade_end_m: number;
      max_strength: number;
    };
    masks: {
      slope_damp: [number, number];
      snow_height: [number, number];
      snow_upness: [number, number];
      moss_upness: [number, number];
      gravel_slope: [number, number];
      wet_height: [number, number];
      wet_upness: [number, number];
      wet_level_m: number;
      page_lod_normal_fade_m: number;
      meso_albedo_strength: number;
      wet_roughness: number;
      wet_roughness_strength: number;
      snow_tint_strength: number;
      moss_tint_strength: number;
      gravel_tint_strength: number;
      wet_tint_strength: number;
      moss_tint: [number, number, number];
      gravel_tint: [number, number, number];
      wet_tint: [number, number, number];
      snow_tint: [number, number, number];
    };
    material_order: ProceduralMaterialId[];
    materials: Record<ProceduralMaterialId, ProceduralMaterialRecipe>;
  };
  terrain_material_quality: Record<string, { max_noise_fetches: number }>;
  debug: { mode: string };
}

const defaultRecipe = (base_color: [number, number, number], roughness: number, macro_strength: number, normal_strength: number): ProceduralMaterialRecipe => ({
  base_color,
  roughness,
  macro_strength,
  normal_strength,
});

export const DEFAULT_PROCEDURAL_TEXTURE_CONFIG: ProceduralTextureConfig = {
  enabled: true,
  seed: 1337,
  runtime_mode: "generate_if_missing",
  noise: {
    resolution: 1024,
    periods: { value: 256, fbm: 64, ridged: 32, worley: 128 },
  },
  terrain: {
    layer_resolution: 1024,
    macro_variation_m: [2, 50],
    meso_variation_m: [0.8, 4],
    micro_variation_m: [0.05, 0.4],
    micro_normal: {
      enabled: true,
      fade_start_m: 45,
      fade_end_m: 85,
      max_strength: 0.35,
    },
    masks: {
      slope_damp: [0.18, 0.92],
      snow_height: [76, 130],
      snow_upness: [0.58, 0.92],
      moss_upness: [0.55, 0.92],
      gravel_slope: [0.28, 0.72],
      wet_height: [18, 28],
      wet_upness: [0.42, 0.86],
      wet_level_m: 18,
      page_lod_normal_fade_m: 16,
      meso_albedo_strength: 0.08,
      wet_roughness: 0.35,
      wet_roughness_strength: 0.3,
      snow_tint_strength: 0.22,
      moss_tint_strength: 0.08,
      gravel_tint_strength: 0.1,
      wet_tint_strength: 0.2,
      moss_tint: [0.18, 0.32, 0.13],
      gravel_tint: [0.42, 0.41, 0.39],
      wet_tint: [0.18, 0.15, 0.12],
      snow_tint: [0.86, 0.89, 0.9],
    },
    material_order: [...PROCEDURAL_MATERIAL_IDS],
    materials: {
      grass: defaultRecipe([0.24, 0.42, 0.16], 0.85, 0.22, 0.18),
      rock: { ...defaultRecipe([0.37, 0.36, 0.33], 0.78, 0.16, 0.32), strata_strength: 0.45 },
      sand: defaultRecipe([0.62, 0.54, 0.36], 0.95, 0.12, 0.08),
      snow: { ...defaultRecipe([0.82, 0.86, 0.88], 0.55, 0.06, 0.06), sparkle_strength: 0.04 },
      dirt: defaultRecipe([0.34, 0.23, 0.14], 0.92, 0.18, 0.12),
      moss: { ...defaultRecipe([0.16, 0.31, 0.13], 0.98, 0.24, 0.1), moisture_bias: 0.65 },
      gravel: defaultRecipe([0.42, 0.41, 0.39], 0.88, 0.14, 0.22),
      wet_soil: defaultRecipe([0.18, 0.13, 0.1], 0.38, 0.16, 0.1),
    },
  },
  terrain_material_quality: {
    debug_flat: { max_noise_fetches: 0 },
    procedural_macro: { max_noise_fetches: 2 },
    procedural_medium: { max_noise_fetches: 6 },
    procedural_full: { max_noise_fetches: 10 },
  },
  debug: { mode: "final" },
};

function isProceduralMaterialId(value: unknown): value is ProceduralMaterialId {
  return typeof value === "string" && (PROCEDURAL_MATERIAL_IDS as readonly string[]).includes(value);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readColor(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [
    readNumber(value[0], fallback[0]),
    readNumber(value[1], fallback[1]),
    readNumber(value[2], fallback[2]),
  ];
}

function readRange(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1])];
}

function mergeRecipe(raw: unknown, fallback: ProceduralMaterialRecipe): ProceduralMaterialRecipe {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    base_color: readColor(value.base_color, fallback.base_color),
    roughness: readNumber(value.roughness, fallback.roughness),
    macro_strength: readNumber(value.macro_strength, fallback.macro_strength),
    normal_strength: readNumber(value.normal_strength, fallback.normal_strength),
    strata_strength: value.strata_strength === undefined ? fallback.strata_strength : readNumber(value.strata_strength, fallback.strata_strength ?? 0),
    moisture_bias: value.moisture_bias === undefined ? fallback.moisture_bias : readNumber(value.moisture_bias, fallback.moisture_bias ?? 0),
    sparkle_strength: value.sparkle_strength === undefined ? fallback.sparkle_strength : readNumber(value.sparkle_strength, fallback.sparkle_strength ?? 0),
  };
}

function readQualityTiers(raw: unknown, fallback: Record<string, { max_noise_fetches: number }>): Record<string, { max_noise_fetches: number }> {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(fallback).map(([key, tier]) => {
    const rawTier = value[key] && typeof value[key] === "object" ? value[key] as Record<string, unknown> : {};
    return [key, { max_noise_fetches: Math.floor(readNumber(rawTier.max_noise_fetches, tier.max_noise_fetches)) }];
  }));
}

export function parseProceduralTextureConfig(text: string): ProceduralTextureConfig {
  const parsed = load(text) as { procedural_textures?: Record<string, unknown> } | undefined;
  const root = parsed?.procedural_textures ?? {};
  const defaults = DEFAULT_PROCEDURAL_TEXTURE_CONFIG;
  const noise = root.noise && typeof root.noise === "object" ? root.noise as Record<string, unknown> : {};
  const periods = noise.periods && typeof noise.periods === "object" ? noise.periods as Record<string, unknown> : {};
  const terrain = root.terrain && typeof root.terrain === "object" ? root.terrain as Record<string, unknown> : {};
  const micro = terrain.micro_normal && typeof terrain.micro_normal === "object" ? terrain.micro_normal as Record<string, unknown> : {};
  const masks = terrain.masks && typeof terrain.masks === "object" ? terrain.masks as Record<string, unknown> : {};
  const rawMaterials = terrain.materials && typeof terrain.materials === "object" ? terrain.materials as Record<string, unknown> : {};
  const materials = Object.fromEntries(PROCEDURAL_MATERIAL_IDS.map((id) => [
    id,
    mergeRecipe(rawMaterials[id], defaults.terrain.materials[id]),
  ])) as Record<ProceduralMaterialId, ProceduralMaterialRecipe>;
  const order = Array.isArray(terrain.material_order)
    ? terrain.material_order.filter(isProceduralMaterialId)
    : defaults.terrain.material_order;

  return {
    enabled: root.enabled === undefined ? defaults.enabled : Boolean(root.enabled),
    seed: readNumber(root.seed, defaults.seed),
    runtime_mode: root.runtime_mode === "cache_only" || root.runtime_mode === "force_regenerate" ? root.runtime_mode : "generate_if_missing",
    noise: {
      resolution: Math.floor(readNumber(noise.resolution, defaults.noise.resolution)),
      periods: {
        value: readNumber(periods.value, defaults.noise.periods.value),
        fbm: readNumber(periods.fbm, defaults.noise.periods.fbm),
        ridged: readNumber(periods.ridged, defaults.noise.periods.ridged),
        worley: readNumber(periods.worley, defaults.noise.periods.worley),
      },
    },
    terrain: {
      layer_resolution: Math.floor(readNumber(terrain.layer_resolution, defaults.terrain.layer_resolution)),
      macro_variation_m: defaults.terrain.macro_variation_m,
      meso_variation_m: defaults.terrain.meso_variation_m,
      micro_variation_m: defaults.terrain.micro_variation_m,
      micro_normal: {
        enabled: micro.enabled === undefined ? defaults.terrain.micro_normal.enabled : Boolean(micro.enabled),
        fade_start_m: readNumber(micro.fade_start_m, defaults.terrain.micro_normal.fade_start_m),
        fade_end_m: readNumber(micro.fade_end_m, defaults.terrain.micro_normal.fade_end_m),
        max_strength: readNumber(micro.max_strength, defaults.terrain.micro_normal.max_strength),
      },
      masks: {
        slope_damp: readRange(masks.slope_damp, defaults.terrain.masks.slope_damp),
        snow_height: readRange(masks.snow_height, defaults.terrain.masks.snow_height),
        snow_upness: readRange(masks.snow_upness, defaults.terrain.masks.snow_upness),
        moss_upness: readRange(masks.moss_upness, defaults.terrain.masks.moss_upness),
        gravel_slope: readRange(masks.gravel_slope, defaults.terrain.masks.gravel_slope),
        wet_height: readRange(masks.wet_height, defaults.terrain.masks.wet_height),
        wet_upness: readRange(masks.wet_upness, defaults.terrain.masks.wet_upness),
        wet_level_m: readNumber(masks.wet_level_m, defaults.terrain.masks.wet_level_m),
        page_lod_normal_fade_m: readNumber(masks.page_lod_normal_fade_m, defaults.terrain.masks.page_lod_normal_fade_m),
        meso_albedo_strength: readNumber(masks.meso_albedo_strength, defaults.terrain.masks.meso_albedo_strength),
        wet_roughness: readNumber(masks.wet_roughness, defaults.terrain.masks.wet_roughness),
        wet_roughness_strength: readNumber(masks.wet_roughness_strength, defaults.terrain.masks.wet_roughness_strength),
        snow_tint_strength: readNumber(masks.snow_tint_strength, defaults.terrain.masks.snow_tint_strength),
        moss_tint_strength: readNumber(masks.moss_tint_strength, defaults.terrain.masks.moss_tint_strength),
        gravel_tint_strength: readNumber(masks.gravel_tint_strength, defaults.terrain.masks.gravel_tint_strength),
        wet_tint_strength: readNumber(masks.wet_tint_strength, defaults.terrain.masks.wet_tint_strength),
        moss_tint: readColor(masks.moss_tint, defaults.terrain.masks.moss_tint),
        gravel_tint: readColor(masks.gravel_tint, defaults.terrain.masks.gravel_tint),
        wet_tint: readColor(masks.wet_tint, defaults.terrain.masks.wet_tint),
        snow_tint: readColor(masks.snow_tint, defaults.terrain.masks.snow_tint),
      },
      material_order: order.length > 0 ? order : defaults.terrain.material_order,
      materials,
    },
    terrain_material_quality: readQualityTiers(root.terrain_material_quality, defaults.terrain_material_quality),
    debug: { mode: typeof root.debug === "object" && root.debug !== null && typeof (root.debug as Record<string, unknown>).mode === "string" ? (root.debug as Record<string, string>).mode : "final" },
  };
}
