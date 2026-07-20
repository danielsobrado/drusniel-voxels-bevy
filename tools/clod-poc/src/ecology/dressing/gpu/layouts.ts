import {
  DRESSING_CLASSES,
  DRESSING_CLASS_DEFINITIONS,
  dressingClassNumericId,
  type DressingClassId,
  type DressingOwnership,
} from "../class_registry.js";
import type { DressingConfig, DressingQuality } from "../config.js";

export const DRESSING_ENVIRONMENT_FLOATS = 32;
export const DRESSING_ENVIRONMENT_STRIDE_BYTES = DRESSING_ENVIRONMENT_FLOATS * 4;
export const DRESSING_INSTANCE_WORDS = 16;
export const DRESSING_INSTANCE_STRIDE_BYTES = DRESSING_INSTANCE_WORDS * 4;
export const DRESSING_INDIRECT_WORDS = 5;
export const DRESSING_INDIRECT_STRIDE_BYTES = DRESSING_INDIRECT_WORDS * 4;

export interface DressingGpuCapacities {
  readonly environments: number;
  readonly terrainCandidates: number;
  readonly attachmentCandidates: number;
  readonly visibleInstances: number;
  readonly drawGroups: number;
}

export interface DressingIndirectDrawTemplate {
  readonly indexCount: number;
  readonly firstIndex: number;
  readonly baseVertex: number;
  readonly firstInstance: number;
}

export function validateDressingGpuCapacities(capacities: DressingGpuCapacities): void {
  for (const [name, value] of Object.entries(capacities)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`dressing GPU ${name} capacity must be positive`);
  }
  if (capacities.visibleInstances < capacities.drawGroups) {
    throw new Error("dressing GPU visible capacity cannot be smaller than draw-group capacity");
  }
}

export function createDressingCounterReset(environmentCount: number, parentCount: number): Uint32Array<ArrayBuffer> {
  const counters = new Uint32Array(new ArrayBuffer(64 * Uint32Array.BYTES_PER_ELEMENT));
  counters[4] = environmentCount >>> 0;
  counters[5] = parentCount >>> 0;
  return counters;
}

export function createDressingIndirectReset(
  drawGroups: number,
  templates: readonly DressingIndirectDrawTemplate[] = [],
): Uint32Array<ArrayBuffer> {
  if (!Number.isSafeInteger(drawGroups) || drawGroups < 1) throw new Error("dressing GPU draw-group capacity must be positive");
  if (templates.length > drawGroups) throw new Error("dressing GPU indirect templates exceed draw-group capacity");
  const words = new Uint32Array(new ArrayBuffer(drawGroups * DRESSING_INDIRECT_STRIDE_BYTES));
  for (let group = 0; group < templates.length; group++) {
    const template = templates[group]!;
    validateUint32("indexCount", template.indexCount);
    validateUint32("firstIndex", template.firstIndex);
    validateInt32("baseVertex", template.baseVertex);
    validateUint32("firstInstance", template.firstInstance);
    const offset = group * DRESSING_INDIRECT_WORDS;
    words[offset] = template.indexCount;
    words[offset + 1] = 0;
    words[offset + 2] = template.firstIndex;
    words[offset + 3] = template.baseVertex >>> 0;
    words[offset + 4] = template.firstInstance;
  }
  return words;
}

function validateUint32(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`dressing GPU indirect ${name} must be a uint32`);
  }
}

function validateInt32(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error(`dressing GPU indirect ${name} must be an int32`);
  }
}

export const DRESSING_GPU_LOD_COUNT = 3;
export const DRESSING_GPU_GROUP_COUNT = DRESSING_CLASSES.length * DRESSING_GPU_LOD_COUNT;
export const DRESSING_GPU_RECORD_VEC4S = 3;
export const DRESSING_GPU_INDIRECT_WORDS = 5;
export const DRESSING_GPU_CLASS_PARAM_WORDS = 20;
export const DRESSING_GPU_WORKGROUP_SIZE = 64;
export const DRESSING_GPU_DEFAULT_CAPACITY_PER_GROUP = 1024;
export const DRESSING_GPU_ACTIVE_RADIUS_M = 110;

