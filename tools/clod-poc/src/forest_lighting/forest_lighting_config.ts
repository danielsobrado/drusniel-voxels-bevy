import { load } from "js-yaml";

export type ForestLightingDebugMode = "off" | "canopy" | "ao" | "shadow" | "fog" | "sun_shafts" | "combined";

export interface ForestLightingFieldSettings {
  resolution: number;
  updateDistanceM: number;
  maxUpdatePagesPerFrame: number;
  blurRadiusCells: number;
  canopyInfluenceRadiusM: number;
  understoryInfluenceRadiusM: number;
  densityFalloffPower: number;
}

export interface ForestLightingCanopySettings {
  enabled: boolean;
  minTreeScale: number;
  heightWeight: number;
  crownRadiusWeight: number;
  densityStrength: number;
  edgeSoftness: number;
}

export interface ForestLightingAoSettings {
  enabled: boolean;
  strength: number;
  minOcclusion: number;
  maxOcclusion: number;
  terrainContactStrength: number;
  understoryStrength: number;
}

export interface ForestLightingShadowProxySettings {
  enabled: boolean;
  strength: number;
  sunDirectionWeight: number;
  projectionDistanceM: number;
  softnessM: number;
  maxShadow: number;
}

export interface ForestLightingAtmosphereSettings {
  enabled: boolean;
  forestFogStrength: number;
  forestFogHeightM: number;
  edgeFogBoost: number;
  aerialTintStrength: number;
  sunShaftsStrength: number;
  sunShaftsThreshold: number;
}

export interface ForestLightingMaterialIntegrationSettings {
  terrainEnabled: boolean;
  treeEnabled: boolean;
  understoryEnabled: boolean;
  debugMode: ForestLightingDebugMode;
}

export interface ForestLightingSettings {
  enabled: boolean;
  seed: number;
  field: ForestLightingFieldSettings;
  canopy: ForestLightingCanopySettings;
  ambientOcclusion: ForestLightingAoSettings;
  shadowProxy: ForestLightingShadowProxySettings;
  atmosphere: ForestLightingAtmosphereSettings;
  materialIntegration: ForestLightingMaterialIntegrationSettings;
}

interface ForestLightingYamlConfig {
  forest_lighting?: {
    enabled?: boolean;
    seed?: number;
    field?: {
      resolution?: number;
      update_distance_m?: number;
      max_update_pages_per_frame?: number;
      blur_radius_cells?: number;
      canopy_influence_radius_m?: number;
      understory_influence_radius_m?: number;
      density_falloff_power?: number;
    };
    canopy?: {
      enabled?: boolean;
      min_tree_scale?: number;
      height_weight?: number;
      crown_radius_weight?: number;
      density_strength?: number;
      edge_softness?: number;
    };
    ambient_occlusion?: {
      enabled?: boolean;
      strength?: number;
      min_occlusion?: number;
      max_occlusion?: number;
      terrain_contact_strength?: number;
      understory_strength?: number;
    };
    shadow_proxy?: {
      enabled?: boolean;
      strength?: number;
      sun_direction_weight?: number;
      projection_distance_m?: number;
      softness_m?: number;
      max_shadow?: number;
    };
    atmosphere?: {
      enabled?: boolean;
      forest_fog_strength?: number;
      forest_fog_height_m?: number;
      edge_fog_boost?: number;
      aerial_tint_strength?: number;
      sun_shafts_strength?: number;
      sun_shafts_threshold?: number;
    };
    material_integration?: {
      terrain_enabled?: boolean;
      tree_enabled?: boolean;
      understory_enabled?: boolean;
      debug_mode?: unknown;
    };
  };
}

