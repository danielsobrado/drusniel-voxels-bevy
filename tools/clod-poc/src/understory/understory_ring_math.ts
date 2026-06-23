// Understory GPU-ring math (Phase 1 of docs/plans/understory-gpu-ring-port-plan.md).
//
// Pure, deterministic helpers shared by the WGSL cull shader
// (understory_ring.compute.wgsl), the ring draw material, and the CPU parity
// reference. This module is the single source of truth for the ring geometry
// (toroidal cell grid), per-group layout, terrain accept gate, and the uniform
// byte layout. Mirrors trees/tree_ring_math.ts but understory has a single LOD,
// so a "group" is just an understory class.

import { materialWeights } from "../terrain.js";
import { clamp01 } from "../trees/tree_noise.js";
import {
  DEFAULT_UNDERSTORY_SETTINGS,
  UNDERSTORY_CLASSES,
  type UnderstoryClass,
  type UnderstorySettings,
} from "./understory_config.js";

export const UNDERSTORY_RING_GROUP_COUNT = UNDERSTORY_CLASSES.length;

// std140 uniform: 8 vec4 lanes of globals (see packUnderstoryRingParams).
export const UNDERSTORY_RING_PARAM_BYTES = 16 * 8;
// Per-class selection params: 8 floats per class (see packUnderstoryRingClassParams).
export const UNDERSTORY_RING_CLASS_STRIDE_F32 = 8;

export interface UnderstoryRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  maxInstancesPerGroup: number;
  indexCount: number;
}

export interface UnderstoryRingAcceptParams {
  seed: number;
  minHeightM: number;
  maxHeightM: number;
  slopeMinY: number;
  minGroundWeight: number;
}

export type UnderstoryRingCounts = Record<UnderstoryClass, number>;

export function emptyUnderstoryRingCounts(): UnderstoryRingCounts {
  return { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 };
}

export function understoryRingGroupIndex(cls: UnderstoryClass): number {
  return UNDERSTORY_CLASSES.indexOf(cls);
}

export function understoryRingGroupClass(group: number): UnderstoryClass {
  const index = Math.max(0, Math.min(UNDERSTORY_RING_GROUP_COUNT - 1, Math.floor(group)));
  return UNDERSTORY_CLASSES[index];
}

export function understoryRingCell(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  return Math.max(0.25, settings.placement.spacingM);
}

export function understoryRingGrid(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  return Math.max(1, Math.ceil((settings.distanceM * 2) / understoryRingCell(settings)));
}

export function understoryRingSlotCount(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  const grid = understoryRingGrid(settings);
  return grid * grid;
}

export function understoryRingGroupCapacity(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  return Math.max(1, Math.floor(settings.gpu.maxVisible / UNDERSTORY_RING_GROUP_COUNT));
}

export function understoryRingWorkgroupSize(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  return settings.gpu.workgroupSize;
}

export function understoryRingCullWorkgroups(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): number {
  return Math.ceil(understoryRingSlotCount(settings) / understoryRingWorkgroupSize(settings));
}

const READBACK_INTERVAL_FRAMES = 90;

export function understoryRingRequestsDebugReadback(settings: UnderstorySettings, frame: number): boolean {
  return settings.gpu.readbackVisibleLists &&
    (settings.gpu.debugShowGpuCounts || settings.gpu.debugValidateAgainstCpu) &&
    frame % READBACK_INTERVAL_FRAMES === 0;
}

export function understoryRingGroupRegion(
  group: number,
  maxInstancesPerGroup: number,
): { start: number; end: number; firstInstance: number } {
  const cap = Math.max(0, Math.floor(maxInstancesPerGroup));
  const start = Math.max(0, Math.floor(group)) * cap;
  return { start, end: start + cap, firstInstance: start };
}

