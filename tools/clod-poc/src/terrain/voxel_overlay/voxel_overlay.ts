import type { SavedCaveEntrance, SavedCaveSystem } from "../../save/save_schema_types.js";

export interface VoxelOverlayBounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface VoxelVolumeStamp {
  readonly id: string;
  readonly hash: string;
  readonly operation: "carve" | "fill";
  readonly shape: "sphere" | "capsule";
  readonly start: readonly [number, number, number];
  readonly end?: readonly [number, number, number];
  readonly radiusM: number;
}

export interface VoxelRegionDefinition {
  readonly id: string;
  readonly bounds: VoxelOverlayBounds;
  readonly caveSystem: SavedCaveSystem | null;
  readonly caveEntrances: readonly SavedCaveEntrance[];
  readonly stamps: readonly VoxelVolumeStamp[];
}

export interface VoxelOverlaySource {
  readonly regions: readonly VoxelRegionDefinition[];
}

export const EMPTY_VOXEL_OVERLAY_SOURCE: VoxelOverlaySource = Object.freeze({ regions: Object.freeze([]) });
export const CAVE_TEST_ENTRANCE_X = 720;
export const CAVE_TEST_ENTRANCE_Z = 96;

let activeSource: VoxelOverlaySource = EMPTY_VOXEL_OVERLAY_SOURCE;
const residentBounds = new Map<string, Pick<VoxelOverlayBounds, "minX" | "minZ" | "maxX" | "maxZ">>();

export function normalizeVoxelOverlaySource(source: VoxelOverlaySource | null | undefined): VoxelOverlaySource {
  if (!source || source.regions.length === 0) return EMPTY_VOXEL_OVERLAY_SOURCE;
  return {
    regions: source.regions.map((region) => ({
      ...region,
      caveEntrances: region.caveEntrances.map((entrance) => ({ ...entrance })),
      stamps: region.stamps.map((stamp) => ({ ...stamp })),
    })),
  };
}

export function setVoxelOverlaySource(source: VoxelOverlaySource | null | undefined): void {
  activeSource = normalizeVoxelOverlaySource(source);
  residentBounds.clear();
}

export function getVoxelOverlaySource(): VoxelOverlaySource {
  return activeSource;
}

export function setVoxelOverlayResidentBounds(
  key: string,
  bounds: Pick<VoxelOverlayBounds, "minX" | "minZ" | "maxX" | "maxZ"> | null,
): void {
  if (bounds) residentBounds.set(key, bounds);
  else residentBounds.delete(key);
}

export function voxelOverlayHasResidentBounds(): boolean {
  return residentBounds.size > 0;
}

export function voxelOverlayPointIsResident(x: number, z: number): boolean {
  for (const bounds of residentBounds.values()) {
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return true;
  }
  return false;
}

function distanceToSegment(
  x: number,
  y: number,
  z: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const lengthSq = abx * abx + aby * aby + abz * abz;
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / lengthSq))
    : 0;
  return Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t), z - (a[2] + abz * t));
}

function stampSdf(stamp: VoxelVolumeStamp, x: number, y: number, z: number): number {
  if (stamp.shape === "capsule") {
    return distanceToSegment(x, y, z, stamp.start, stamp.end ?? stamp.start) - stamp.radiusM;
  }
  return Math.hypot(x - stamp.start[0], y - stamp.start[1], z - stamp.start[2]) - stamp.radiusM;
}

function seededUnit(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return value / 0xffffffff;
}

function applyProceduralCave(
  density: number,
  region: VoxelRegionDefinition,
  x: number,
  y: number,
  z: number,
): number {
  const system = region.caveSystem;
  if (!system || system.authored) return density;
  let composed = density;
  for (let index = 0; index < region.caveEntrances.length; index++) {
    const entrance = region.caveEntrances[index]!;
    const facingLength = Math.hypot(...entrance.facing) || 1;
    const fx = entrance.facing[0] / facingLength;
    const fy = entrance.facing[1] / facingLength;
    const fz = entrance.facing[2] / facingLength;
    const length = 22 + seededUnit(system.proceduralSeed, index * 2 + 1) * 10;
    const radius = 3.25 + seededUnit(system.proceduralSeed, index * 2 + 2) * 1.25;
    const start: [number, number, number] = [
      entrance.position[0] - fx * 2,
      entrance.position[1] - fy * 2,
      entrance.position[2] - fz * 2,
    ];
    const end: [number, number, number] = [
      entrance.position[0] + fx * length,
      entrance.position[1] + fy * length - 4,
      entrance.position[2] + fz * length,
    ];
    const tube = distanceToSegment(x, y, z, start, end) - radius;
    const chamberRadius = radius * 2.2;
    const chamber = Math.hypot(x - end[0], y - end[1], z - end[2]) - chamberRadius;
    composed = Math.min(composed, tube, chamber);
  }
  return composed;
}