export const DEFAULT_FOREST_LIGHTING_SETTINGS: ForestLightingSettings = {
  enabled: true,
  seed: 42491,
  field: {
    resolution: 128,
    updateDistanceM: 8,
    maxUpdatePagesPerFrame: 2,
    blurRadiusCells: 2,
    canopyInfluenceRadiusM: 7.5,
    understoryInfluenceRadiusM: 2.5,
    densityFalloffPower: 2.0,
  },
  canopy: {
    enabled: true,
    minTreeScale: 0.35,
    heightWeight: 0.65,
    crownRadiusWeight: 1.0,
    densityStrength: 0.85,
    edgeSoftness: 0.45,
  },
  ambientOcclusion: {
    enabled: true,
    strength: 0.32,
    minOcclusion: 0.0,
    maxOcclusion: 0.72,
    terrainContactStrength: 0.18,
    understoryStrength: 0.12,
  },
  shadowProxy: {
    enabled: true,
    strength: 0.28,
    sunDirectionWeight: 0.55,
    projectionDistanceM: 9,
    softnessM: 5,
    maxShadow: 0.65,
  },
  atmosphere: {
    enabled: true,
    forestFogStrength: 0.22,
    forestFogHeightM: 12,
    edgeFogBoost: 0.18,
    aerialTintStrength: 0.12,
    sunShaftsStrength: 0.18,
    sunShaftsThreshold: 0.55,
  },
  materialIntegration: {
    terrainEnabled: true,
    treeEnabled: true,
    understoryEnabled: true,
    debugMode: "off",
  },
};

export function cloneForestLightingSettings(
  settings: ForestLightingSettings = DEFAULT_FOREST_LIGHTING_SETTINGS,
): ForestLightingSettings {
  return {
    ...settings,
    field: { ...settings.field },
    canopy: { ...settings.canopy },
    ambientOcclusion: { ...settings.ambientOcclusion },
    shadowProxy: { ...settings.shadowProxy },
    atmosphere: { ...settings.atmosphere },
    materialIntegration: { ...settings.materialIntegration },
  };
}

