import { load } from "js-yaml";
import constructionYamlText from "../../config/construction.yaml?raw";
import { SNAP_GROUPS, type ConstructionCategory, type ConstructionConfig, type ConstructionMaterial, type ConstructionPieceDef, type ConstructionSnapPoint, type SnapGroup } from "./types.js";

const CONSTRUCTION_CATEGORIES: readonly ConstructionCategory[] = ["floor", "wall", "fence", "pillar", "roof", "generic"];
const CONSTRUCTION_MATERIALS: readonly ConstructionMaterial[] = ["wood", "stone", "metal", "thatch"];
const MIN_DIMENSION_M = 0.01;
const ZERO_LENGTH_EPSILON = 0.000001;
const DEFAULT_SNAP_DIRECTION: readonly [number, number, number] = [0, 1, 0];

const DEFAULT_CONFIG: ConstructionConfig = {
  enabled: true,
  snap: {
    radiusM: 0.85,
    spatialCellM: 1.0,
    minAlignment: 0.70,
    alignmentWeight: 0.65,
    distanceWeight: 0.35,
  },
  placement: {
    maxRayDistanceM: 8000,
    terrainStepM: 2,
    overlapPaddingM: 0.04,
    storageKey: "drusniel.clod-poc.construction.v1",
  },
  ghost: {
    opacity: 0.42,
  },
  terrainConform: {
    enabled: false,
    foundationCategories: ["floor"],
    padMarginM: 0.35,
    fillDepthM: 2.5,
    trimHeightM: 1.2,
    falloffM: 0.12,
    materialSlot: 1,
  },
  pieces: [],
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readBool(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function readString(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(record?.[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readVec3(record: Record<string, unknown> | undefined, key: string, fallback: readonly [number, number, number]): [number, number, number] {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : [...fallback];
}

function readPositiveVec3(record: Record<string, unknown> | undefined, key: string, fallback: readonly [number, number, number]): [number, number, number] {
  const value = readVec3(record, key, fallback);
  return value.every((entry) => entry >= MIN_DIMENSION_M) ? value : [...fallback];
}

function readDirectionVec3(record: Record<string, unknown> | undefined, key: string, fallback: readonly [number, number, number]): [number, number, number] {
  const value = readVec3(record, key, fallback);
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= ZERO_LENGTH_EPSILON) return [...fallback];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function asSnapGroup(value: unknown, fallback: SnapGroup): SnapGroup {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return SNAP_GROUPS.includes(normalized as SnapGroup) ? normalized as SnapGroup : fallback;
}

function readSnapGroups(value: unknown): SnapGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asSnapGroup(entry, "generic"));
}

function asCategory(value: string): ConstructionCategory {
  const normalized = value.trim().toLowerCase();
  if (CONSTRUCTION_CATEGORIES.includes(normalized as ConstructionCategory)) {
    return normalized as ConstructionCategory;
  }
  return "generic";
}

function readCategories(value: unknown, fallback: readonly ConstructionCategory[]): ConstructionCategory[] {
  if (!Array.isArray(value)) return [...fallback];
  const parsed = value.map((entry) => asCategory(String(entry)));
  return parsed.length > 0 ? parsed : [...fallback];
}

function asMaterial(value: string): ConstructionMaterial {
  const normalized = value.trim().toLowerCase();
  if (CONSTRUCTION_MATERIALS.includes(normalized as ConstructionMaterial)) {
    return normalized as ConstructionMaterial;
  }
  return "wood";
}

function parseSnapPoint(value: unknown): ConstructionSnapPoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id", "snap");
  const group = asSnapGroup(record.group, "generic");
  return {
    id,
    localPos: readVec3(record, "local_pos", [0, 0, 0]),
    direction: readDirectionVec3(record, "direction", DEFAULT_SNAP_DIRECTION),
    group,
    accepts: readSnapGroups(record.accepts),
  };
}

function parsePiece(value: unknown): ConstructionPieceDef | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id", "");
  if (!id) return null;
  const snapPoints = Array.isArray(record.snap_points)
    ? record.snap_points.map(parseSnapPoint).filter((point): point is ConstructionSnapPoint => point !== null)
    : [];
  return {
    id,
    label: readString(record, "label", id),
    category: asCategory(readString(record, "category", "generic")),
    dimensionsM: readPositiveVec3(record, "dimensions_m", [1, 1, 1]),
    canGround: readBool(record, "can_ground", false),
    material: asMaterial(readString(record, "material", "wood")),
    snapPoints,
  };
}

export function parseConstructionConfig(text: string = constructionYamlText): ConstructionConfig {
  try {
    const parsed = asRecord(load(text));
    const root = asRecord(parsed?.construction);
    const snap = asRecord(root?.snap);
    const placement = asRecord(root?.placement);
    const ghost = asRecord(root?.ghost);
    const terrainConform = asRecord(root?.terrain_conform);
    const pieces = Array.isArray(root?.pieces)
      ? root.pieces.map(parsePiece).filter((piece): piece is ConstructionPieceDef => piece !== null)
      : [];

    return {
      enabled: readBool(root, "enabled", DEFAULT_CONFIG.enabled),
      snap: {
        radiusM: readNumber(snap, "radius_m", DEFAULT_CONFIG.snap.radiusM, 0.1, 5),
        spatialCellM: readNumber(snap, "spatial_cell_m", DEFAULT_CONFIG.snap.spatialCellM, 0.1, 10),
        minAlignment: readNumber(snap, "min_alignment", DEFAULT_CONFIG.snap.minAlignment, -1, 1),
        alignmentWeight: readNumber(snap, "alignment_weight", DEFAULT_CONFIG.snap.alignmentWeight, 0, 10),
        distanceWeight: readNumber(snap, "distance_weight", DEFAULT_CONFIG.snap.distanceWeight, 0, 10),
      },
      placement: {
        maxRayDistanceM: readNumber(placement, "max_ray_distance_m", DEFAULT_CONFIG.placement.maxRayDistanceM, 1, 50000),
        terrainStepM: readNumber(placement, "terrain_step_m", DEFAULT_CONFIG.placement.terrainStepM, 0.25, 16),
        overlapPaddingM: readNumber(placement, "overlap_padding_m", DEFAULT_CONFIG.placement.overlapPaddingM, 0, 1),
        storageKey: readString(placement, "storage_key", DEFAULT_CONFIG.placement.storageKey),
      },
      ghost: {
        opacity: readNumber(ghost, "opacity", DEFAULT_CONFIG.ghost.opacity, 0.05, 0.95),
      },
      terrainConform: {
        enabled: readBool(terrainConform, "enabled", DEFAULT_CONFIG.terrainConform.enabled),
        foundationCategories: readCategories(terrainConform?.foundation_categories, DEFAULT_CONFIG.terrainConform.foundationCategories),
        padMarginM: readNumber(terrainConform, "pad_margin_m", DEFAULT_CONFIG.terrainConform.padMarginM, 0, 8),
        fillDepthM: readNumber(terrainConform, "fill_depth_m", DEFAULT_CONFIG.terrainConform.fillDepthM, 0.1, 16),
        trimHeightM: readNumber(terrainConform, "trim_height_m", DEFAULT_CONFIG.terrainConform.trimHeightM, 0, 16),
        falloffM: readNumber(terrainConform, "falloff_m", DEFAULT_CONFIG.terrainConform.falloffM, 0, 1),
        materialSlot: Math.floor(readNumber(terrainConform, "material_slot", DEFAULT_CONFIG.terrainConform.materialSlot, 0, 255)),
      },
      pieces,
    };
  } catch (error) {
    console.warn("[construction] Failed to parse construction config, using defaults.", error);
    return DEFAULT_CONFIG;
  }
}

export const defaultConstructionConfig = parseConstructionConfig();