export function composeVoxelOverlayDensity(
  baseDensity: number,
  x: number,
  y: number,
  z: number,
  source: VoxelOverlaySource = activeSource,
  regionRefs?: readonly string[],
): number {
  if (source.regions.length === 0) return baseDensity;
  const refSet = regionRefs ? new Set(regionRefs) : null;
  const regions = source.regions.filter((region) =>
    (!refSet || refSet.has(region.id))
    && x >= region.bounds.minX && x <= region.bounds.maxX
    && y >= region.bounds.minY && y <= region.bounds.maxY
    && z >= region.bounds.minZ && z <= region.bounds.maxZ);
  if (regions.length === 0) return baseDensity;
  let density = baseDensity;
  for (const region of regions) density = applyProceduralCave(density, region, x, y, z);
  for (const region of regions) {
    for (const stamp of region.stamps) {
      const sdf = stampSdf(stamp, x, y, z);
      density = stamp.operation === "carve" ? Math.min(density, sdf) : Math.max(density, -sdf);
    }
  }
  return density;
}

export function voxelOverlayIntersectsBounds(
  source: VoxelOverlaySource | null | undefined,
  bounds: Pick<VoxelOverlayBounds, "minX" | "minZ" | "maxX" | "maxZ">,
): boolean {
  return Boolean(source?.regions.some((region) =>
    region.bounds.maxX >= bounds.minX && region.bounds.minX <= bounds.maxX
    && region.bounds.maxZ >= bounds.minZ && region.bounds.minZ <= bounds.maxZ));
}

export function voxelOverlayHasContent(source: VoxelOverlaySource | null | undefined = activeSource): boolean {
  return Boolean(source?.regions.length);
}

export function sampleCaveEntranceCoverage(
  cellOriginX: number,
  cellOriginZ: number,
  cellSizeM: number,
  source: VoxelOverlaySource = activeSource,
): number {
  if (source.regions.length === 0 || cellSizeM <= 0) return 0;
  const centerX = cellOriginX + cellSizeM * 0.5;
  const centerZ = cellOriginZ + cellSizeM * 0.5;
  const cellRadius = cellSizeM * Math.SQRT1_2;
  for (const region of source.regions) {
    for (const entrance of region.caveEntrances) {
      if (Math.hypot(centerX - entrance.position[0], centerZ - entrance.position[2]) <= entrance.farMaskRadiusM + cellRadius) {
        const entranceArea = Math.PI * entrance.farMaskRadiusM * entrance.farMaskRadiusM;
        return Math.min(1, entranceArea / (cellSizeM * cellSizeM));
      }
    }
  }
  return 0;
}

export function isCaveEntranceBoundary(
  x: number,
  z: number,
  source: VoxelOverlaySource = activeSource,
): boolean {
  for (const region of source.regions) {
    for (const entrance of region.caveEntrances) {
      if (Math.hypot(x - entrance.position[0], z - entrance.position[2]) <= entrance.farMaskRadiusM) return true;
    }
  }
  return false;
}

export function buildCaveTestVoxelOverlay(surfaceHeight: (x: number, z: number) => number): VoxelOverlaySource {
  const x = CAVE_TEST_ENTRANCE_X;
  const z = CAVE_TEST_ENTRANCE_Z;
  const y = Math.fround(surfaceHeight(x, z) - 2);
  const system: SavedCaveSystem = {
    id: "cave-test-system",
    entranceIds: ["cave-test-entrance"],
    proceduralSeed: 0x5a17,
    authored: false,
    criticalPathIds: [],
    revision: 1,
  };
  const entrance: SavedCaveEntrance = {
    id: "cave-test-entrance",
    position: [x, y, z],
    facing: [0, -0.08, 1],
    caveSystemId: system.id,
    farMaskRadiusM: 12,
    revision: 1,
  };
  return {
    regions: [{
      id: system.id,
      bounds: { minX: x - 12, minY: y - 18, minZ: z - 12, maxX: x + 14, maxY: y + 10, maxZ: z + 54 },
      caveSystem: system,
      caveEntrances: [entrance],
      stamps: [],
    }],
  };
}
