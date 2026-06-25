import { load } from "js-yaml";
import type {
  CustomPropsSettings,
  PropAssetDef,
  PropCategory,
  PropCategoryBudget,
  PropCullingPolicy,
  PropCullingSettings,
  PropDebugSettings,
  PropLightingProxy,
  PropLodPolicy,
  PropPlacementRules,
  PropShadowSettings,
  PropSpatialSettings,
} from "./prop_types.js";

export const PROP_CATEGORIES: readonly PropCategory[] = [
  "small_decor",
  "medium_static",
  "large_static",
  "vegetation",
  "interactive",
] as const;

const DEFAULT_CATEGORY_BUDGETS: Record<PropCategory, PropCategoryBudget> = {
  small_decor: { maxTriangles: 800, maxMaterials: 2, maxDrawParts: 4, maxTexturePx: 1024 },
  medium_static: { maxTriangles: 8000, maxMaterials: 4, maxDrawParts: 8, maxTexturePx: 2048 },
  large_static: { maxTriangles: 32000, maxMaterials: 6, maxDrawParts: 12, maxTexturePx: 4096 },
  vegetation: { maxTriangles: 12000, maxMaterials: 4, maxDrawParts: 8, maxTexturePx: 2048 },
  interactive: { maxTriangles: 16000, maxMaterials: 6, maxDrawParts: 10, maxTexturePx: 2048 },
};

export const DEFAULT_CUSTOM_PROPS_SETTINGS: CustomPropsSettings = {
  enabled: false,
  props: [],
  spatial: {
    cellSizeM: 64,
    maxInstancesPerCellWarning: 512,
    farCellUpdateIntervalFrames: 8,
  },
  culling: {
    cellFrustumCulling: true,
    cellDistanceCulling: true,
    perInstanceFrustumCullingForLargeProps: true,
    perInstanceCullingMinRadius: 1.5,
    farUpdateIntervalFrames: 8,
    hysteresisM: 8,
  },
  shadows: {
    maxShadowProps: 512,
  },
  categoryBudgets: { ...DEFAULT_CATEGORY_BUDGETS },
  debug: {
    showCells: false,
    showBounds: false,
    lodColorOverlay: false,
    billboardOverlay: false,
  },
};

interface YamlRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as YamlRecord) : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function parsePlacement(raw: YamlRecord | undefined, fallback: PropPlacementRules): PropPlacementRules {
  if (!raw) return { ...fallback };
  return {
    alignToTerrain: bool(raw.align_to_terrain ?? raw.alignToTerrain, fallback.alignToTerrain),
    terrainConform: bool(raw.terrain_conform ?? raw.terrainConform, fallback.terrainConform),
    snapToGrid: bool(raw.snap_to_grid ?? raw.snapToGrid, fallback.snapToGrid),
    flattenRadius:
      raw.flatten_radius !== undefined || raw.flattenRadius !== undefined
        ? num(raw.flatten_radius ?? raw.flattenRadius, 0)
        : fallback.flattenRadius,
    slopeLimitDegrees:
      raw.slope_limit_degrees !== undefined || raw.slopeLimitDegrees !== undefined
        ? num(raw.slope_limit_degrees ?? raw.slopeLimitDegrees, 0)
        : fallback.slopeLimitDegrees,
  };
}

function parseLod(raw: YamlRecord | undefined, fallback: PropLodPolicy): PropLodPolicy {
  if (!raw) return { ...fallback, distances: [...fallback.distances], triangleRatios: [...fallback.triangleRatios] };
  const mode = raw.mode === "provided" ? "provided" : "generated";
  return {
    mode,
    distances: numArray(raw.distances, fallback.distances),
    triangleRatios: numArray(raw.triangle_ratios ?? raw.triangleRatios, fallback.triangleRatios),
    billboardFrom:
      raw.billboard_from !== undefined || raw.billboardFrom !== undefined
        ? num(raw.billboard_from ?? raw.billboardFrom, 0)
        : fallback.billboardFrom,
    hysteresis: num(raw.hysteresis, fallback.hysteresis),
  };
}