// PCG-style 2D hash returning two floats in [0, 1). Matches the WGSL
// `understory_pcg2d` exactly (integer math, 24-bit mantissa).
export function understoryPcg2d(cellX: number, cellZ: number, salt: number): [number, number] {
  const m = 1664525;
  const c = 1013904223;
  const a0 = (Math.trunc(cellX) + 40000 + (salt & 0x3fff)) >>> 0;
  const b0 = (Math.trunc(cellZ) + 40000 + ((salt >>> 14) & 0x3fff)) >>> 0;
  const a1 = (Math.imul(a0, m) + c) >>> 0;
  const b1 = (Math.imul(b0, m) + c) >>> 0;
  const a2 = (a1 + Math.imul(b1, m)) >>> 0;
  const b2 = (b1 + Math.imul(a2, m)) >>> 0;
  const a3 = (a2 ^ (a2 >>> 16)) >>> 0;
  const b3 = (b2 ^ (b2 >>> 16)) >>> 0;
  const a4 = (a3 + Math.imul(b3, m)) >>> 0;
  const b4 = (b3 + Math.imul(a4, m)) >>> 0;
  const a5 = (a4 ^ (a4 >>> 16)) >>> 0;
  const b5 = (b4 ^ (b4 >>> 16)) >>> 0;
  const inv = 1 / 16777216;
  return [(a5 & 0xffffff) * inv, (b5 & 0xffffff) * inv];
}

// fract(sin()) hash used for acceptance/class/scale rolls. Matches the WGSL
// `understory_hash`. Keyed by world cell + seed + salt.
export function understoryRingHash(cellX: number, cellZ: number, seed: number, salt: number): number {
  const sx = cellX + (seed + salt);
  const sz = cellZ + (seed * 0.37 + salt * 1.17);
  const value = Math.sin(sx * 41.3 + sz * 289.1) * 43758.5453;
  return value - Math.floor(value);
}

export function understoryWorldCell(
  slotX: number,
  slotZ: number,
  grid: number,
  cellSize: number,
  cameraX: number,
  cameraZ: number,
): [number, number] {
  const safeGrid = Math.max(1, Math.floor(grid));
  const safeCell = Math.max(0.001, cellSize);
  const camCellX = cameraX / safeCell;
  const camCellZ = cameraZ / safeCell;
  return [
    Math.round((camCellX - slotX) / safeGrid) * safeGrid + slotX,
    Math.round((camCellZ - slotZ) / safeGrid) * safeGrid + slotZ,
  ];
}

export function understoryWorldCellFromSlot(
  slot: number,
  grid: number,
  cellSize: number,
  cameraX: number,
  cameraZ: number,
): [number, number] {
  const safeGrid = Math.max(1, Math.floor(grid));
  const safeSlot = Math.max(0, Math.floor(slot));
  return understoryWorldCell(safeSlot % safeGrid, Math.floor(safeSlot / safeGrid), safeGrid, cellSize, cameraX, cameraZ);
}

export function understoryRingAcceptParams(
  settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS,
): UnderstoryRingAcceptParams {
  return {
    seed: settings.seed,
    minHeightM: settings.placement.minHeightM,
    maxHeightM: settings.placement.maxHeightM,
    slopeMinY: settings.placement.slopeMinY,
    minGroundWeight: settings.placement.minGroundWeight,
  };
}

// Terrain placement gate, mirroring generateUnderstoryInstances() slope/height/
// material rejects. Returns the ground weight (>= 0) when accepted, or -1 when
// the candidate is rejected by terrain. The ecology roll + class selection (the
// noise-heavy part) is layered on top of this in the cull shader / parity ref.
export function understoryRingTerrainGate(
  height: number,
  normalY: number,
  params: UnderstoryRingAcceptParams,
): number {
  if (!Number.isFinite(height) || !Number.isFinite(normalY)) return -1;
  if (normalY < params.slopeMinY) return -1;
  if (height < params.minHeightM || height > params.maxHeightM) return -1;
  const [grassWeight, dirtWeight] = materialWeights(height, normalY);
  const groundWeight = grassWeight + dirtWeight * 0.25;
  if (groundWeight < params.minGroundWeight) return -1;
  return clamp01(groundWeight);
}

// Acceptance probability shared by CPU/GPU once ecology is sampled. Kept here so
// the parity reference and the WGSL agree on the formula.
export function understoryRingAcceptance(ecology: {
  density: number;
  forestInfluence: number;
  forestEdge: number;
  clearing: number;
}): number {
  return clamp01(
    0.06 +
      ecology.density * 0.42 +
      ecology.forestInfluence * 0.28 +
      ecology.forestEdge * 0.22 +
      ecology.clearing * 0.12,
  );
}