export interface DressingGpuClassLayout {
  readonly classId: DressingClassId;
  readonly classIndex: number;
  readonly startSlot: number;
  readonly slotCount: number;
  readonly grid: number;
  readonly spacingM: number;
  readonly acceptanceProbability: number;
  readonly lodDistancesM: readonly [number, number, number];
  readonly ownership: DressingOwnership;
  readonly supportOffsetM: number;
}

export interface DressingGpuLayout {
  readonly classes: readonly DressingGpuClassLayout[];
  readonly totalCandidateSlots: number;
  readonly persistentCandidateStart: number;
  readonly persistentCandidateEnd: number;
  readonly terrainCandidateStart: number;
  readonly terrainCandidateEnd: number;
  readonly packed: ArrayBuffer;
}

export function dressingGpuGroupIndex(classId: DressingClassId, lod: number): number {
  const classIndex = DRESSING_CLASSES.indexOf(classId);
  if (classIndex < 0) throw new Error(`unknown dressing class: ${classId}`);
  return classIndex * DRESSING_GPU_LOD_COUNT + clampInteger(lod, 0, DRESSING_GPU_LOD_COUNT - 1);
}

export function buildDressingGpuLayout(
  config: DressingConfig,
  quality: DressingQuality,
  indexCounts: ArrayLike<number>,
): DressingGpuLayout {
  const classes: DressingGpuClassLayout[] = [];
  let totalCandidateSlots = 0;
  const qualityMultiplier = config.cosmeticDensityMultiplier[quality];

  for (let classIndex = 0; classIndex < DRESSING_CLASSES.length; classIndex++) {
    const classId = DRESSING_CLASSES[classIndex]!;
    const definition = DRESSING_CLASS_DEFINITIONS[classId];
    const terrainGenerated = definition.ownership !== "parent_attached"
      && classId !== "stump_fresh"
      && classId !== "stump_rotten";
    const spacingM = terrainGenerated ? Math.max(0.5, definition.spacingM) : 0;
    const grid = terrainGenerated
      ? Math.max(1, Math.ceil((DRESSING_GPU_ACTIVE_RADIUS_M * 2) / spacingM))
      : 0;
    const slotCount = grid * grid;
    const density = configuredDensityPerHectare(classId, config);
    const multiplier = definition.ownership === "persistent" ? 1 : qualityMultiplier;
    const acceptanceProbability = terrainGenerated
      ? clamp01(density * spacingM * spacingM / 10_000 * multiplier)
      : 0;
    classes.push({
      classId,
      classIndex,
      startSlot: totalCandidateSlots,
      slotCount,
      grid,
      spacingM,
      acceptanceProbability,
      lodDistancesM: definition.lodDistancesM,
      ownership: definition.ownership,
      supportOffsetM: geometrySupportOffset(classId),
    });
    totalCandidateSlots += slotCount;
  }

  const packed = new ArrayBuffer(DRESSING_CLASSES.length * DRESSING_GPU_CLASS_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT);
  const f32 = new Float32Array(packed);
  const u32 = new Uint32Array(packed);
  for (const entry of classes) {
    const offset = entry.classIndex * DRESSING_GPU_CLASS_PARAM_WORDS;
    u32[offset] = dressingClassNumericId(entry.classId) - 1;
    u32[offset + 1] = ownershipCode(entry.ownership);
    u32[offset + 2] = entry.startSlot;
    u32[offset + 3] = entry.slotCount;
    f32[offset + 4] = entry.grid;
    f32[offset + 5] = entry.spacingM;
    f32[offset + 6] = entry.acceptanceProbability;
    f32[offset + 7] = entry.supportOffsetM;
    f32[offset + 8] = entry.lodDistancesM[0];
    f32[offset + 9] = entry.lodDistancesM[1];
    f32[offset + 10] = entry.lodDistancesM[2];
    f32[offset + 11] = DRESSING_GPU_ACTIVE_RADIUS_M;
    const definition = DRESSING_CLASS_DEFINITIONS[entry.classId];
    f32[offset + 12] = definition.placementStage;
    f32[offset + 13] = cavePolicyCode(definition.cavePolicy);
    f32[offset + 14] = definition.castsNearShadow ? 1 : 0;
    f32[offset + 15] = entry.classId.startsWith("dead_log")
      ? clamp01(config.densities.stumpsPerHectare / Math.max(1e-6, config.densities.deadfallPerHectare))
      : 0;
    for (let lod = 0; lod < DRESSING_GPU_LOD_COUNT; lod++) {
      u32[offset + 16 + lod] = Math.max(0, Math.floor(indexCounts[dressingGpuGroupIndex(entry.classId, lod)] ?? 0));
    }
  }
  const persistent = classes.filter((entry) => entry.ownership === "persistent" && entry.slotCount > 0);
  const terrain = classes.filter((entry) => entry.ownership === "terrain_attached" && entry.slotCount > 0);
  return {
    classes,
    totalCandidateSlots,
    persistentCandidateStart: persistent[0]?.startSlot ?? 0,
    persistentCandidateEnd: persistent.length > 0
      ? persistent[persistent.length - 1]!.startSlot + persistent[persistent.length - 1]!.slotCount
      : 0,
    terrainCandidateStart: terrain[0]?.startSlot ?? totalCandidateSlots,
    terrainCandidateEnd: terrain.length > 0
      ? terrain[terrain.length - 1]!.startSlot + terrain[terrain.length - 1]!.slotCount
      : totalCandidateSlots,
    packed,
  };
}

