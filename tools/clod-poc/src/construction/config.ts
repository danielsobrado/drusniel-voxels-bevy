import { load } from "js-yaml";
import constructionYamlText from "../../config/construction.yaml?raw";
import { defaultConstructionPieceCatalogTexts } from "./construction_piece_catalog.js";
import {
  CONSTRUCTION_GEOMETRY_KINDS,
  CONSTRUCTION_MATERIALS,
  CONSTRUCTION_SUPPORT_CLASSES,
  SNAP_GROUPS,
  type ConstructionCategory,
  type ConstructionConfig,
  type ConstructionGeometryKind,
  type ConstructionGeometryPart,
  type ConstructionMaterial,
  type ConstructionPieceDef,
  type ConstructionPlacementBox,
  type ConstructionSnapPoint,
  type ConstructionSupportClass,
  type ConstructionSupportProfile,
  type ConstructionSupportProfiles,
  type SnapGroup,
} from "./types.js";

const CONSTRUCTION_CATEGORIES: readonly ConstructionCategory[] = [
  "floor",
  "wall",
  "opening",
  "fence",
  "pillar",
  "beam",
  "stairs",
  "roof",
  "foundation",
  "generic",
];
const MIN_DIMENSION_M = 0.01;
const ZERO_LENGTH_EPSILON = 0.000001;
const DEFAULT_SNAP_DIRECTION: readonly [number, number, number] = [0, 1, 0];
const DEFAULT_ALLOWED_TWISTS = [0, 90, 180, 270] as const;

export const DEFAULT_CONSTRUCTION_SUPPORT_PROFILES: ConstructionSupportProfiles = {
  wood: { maxSupport: 1, verticalDecay: 0.06, horizontalDecay: 0.10, supportClass: "wood" },
  brick: { maxSupport: 1, verticalDecay: 0.10, horizontalDecay: 0.16, supportClass: "stone" },
  concrete: { maxSupport: 1, verticalDecay: 0.04, horizontalDecay: 0.07, supportClass: "ground" },
  marble: { maxSupport: 1, verticalDecay: 0.09, horizontalDecay: 0.15, supportClass: "stone" },
  tiles: { maxSupport: 1, verticalDecay: 0.30, horizontalDecay: 0.45, supportClass: "stone" },
  stone: { maxSupport: 1, verticalDecay: 0.10, horizontalDecay: 0.18, supportClass: "stone" },
  metal: { maxSupport: 1, verticalDecay: 0.03, horizontalDecay: 0.05, supportClass: "ground" },
  thatch: { maxSupport: 1, verticalDecay: 1, horizontalDecay: 1, supportClass: "wood" },
};