export function parseForestLightingConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): ForestLightingSettings {
  const fallback = cloneForestLightingSettings();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: ForestLightingYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as ForestLightingYamlConfig;
  } catch (error) {
    warn?.(`[forest-lighting-config] failed to parse config/forest_lighting.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }

  const raw = rawConfig.forest_lighting ?? {};
  const minOcclusion = readFraction(raw.ambient_occlusion?.min_occlusion, fallback.ambientOcclusion.minOcclusion);
  const maxOcclusion = Math.max(
    minOcclusion,
    readFraction(raw.ambient_occlusion?.max_occlusion, fallback.ambientOcclusion.maxOcclusion),
  );
  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    field: {
      resolution: readIntegerInRange(raw.field?.resolution, fallback.field.resolution, 32, 512),
      updateDistanceM: readNumberAtLeast(raw.field?.update_distance_m, fallback.field.updateDistanceM, 0),
      maxUpdatePagesPerFrame: readIntegerInRange(
        raw.field?.max_update_pages_per_frame,
        fallback.field.maxUpdatePagesPerFrame,
        1,
        128,
      ),
      blurRadiusCells: readIntegerInRange(raw.field?.blur_radius_cells, fallback.field.blurRadiusCells, 0, 16),
      canopyInfluenceRadiusM: readNumberInRange(
        raw.field?.canopy_influence_radius_m,
        fallback.field.canopyInfluenceRadiusM,
        0.1,
        256,
      ),
      understoryInfluenceRadiusM: readNumberInRange(
        raw.field?.understory_influence_radius_m,
        fallback.field.understoryInfluenceRadiusM,
        0.1,
        128,
      ),
      densityFalloffPower: readNumberInRange(
        raw.field?.density_falloff_power,
        fallback.field.densityFalloffPower,
        0.1,
        8,
      ),
    },
    canopy: {
      enabled: readBoolean(raw.canopy?.enabled, fallback.canopy.enabled),
      minTreeScale: readNumberInRange(raw.canopy?.min_tree_scale, fallback.canopy.minTreeScale, 0, 16),
      heightWeight: readFraction(raw.canopy?.height_weight, fallback.canopy.heightWeight),
      crownRadiusWeight: readNumberInRange(raw.canopy?.crown_radius_weight, fallback.canopy.crownRadiusWeight, 0, 4),
      densityStrength: readFraction(raw.canopy?.density_strength, fallback.canopy.densityStrength),
      edgeSoftness: readFraction(raw.canopy?.edge_softness, fallback.canopy.edgeSoftness),
    },
    ambientOcclusion: {
      enabled: readBoolean(raw.ambient_occlusion?.enabled, fallback.ambientOcclusion.enabled),
      strength: readFraction(raw.ambient_occlusion?.strength, fallback.ambientOcclusion.strength),
      minOcclusion,
      maxOcclusion,
      terrainContactStrength: readFraction(
        raw.ambient_occlusion?.terrain_contact_strength,
        fallback.ambientOcclusion.terrainContactStrength,
      ),
      understoryStrength: readFraction(
        raw.ambient_occlusion?.understory_strength,
        fallback.ambientOcclusion.understoryStrength,
      ),
    },
    shadowProxy: {
      enabled: readBoolean(raw.shadow_proxy?.enabled, fallback.shadowProxy.enabled),
      strength: readFraction(raw.shadow_proxy?.strength, fallback.shadowProxy.strength),
      sunDirectionWeight: readFraction(raw.shadow_proxy?.sun_direction_weight, fallback.shadowProxy.sunDirectionWeight),
      projectionDistanceM: readNumberAtLeast(
        raw.shadow_proxy?.projection_distance_m,
        fallback.shadowProxy.projectionDistanceM,
        0,
      ),
      softnessM: readNumberAtLeast(raw.shadow_proxy?.softness_m, fallback.shadowProxy.softnessM, 0),
      maxShadow: readFraction(raw.shadow_proxy?.max_shadow, fallback.shadowProxy.maxShadow),
    },
    atmosphere: {
      enabled: readBoolean(raw.atmosphere?.enabled, fallback.atmosphere.enabled),
      forestFogStrength: readFraction(raw.atmosphere?.forest_fog_strength, fallback.atmosphere.forestFogStrength),
      forestFogHeightM: readNumberAtLeast(raw.atmosphere?.forest_fog_height_m, fallback.atmosphere.forestFogHeightM, 0),
      edgeFogBoost: readFraction(raw.atmosphere?.edge_fog_boost, fallback.atmosphere.edgeFogBoost),
      aerialTintStrength: readFraction(raw.atmosphere?.aerial_tint_strength, fallback.atmosphere.aerialTintStrength),
      sunShaftsStrength: readFraction(raw.atmosphere?.sun_shafts_strength, fallback.atmosphere.sunShaftsStrength),
      sunShaftsThreshold: readFraction(raw.atmosphere?.sun_shafts_threshold, fallback.atmosphere.sunShaftsThreshold),
    },
    materialIntegration: {
      terrainEnabled: readBoolean(raw.material_integration?.terrain_enabled, fallback.materialIntegration.terrainEnabled),
      treeEnabled: readBoolean(raw.material_integration?.tree_enabled, fallback.materialIntegration.treeEnabled),
      understoryEnabled: readBoolean(
        raw.material_integration?.understory_enabled,
        fallback.materialIntegration.understoryEnabled,
      ),
      debugMode: readDebugMode(raw.material_integration?.debug_mode, fallback.materialIntegration.debugMode),
    },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(readNumber(value, fallback), min, max);
}

function readIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(readNumberInRange(value, fallback, min, max));
}

function readFraction(value: unknown, fallback: number): number {
  return readNumberInRange(value, fallback, 0, 1);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readDebugMode(value: unknown, fallback: ForestLightingDebugMode): ForestLightingDebugMode {
  return value === "off" || value === "canopy" || value === "ao" || value === "shadow" ||
    value === "fog" || value === "sun_shafts" || value === "combined"
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