export function configuredDensityPerHectare(classId: DressingClassId, config: DressingConfig): number {
  const densities = config.densities;
  if (classId === "dead_log_fresh") return densities.deadfallPerHectare * 0.25;
  if (classId === "dead_log_mossy") return densities.deadfallPerHectare * 0.4;
  if (classId === "dead_log_rotten") return densities.deadfallPerHectare * 0.35;
  if (classId === "stump_fresh") return densities.stumpsPerHectare * 0.42;
  if (classId === "stump_rotten") return densities.stumpsPerHectare * 0.58;
  if (classId === "broken_snag") return densities.brokenSnagsPerHectare;
  if (classId === "large_driftwood") return densities.driftwoodPer100m * 5;
  if (classId === "large_talus_boulder") return 4;
  if (classId === "moss_patch") return densities.mossPatchesPerHectare;
  if (classId === "lichen_patch") return densities.lichenPatchesPerHectare;
  if (classId === "leaf_litter" || classId === "needle_litter") return densities.litterClustersPerHectare * 0.5;
  if (classId === "twig_cluster") return densities.twigClustersPerHectare;
  if (classId === "river_cobbles") return densities.riverCobbleClustersPer100m * 5;
  if (classId === "small_driftwood") return densities.driftwoodPer100m * 5;
  if (classId === "cave_mouth_fern") return densities.caveMouthFernsPer100m2 * 100;
  if (classId === "bark_chip_cluster") return 90;
  if (classId === "small_talus" || classId === "wet_stone_cluster") return 70;
  if (classId === "bank_fern") return 40;
  if (classId === "cliff_fern") return 24;
  if (classId === "flower_patch") return 80;
  return 0;
}

function ownershipCode(value: DressingOwnership): number {
  return value === "persistent" ? 0 : value === "parent_attached" ? 1 : 2;
}

function cavePolicyCode(value: string): number {
  if (value === "mouth_only") return 1;
  if (value === "allow_floor") return 2;
  if (value === "allow_wall") return 3;
  return 0;
}

function geometrySupportOffset(classId: DressingClassId): number {
  if (classId.startsWith("dead_log") || classId.includes("driftwood")) return 0.3;
  if (classId.startsWith("stump")) return 0.325;
  if (classId === "broken_snag") return 1.9;
  if (classId === "large_talus_boulder" || classId === "small_talus") return 0.25;
  if (classId === "river_cobbles" || classId === "wet_stone_cluster") return 0.14;
  if (classId.includes("litter") || classId.includes("patch")) return 0.015;
  return 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