function parseCulling(raw: YamlRecord | undefined, fallback: PropCullingPolicy): PropCullingPolicy {
  if (!raw) return { ...fallback };
  return {
    maxDistance: num(raw.max_distance ?? raw.maxDistance, fallback.maxDistance),
    shadowDistance: num(raw.shadow_distance ?? raw.shadowDistance, fallback.shadowDistance),
    reflectionDistance: num(raw.reflection_distance ?? raw.reflectionDistance, fallback.reflectionDistance),
    minScreenPx: num(raw.min_screen_px ?? raw.minScreenPx, fallback.minScreenPx),
  };
}

function parseLightingProxy(raw: YamlRecord | undefined): PropLightingProxy | undefined {
  if (!raw) return undefined;
  return {
    mode: raw.mode === "coarse_bounds" ? "coarse_bounds" : "none",
    affectGi: bool(raw.affect_gi ?? raw.affectGi, false),
    affectFog: bool(raw.affect_fog ?? raw.affectFog, false),
  };
}

function parsePropDef(raw: YamlRecord): PropAssetDef | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const source = typeof raw.source === "string" ? raw.source.trim() : "";
  const category = raw.category;
  if (!id || !source || typeof category !== "string" || !PROP_CATEGORIES.includes(category as PropCategory)) {
    return null;
  }
  const placementRaw = asRecord(raw.placement);
  const lodRaw = asRecord(raw.lod);
  const cullingRaw = asRecord(raw.culling);
  const collisionRaw = asRecord(raw.collision);
  const defaultPlacement: PropPlacementRules = {
    alignToTerrain: true,
    terrainConform: false,
    snapToGrid: false,
  };
  const defaultLod: PropLodPolicy = {
    mode: "generated",
    distances: [0, 40, 90],
    triangleRatios: [1.0, 0.5, 0.25],
    hysteresis: 10,
  };
  const defaultCulling: PropCullingPolicy = {
    maxDistance: 180,
    shadowDistance: 48,
    reflectionDistance: 80,
    minScreenPx: 4,
  };
  const collisionMode = collisionRaw?.mode;
  const validCollision =
    collisionMode === "none" ||
    collisionMode === "box" ||
    collisionMode === "convex" ||
    collisionMode === "trimesh_near_only"
      ? collisionMode
      : "box";
  return {
    id,
    source,
    category: category as PropCategory,
    placement: parsePlacement(placementRaw, defaultPlacement),
    lod: parseLod(lodRaw, defaultLod),
    culling: parseCulling(cullingRaw, defaultCulling),
    collision: {
      mode: validCollision,
      distance: num(collisionRaw?.distance, 48),
    },
    lightingProxy: parseLightingProxy(asRecord(raw.lighting_proxy ?? raw.lightingProxy)),
  };
}

function parseCategoryBudget(raw: YamlRecord | undefined, fallback: PropCategoryBudget): PropCategoryBudget {
  if (!raw) return { ...fallback };
  return {
    maxTriangles: num(raw.max_triangles ?? raw.maxTriangles, fallback.maxTriangles),
    maxMaterials: num(raw.max_materials ?? raw.maxMaterials, fallback.maxMaterials),
    maxDrawParts: num(raw.max_draw_parts ?? raw.maxDrawParts, fallback.maxDrawParts),
    maxTexturePx: num(raw.max_texture_px ?? raw.maxTexturePx, fallback.maxTexturePx),
  };
}