export function resolveUnderstoryRingReadbackCounts(
  rawGroupCounts: ArrayLike<number>,
  maxInstancesPerGroup: number,
): { counts: UnderstoryRingCounts; groupCounts: number[]; overflowed: boolean } {
  const cap = Math.max(0, Math.floor(maxInstancesPerGroup));
  const rawCounts = Array.from({ length: UNDERSTORY_RING_GROUP_COUNT }, (_, group) =>
    Math.max(0, Math.floor(rawGroupCounts[group] ?? 0)),
  );
  const groupCounts = rawCounts.map((count) => Math.min(count, cap));
  const counts = emptyUnderstoryRingCounts();
  for (let group = 0; group < UNDERSTORY_RING_GROUP_COUNT; group++) {
    counts[understoryRingGroupClass(group)] = groupCounts[group];
  }
  return { counts, groupCounts, overflowed: rawCounts.some((count) => count > cap) };
}

function heightPreferenceCode(cls: UnderstoryClass, settings: UnderstorySettings): number {
  const pref = settings.classes[cls].heightPreference;
  return pref === "low" ? -1 : pref === "high" ? 1 : 0;
}

// Per-class selection params consumed by the cull shader (one row per class).
// Layout per class (8 floats): weight, density, shadePreference,
// moisturePreference, forestEdgeBias, heightPreferenceCode, enabled, reserved.
export function packUnderstoryRingClassParams(
  settings: UnderstorySettings,
  scratch: Float32Array = new Float32Array(UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32),
): Float32Array {
  scratch.fill(0);
  UNDERSTORY_CLASSES.forEach((cls, index) => {
    const config = settings.classes[cls];
    const base = index * UNDERSTORY_RING_CLASS_STRIDE_F32;
    scratch[base + 0] = config.weight;
    scratch[base + 1] = config.density;
    scratch[base + 2] = config.shadePreference;
    scratch[base + 3] = config.moisturePreference;
    scratch[base + 4] = config.forestEdgeBias;
    scratch[base + 5] = heightPreferenceCode(cls, settings);
    scratch[base + 6] = config.enabled ? 1 : 0;
    scratch[base + 7] = 0;
  });
  return scratch;
}

// Global ring uniform (7 vec4 lanes). The cull shader reads this as
// UnderstoryRingParams; Phase 2 WGSL must keep this layout in sync.
export function packUnderstoryRingParams(
  settings: UnderstorySettings,
  params: UnderstoryRingDispatchParams,
  scratch: ArrayBuffer = new ArrayBuffer(UNDERSTORY_RING_PARAM_BYTES),
): ArrayBuffer {
  const f32 = new Float32Array(scratch);
  const u32 = new Uint32Array(scratch);
  const ecology = settings.ecology;
  f32.fill(0);
  u32.fill(0);
  // lane 0 — center_radius
  f32[0] = params.centerX;
  f32[1] = params.centerZ;
  f32[2] = settings.distanceM;
  f32[3] = params.worldCells;
  // lane 1 — accept_a
  f32[4] = understoryRingCell(settings);
  f32[5] = settings.placement.minHeightM;
  f32[6] = settings.placement.maxHeightM;
  f32[7] = settings.placement.slopeMinY;
  // lane 2 — accept_b
  f32[8] = settings.placement.minGroundWeight;
  f32[9] = settings.placement.minTreeInfluence;
  f32[10] = ecology.enabled ? 1 : 0;
  f32[11] = 0;
  // lane 3 — ecology_a
  f32[12] = ecology.forestInfluenceScaleM;
  f32[13] = ecology.forestEdgeWidthM;
  f32[14] = ecology.moistureNoiseScaleM;
  f32[15] = ecology.densityNoiseScaleM;
  // lane 4 — ecology_b
  f32[16] = ecology.moistureStrength;
  f32[17] = ecology.shadeStrength;
  f32[18] = ecology.clearingPreference;
  f32[19] = ecology.densityNoiseStrength;
  // lane 5 — ecology_c
  f32[20] = ecology.deadfallOldForestBias;
  f32[21] = 0;
  f32[22] = 0;
  f32[23] = 0;
  // lane 6 — settings_u (u32)
  u32[24] = Math.max(0, Math.floor(params.maxInstancesPerGroup)) >>> 0;
  u32[25] = understoryRingGrid(settings) >>> 0;
  u32[26] = settings.seed >>> 0;
  u32[27] = UNDERSTORY_RING_GROUP_COUNT >>> 0;
  // lane 7 — settings_extra (u32)
  u32[28] = Math.max(0, Math.floor(params.indexCount)) >>> 0;
  return scratch;
}