const DEFAULT_CONFIG: ConstructionConfig = {
  enabled: true,
  snap: {
    radiusM: 0.85,
    spatialCellM: 1,
    minAlignment: 0.70,
    alignmentWeight: 0.65,
    distanceWeight: 0.35,
    tangentWeight: 0.25,
    releaseRadiusMultiplier: 1.35,
    maxRayDistanceM: 32,
  },
  placement: {
    maxRayDistanceM: 8000,
    terrainStepM: 2,
    overlapPaddingM: 0.04,
    overlapSpatialCellM: 4,
    storageKey: "drusniel.clod-poc.construction.v1",
    allowHeightfieldFallback: false,
  },
  ghost: { opacity: 0.42 },
  terrainConform: {
    enabled: false,
    foundationCategories: ["floor", "foundation"],
    padMarginM: 0.35,
    fillDepthM: 2.5,
    trimHeightM: 1.2,
    falloffM: 0.12,
    materialSlot: 1,
  },
  stability: {
    collapseThreshold: 0.20,
    epsilon: 0.0001,
    maxIslandSize: 4096,
    maxCollapsesPerFrame: 8,
    connectionToleranceM: 0.08,
    verticalConnectionMinRatio: 0.55,
  },
  supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
  pieces: [],
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readBool(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function readString(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(record: Record<string, unknown> | undefined, key: string, fallback: number, min: number, max: number): number {
  const value = Number(record?.[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readInteger(record: Record<string, unknown> | undefined, key: string, fallback: number, min: number, max: number): number {
  return Math.floor(readNumber(record, key, fallback, min, max));
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

function normalizeVec3(value: readonly [number, number, number], fallback: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length <= ZERO_LENGTH_EPSILON ? [...fallback] : [value[0] / length, value[1] / length, value[2] / length];
}

function readDirectionVec3(record: Record<string, unknown> | undefined, key: string, fallback: readonly [number, number, number]): [number, number, number] {
  return normalizeVec3(readVec3(record, key, fallback), fallback);
}

function defaultTangent(normal: readonly [number, number, number]): [number, number, number] {
  const reference: readonly [number, number, number] = Math.abs(normal[1]) > 0.8 ? [1, 0, 0] : [0, 1, 0];
  return normalizeVec3([
    reference[1] * normal[2] - reference[2] * normal[1],
    reference[2] * normal[0] - reference[0] * normal[2],
    reference[0] * normal[1] - reference[1] * normal[0],
  ], [1, 0, 0]);
}

function readTangent(record: Record<string, unknown> | undefined, normal: readonly [number, number, number]): [number, number, number] {
  const fallback = defaultTangent(normal);
  const raw = readVec3(record, "tangent", fallback);
  const dot = raw[0] * normal[0] + raw[1] * normal[1] + raw[2] * normal[2];
  return normalizeVec3([raw[0] - normal[0] * dot, raw[1] - normal[1] * dot, raw[2] - normal[2] * dot], fallback);
}

function normalizeDegrees(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return Math.round(normalized / 90) * 90 % 360;
}

function readAllowedTwists(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_ALLOWED_TWISTS];
  const parsed = [...new Set(value.map(Number).filter(Number.isFinite).map(normalizeDegrees))];
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_TWISTS];
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
  return CONSTRUCTION_CATEGORIES.includes(normalized as ConstructionCategory) ? normalized as ConstructionCategory : "generic";
}

function readCategories(value: unknown, fallback: readonly ConstructionCategory[]): ConstructionCategory[] {
  if (!Array.isArray(value)) return [...fallback];
  const parsed = value.map((entry) => asCategory(String(entry)));
  return parsed.length > 0 ? parsed : [...fallback];
}

function asMaterial(value: string): ConstructionMaterial {
  const normalized = value.trim().toLowerCase();
  return CONSTRUCTION_MATERIALS.includes(normalized as ConstructionMaterial) ? normalized as ConstructionMaterial : "wood";
}

function asSupportClass(value: unknown, fallback: ConstructionSupportClass): ConstructionSupportClass {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return CONSTRUCTION_SUPPORT_CLASSES.includes(normalized as ConstructionSupportClass)
    ? normalized as ConstructionSupportClass
    : fallback;
}

function parseSupportProfile(value: unknown, fallback: ConstructionSupportProfile): ConstructionSupportProfile {
  const record = asRecord(value);
  if (!record) return { ...fallback };
  return {
    maxSupport: readNumber(record, "max_support", fallback.maxSupport, 0.01, 10),
    verticalDecay: readNumber(record, "vertical_decay", fallback.verticalDecay, 0, 10),
    horizontalDecay: readNumber(record, "horizontal_decay", fallback.horizontalDecay, 0, 10),
    supportClass: asSupportClass(record.support_class, fallback.supportClass),
  };
}

function parseSupportProfiles(value: unknown): ConstructionSupportProfiles {
  const record = asRecord(value);
  const profiles = {} as Record<ConstructionMaterial, ConstructionSupportProfile>;
  for (const material of CONSTRUCTION_MATERIALS) {
    profiles[material] = parseSupportProfile(record?.[material], DEFAULT_CONSTRUCTION_SUPPORT_PROFILES[material]);
  }
  return profiles;
}

function asGeometryKind(value: string): ConstructionGeometryKind {
  const normalized = value.trim().toLowerCase();
  return CONSTRUCTION_GEOMETRY_KINDS.includes(normalized as ConstructionGeometryKind) ? normalized as ConstructionGeometryKind : "box";
}

function parseSnapPoint(value: unknown): ConstructionSnapPoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const direction = readDirectionVec3(record, "direction", DEFAULT_SNAP_DIRECTION);
  return {
    id: readString(record, "id", "snap"),
    localPos: readVec3(record, "local_pos", [0, 0, 0]),
    direction,
    tangent: readTangent(record, direction),
    allowedTwistDegrees: readAllowedTwists(record.allowed_twist_degrees),
    group: asSnapGroup(record.group, "generic"),
    accepts: readSnapGroups(record.accepts),
  };
}

function parsePlacementBox(value: unknown): ConstructionPlacementBox | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    center: readVec3(record, "center", [0, 0, 0]),
    dimensionsM: readPositiveVec3(record, "dimensions_m", [1, 1, 1]),
    rotationYDegrees: readNumber(record, "rotation_y_degrees", 0, -360, 360),
  };
}

function parseGeometryPart(value: unknown): ConstructionGeometryPart | null {
  const record = asRecord(value);
  if (!record) return null;
  const rotationY = readNumber(record, "rotation_y_degrees", 0, -360, 360);
  const rotationDegrees = Array.isArray(record.rotation_degrees)
    ? readVec3(record, "rotation_degrees", [0, rotationY, 0])
    : [0, rotationY, 0] as const;
  return {
    kind: asGeometryKind(readString(record, "kind", "box")),
    center: readVec3(record, "center", [0, 0, 0]),
    dimensionsM: readPositiveVec3(record, "dimensions_m", [1, 1, 1]),
    rotationDegrees,
  };
}

function parsePiece(value: unknown): ConstructionPieceDef | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id", "");
  if (!id) return null;
  const material = asMaterial(readString(record, "material", "wood"));
  const snapPoints = Array.isArray(record.snap_points)
    ? record.snap_points.map(parseSnapPoint).filter((point): point is ConstructionSnapPoint => point !== null)
    : [];
  const placementBoxes = Array.isArray(record.placement_boxes)
    ? record.placement_boxes.map(parsePlacementBox).filter((box): box is ConstructionPlacementBox => box !== null)
    : undefined;
  const geometryParts = Array.isArray(record.geometry_parts)
    ? record.geometry_parts.map(parseGeometryPart).filter((part): part is ConstructionGeometryPart => part !== null)
    : undefined;
  return {
    id,
    label: readString(record, "label", id),
    category: asCategory(readString(record, "category", "generic")),
    dimensionsM: readPositiveVec3(record, "dimensions_m", [1, 1, 1]),
    canGround: readBool(record, "can_ground", false),
    material,
    snapPoints,
    rotationStepDegrees: readNumber(record, "rotation_step_degrees", 90, 1, 180) >= 135 ? 180 : 90,
    geometryKind: asGeometryKind(readString(record, "geometry_kind", "box")),
    geometryYawDegrees: readNumber(record, "geometry_yaw_degrees", 0, -360, 360),
    geometryParts,
    placementBoxes,
    groundNormalMinY: readNumber(record, "ground_normal_min_y", 0.45, -1, 1),
    supportProfile: record.support_profile
      ? parseSupportProfile(record.support_profile, DEFAULT_CONSTRUCTION_SUPPORT_PROFILES[material])
      : undefined,
  };
}

function parsePieceCatalog(text: string): ConstructionPieceDef[] {
  const parsed = asRecord(load(text));
  return Array.isArray(parsed?.pieces)
    ? parsed.pieces.map(parsePiece).filter((piece): piece is ConstructionPieceDef => piece !== null)
    : [];
}

export function parseConstructionConfig(
  text?: string,
  pieceCatalogTexts?: readonly string[],
): ConstructionConfig {
  try {
    const usesDefaultSources = text === undefined && pieceCatalogTexts === undefined;
    const parsed = asRecord(load(text ?? constructionYamlText));
    const root = asRecord(parsed?.construction);
    const snap = asRecord(root?.snap);
    const placement = asRecord(root?.placement);
    const ghost = asRecord(root?.ghost);
    const terrainConform = asRecord(root?.terrain_conform);
    const stability = asRecord(root?.stability);
    const inlinePieces = Array.isArray(root?.pieces)
      ? root.pieces.map(parsePiece).filter((piece): piece is ConstructionPieceDef => piece !== null)
      : [];
    const catalogTexts = pieceCatalogTexts ?? (usesDefaultSources ? defaultConstructionPieceCatalogTexts : []);
    const catalogPieces = catalogTexts.flatMap(parsePieceCatalog);
    const pieces = inlinePieces.length > 0 ? inlinePieces : catalogPieces;

    return {
      enabled: readBool(root, "enabled", DEFAULT_CONFIG.enabled),
      snap: {
        radiusM: readNumber(snap, "radius_m", DEFAULT_CONFIG.snap.radiusM, 0.1, 5),
        spatialCellM: readNumber(snap, "spatial_cell_m", DEFAULT_CONFIG.snap.spatialCellM, 0.1, 10),
        minAlignment: readNumber(snap, "min_alignment", DEFAULT_CONFIG.snap.minAlignment, -1, 1),
        alignmentWeight: readNumber(snap, "alignment_weight", DEFAULT_CONFIG.snap.alignmentWeight, 0, 10),
        distanceWeight: readNumber(snap, "distance_weight", DEFAULT_CONFIG.snap.distanceWeight, 0, 10),
        tangentWeight: readNumber(snap, "tangent_weight", DEFAULT_CONFIG.snap.tangentWeight ?? 0.25, 0, 10),
        releaseRadiusMultiplier: readNumber(snap, "release_radius_multiplier", DEFAULT_CONFIG.snap.releaseRadiusMultiplier ?? 1.35, 1, 3),
        maxRayDistanceM: readNumber(snap, "max_ray_distance_m", DEFAULT_CONFIG.snap.maxRayDistanceM ?? 32, 1, 256),
      },
      placement: {
        maxRayDistanceM: readNumber(placement, "max_ray_distance_m", DEFAULT_CONFIG.placement.maxRayDistanceM, 1, 50000),
        terrainStepM: readNumber(placement, "terrain_step_m", DEFAULT_CONFIG.placement.terrainStepM, 0.25, 16),
        overlapPaddingM: readNumber(placement, "overlap_padding_m", DEFAULT_CONFIG.placement.overlapPaddingM, 0, 1),
        overlapSpatialCellM: readNumber(placement, "overlap_spatial_cell_m", DEFAULT_CONFIG.placement.overlapSpatialCellM ?? 4, 0.5, 64),
        storageKey: readString(placement, "storage_key", DEFAULT_CONFIG.placement.storageKey),
        allowHeightfieldFallback: readBool(placement, "allow_heightfield_fallback", DEFAULT_CONFIG.placement.allowHeightfieldFallback ?? false),
      },
      ghost: { opacity: readNumber(ghost, "opacity", DEFAULT_CONFIG.ghost.opacity, 0.05, 0.95) },
      terrainConform: {
        enabled: readBool(terrainConform, "enabled", DEFAULT_CONFIG.terrainConform.enabled),
        foundationCategories: readCategories(terrainConform?.foundation_categories, DEFAULT_CONFIG.terrainConform.foundationCategories),
        padMarginM: readNumber(terrainConform, "pad_margin_m", DEFAULT_CONFIG.terrainConform.padMarginM, 0, 8),
        fillDepthM: readNumber(terrainConform, "fill_depth_m", DEFAULT_CONFIG.terrainConform.fillDepthM, 0.1, 16),
        trimHeightM: readNumber(terrainConform, "trim_height_m", DEFAULT_CONFIG.terrainConform.trimHeightM, 0, 16),
        falloffM: readNumber(terrainConform, "falloff_m", DEFAULT_CONFIG.terrainConform.falloffM, 0, 1),
        materialSlot: readInteger(terrainConform, "material_slot", DEFAULT_CONFIG.terrainConform.materialSlot, 0, 255),
      },
      stability: {
        collapseThreshold: readNumber(stability, "collapse_threshold", DEFAULT_CONFIG.stability.collapseThreshold, 0, 1),
        epsilon: readNumber(stability, "epsilon", DEFAULT_CONFIG.stability.epsilon, 0.000001, 0.1),
        maxIslandSize: readInteger(stability, "max_island_size", DEFAULT_CONFIG.stability.maxIslandSize, 16, 100000),
        maxCollapsesPerFrame: readInteger(stability, "max_collapses_per_frame", DEFAULT_CONFIG.stability.maxCollapsesPerFrame, 1, 1000),
        connectionToleranceM: readNumber(stability, "connection_tolerance_m", DEFAULT_CONFIG.stability.connectionToleranceM, 0.005, 0.5),
        verticalConnectionMinRatio: readNumber(stability, "vertical_connection_min_ratio", DEFAULT_CONFIG.stability.verticalConnectionMinRatio, 0, 1),
      },
      supportProfiles: parseSupportProfiles(root?.support_profiles),
      pieces,
    };
  } catch (error) {
    console.warn("[construction] Failed to parse construction config, using defaults.", error);
    return DEFAULT_CONFIG;
  }
}

export const defaultConstructionConfig = parseConstructionConfig();