function parseSpatial(raw: YamlRecord | undefined, fallback: PropSpatialSettings): PropSpatialSettings {
  const spatial = asRecord(raw?.prop_spatial) ?? raw;
  if (!spatial) return { ...fallback };
  return {
    cellSizeM: num(spatial.cell_size_m ?? spatial.cellSizeM, fallback.cellSizeM),
    maxInstancesPerCellWarning: num(
      spatial.max_instances_per_cell_warning ?? spatial.maxInstancesPerCellWarning,
      fallback.maxInstancesPerCellWarning,
    ),
    farCellUpdateIntervalFrames: num(
      spatial.far_cell_update_interval_frames ?? spatial.farCellUpdateIntervalFrames,
      fallback.farCellUpdateIntervalFrames,
    ),
  };
}

function parseCullingSettings(raw: YamlRecord | undefined, fallback: PropCullingSettings): PropCullingSettings {
  if (!raw) return { ...fallback };
  return {
    cellFrustumCulling: bool(raw.cell_frustum_culling ?? raw.cellFrustumCulling, fallback.cellFrustumCulling),
    cellDistanceCulling: bool(raw.cell_distance_culling ?? raw.cellDistanceCulling, fallback.cellDistanceCulling),
    perInstanceFrustumCullingForLargeProps: bool(
      raw.per_instance_frustum_culling_for_large_props ?? raw.perInstanceFrustumCullingForLargeProps,
      fallback.perInstanceFrustumCullingForLargeProps,
    ),
    perInstanceCullingMinRadius: num(
      raw.per_instance_culling_min_radius ?? raw.perInstanceCullingMinRadius,
      fallback.perInstanceCullingMinRadius,
    ),
    farUpdateIntervalFrames: num(
      raw.far_update_interval_frames ?? raw.farUpdateIntervalFrames,
      fallback.farUpdateIntervalFrames,
    ),
    hysteresisM: num(raw.hysteresis_m ?? raw.hysteresisM, fallback.hysteresisM),
  };
}

function parseDebug(raw: YamlRecord | undefined, fallback: PropDebugSettings): PropDebugSettings {
  if (!raw) return { ...fallback };
  return {
    showCells: bool(raw.show_cells ?? raw.showCells, fallback.showCells),
    showBounds: bool(raw.show_bounds ?? raw.showBounds, fallback.showBounds),
    lodColorOverlay: bool(raw.lod_color_overlay ?? raw.lodColorOverlay, fallback.lodColorOverlay),
    billboardOverlay: bool(raw.billboard_overlay ?? raw.billboardOverlay, fallback.billboardOverlay),
  };
}

function parseShadows(raw: YamlRecord | undefined, fallback: PropShadowSettings): PropShadowSettings {
  if (!raw) return { ...fallback };
  return {
    maxShadowProps: num(raw.max_shadow_props ?? raw.maxShadowProps, fallback.maxShadowProps),
  };
}

export function parseCustomPropsConfig(text: string): CustomPropsSettings {
  const raw = (load(text) ?? {}) as YamlRecord;
  const base = DEFAULT_CUSTOM_PROPS_SETTINGS;
  const props: PropAssetDef[] = [];
  if (Array.isArray(raw.props)) {
    for (const entry of raw.props) {
      const def = parsePropDef(asRecord(entry) ?? {});
      if (def) props.push(def);
    }
  }
  const budgetsRaw = asRecord(raw.category_budgets ?? raw.categoryBudgets);
  const categoryBudgets = { ...base.categoryBudgets };
  for (const category of PROP_CATEGORIES) {
    categoryBudgets[category] = parseCategoryBudget(asRecord(budgetsRaw?.[category]), base.categoryBudgets[category]);
  }
  return {
    enabled: bool(raw.enabled, base.enabled),
    props,
    spatial: parseSpatial(raw, base.spatial),
    culling: parseCullingSettings(asRecord(raw.culling), base.culling),
    shadows: parseShadows(asRecord(raw.shadows), base.shadows),
    categoryBudgets,
    debug: parseDebug(asRecord(raw.debug), base.debug),
  };
}

export function propDefById(settings: CustomPropsSettings): Map<string, PropAssetDef> {
  return new Map(settings.props.map((p) => [p.id, p]));
}
