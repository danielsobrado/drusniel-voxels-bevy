import { setActiveErodedMacroField, toErodedMacroField } from "../world/erosion/integration.js";
import { sampleErodedMacroHeight } from "../world/hydrology_graph/hydrology_graph_erosion.js";
import type { HydrologyGraph, HydrologyRiverRecord } from "../world/hydrology_graph/hydrology_graph.js";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

interface Segment {
  readonly river: HydrologyRiverRecord;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly waterA: number;
  readonly waterB: number;
  readonly widthA: number;
  readonly widthB: number;
  readonly dischargeA: number;
  readonly dischargeB: number;
}

interface SegmentIndex {
  readonly bucketSize: number;
  readonly buckets: Map<string, Segment[]>;
}

export interface GraphHydrologySampler {
  sample(x: number, z: number): HydrologySample;
  carveHeight(x: number, z: number, baseHeight: number, config: GraphTerrainCarveConfig): number;
}

export interface GraphTerrainCarveConfig {
  readonly depthM: number;
  readonly power: number;
  readonly lakeBedDepthM: number;
}

const SEGMENT_BUCKET_SIZE_M = 64;
const segmentIndexCache = new WeakMap<HydrologyGraph, SegmentIndex>();
const lakeShoreDistanceCache = new WeakMap<HydrologyGraph, Float32Array>();

export function lakeShoreDistanceField(graph: HydrologyGraph): Float32Array {
  const cached = lakeShoreDistanceCache.get(graph);
  if (cached) return cached;
  const { resX, resZ, spacingM, lakeIndex } = graph.macro;
  const distance = new Float32Array(lakeIndex.length);
  const infinite = 1e9;
  for (let z = 0; z < resZ; z++) {
    for (let x = 0; x < resX; x++) {
      const index = z * resX + x;
      const lake = lakeIndex[index]!;
      if (lake < 0) continue;
      const boundary = x === 0 || z === 0 || x === resX - 1 || z === resZ - 1
        || lakeIndex[index - 1] !== lake || lakeIndex[index + 1] !== lake
        || lakeIndex[index - resX] !== lake || lakeIndex[index + resX] !== lake;
      distance[index] = boundary ? 0 : infinite;
    }
  }
  const relax = (index: number, neighbor: number, cost: number): void => {
    if (lakeIndex[neighbor] !== lakeIndex[index]) return;
    distance[index] = Math.min(distance[index]!, distance[neighbor]! + cost);
  };
  const diagonal = Math.SQRT2;
  for (let z = 0; z < resZ; z++) for (let x = 0; x < resX; x++) {
    const index = z * resX + x;
    if (lakeIndex[index]! < 0) continue;
    if (x > 0) relax(index, index - 1, 1);
    if (z > 0) relax(index, index - resX, 1);
    if (x > 0 && z > 0) relax(index, index - resX - 1, diagonal);
    if (x < resX - 1 && z > 0) relax(index, index - resX + 1, diagonal);
  }
  for (let z = resZ - 1; z >= 0; z--) for (let x = resX - 1; x >= 0; x--) {
    const index = z * resX + x;
    if (lakeIndex[index]! < 0) continue;
    if (x < resX - 1) relax(index, index + 1, 1);
    if (z < resZ - 1) relax(index, index + resX, 1);
    if (x < resX - 1 && z < resZ - 1) relax(index, index + resX + 1, diagonal);
    if (x > 0 && z < resZ - 1) relax(index, index + resX - 1, diagonal);
  }
  for (let index = 0; index < distance.length; index++) distance[index] *= spacingM;
  lakeShoreDistanceCache.set(graph, distance);
  return distance;
}

function graphSegmentIndex(graph: HydrologyGraph): SegmentIndex {
  const cached = segmentIndexCache.get(graph);
  if (cached) return cached;
  const buckets = new Map<string, Segment[]>();
  const add = (segment: Segment): void => {
    const halfWidth = Math.max(segment.widthA, segment.widthB) * 0.5;
    const minX = Math.floor((Math.min(segment.ax, segment.bx) - halfWidth) / SEGMENT_BUCKET_SIZE_M);
    const maxX = Math.floor((Math.max(segment.ax, segment.bx) + halfWidth) / SEGMENT_BUCKET_SIZE_M);
    const minZ = Math.floor((Math.min(segment.az, segment.bz) - halfWidth) / SEGMENT_BUCKET_SIZE_M);
    const maxZ = Math.floor((Math.max(segment.az, segment.bz) + halfWidth) / SEGMENT_BUCKET_SIZE_M);
    for (let bz = minZ; bz <= maxZ; bz++) for (let bx = minX; bx <= maxX; bx++) {
      const key = `${bx},${bz}`;
      const list = buckets.get(key) ?? [];
      list.push(segment);
      buckets.set(key, list);
    }
  };
  for (const river of graph.rivers) {
    for (let index = 1; index < river.vertices.length; index++) {
      const a = river.vertices[index - 1]!;
      const b = river.vertices[index]!;
      add({
        river,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        waterA: a.waterY,
        waterB: b.waterY,
        widthA: a.widthM,
        widthB: b.widthM,
        dischargeA: a.discharge,
        dischargeB: b.discharge,
      });
    }
  }
  const built = { bucketSize: SEGMENT_BUCKET_SIZE_M, buckets };
  segmentIndexCache.set(graph, built);
  return built;
}

function activateErosionAuthority(graph: HydrologyGraph): void {
  if (graph.macro.erosion) setActiveErodedMacroField(toErodedMacroField(graph.macro.erosion));
}

function canonicalBaseHeight(graph: HydrologyGraph, x: number, z: number, fallback: number): number {
  return graph.macro.erosion ? sampleErodedMacroHeight(graph.macro.erosion, x, z) : fallback;
}

function lakeAt(graph: HydrologyGraph, x: number, z: number): { index: number; cell: number } {
  const macro = graph.macro;
  const gx = Math.round((x - macro.originM.x) / macro.spacingM);
  const gz = Math.round((z - macro.originM.z) / macro.spacingM);
  if (gx < 0 || gz < 0 || gx >= macro.resX || gz >= macro.resZ) return { index: -1, cell: -1 };
  const cell = gz * macro.resX + gx;
  return { index: macro.lakeIndex[cell]!, cell };
}

function carveCanonicalHeight(
  graph: HydrologyGraph,
  segmentIndex: SegmentIndex,
  x: number,
  z: number,
  fallbackBaseHeight: number,
  config: GraphTerrainCarveConfig,
): number {
  const baseHeight = canonicalBaseHeight(graph, x, z, fallbackBaseHeight);
  const lakeLocation = lakeAt(graph, x, z);
  if (lakeLocation.index >= 0) {
    const lake = graph.lakes[lakeLocation.index]!;
    if (lake.levelM > baseHeight + 0.01) return Math.min(baseHeight, lake.levelM - Math.max(0.05, config.lakeBedDepthM));
  }
  const candidates = segmentIndex.buckets.get(
    `${Math.floor(x / segmentIndex.bucketSize)},${Math.floor(z / segmentIndex.bucketSize)}`,
  ) ?? [];
  let carved = baseHeight;
  for (const segment of candidates) {
    const dx = segment.bx - segment.ax;
    const dz = segment.bz - segment.az;
    const denominator = dx * dx + dz * dz;
    const t = denominator > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / denominator)) : 0;
    const distance = Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
    const halfWidth = Math.max(0.5, (segment.widthA + (segment.widthB - segment.widthA) * t) * 0.5);
    if (distance >= halfWidth) continue;
    const strength = Math.pow(1 - distance / halfWidth, Math.max(0.1, config.power));
    const waterY = segment.waterA + (segment.waterB - segment.waterA) * t;
    const depth = Math.max(0.05, config.depthM) * strength;
    carved = Math.min(carved, baseHeight - depth, waterY - Math.min(depth, 0.3 + depth * 0.35));
  }
  return carved;
}

function closestRiver(segmentIndex: SegmentIndex, x: number, z: number): { segment: Segment; t: number; distance: number } | null {
  const candidates = segmentIndex.buckets.get(
    `${Math.floor(x / segmentIndex.bucketSize)},${Math.floor(z / segmentIndex.bucketSize)}`,
  ) ?? [];
  let best: { segment: Segment; t: number; distance: number } | null = null;
  for (const segment of candidates) {
    const dx = segment.bx - segment.ax;
    const dz = segment.bz - segment.az;
    const denominator = dx * dx + dz * dz;
    const t = denominator > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / denominator)) : 0;
    const distance = Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
    const width = segment.widthA + (segment.widthB - segment.widthA) * t;
    if (distance > width * 0.5 || (best && distance >= best.distance)) continue;
    best = { segment, t, distance };
  }
  return best;
}

function numericId(id: string): number {
  const hex = id.slice(id.lastIndexOf(":") + 1);
  return (Number.parseInt(hex, 16) >>> 0) || 1;
}

function drySample(terrainY: number, sentinel: number): HydrologySample {
  return {
    terrainY,
    waterY: terrainY - sentinel,
    depth: 0,
    bodyMask: 0,
    lakeMask: 0,
    riverMask: 0,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    riverDepth: 0,
    waterYFar: terrainY - sentinel,
    moisture: 0,
    bodyKind: HYDROLOGY_BODY_DRY,
    bodyId: 0,
    shoreDistance: sentinel,
  };
}

function lakeSample(terrainY: number, waterY: number, lakeId: string, sentinel: number, shoreDistance: number): HydrologySample {
  return {
    ...drySample(terrainY, sentinel),
    waterY,
    waterYFar: waterY,
    depth: waterY - terrainY,
    bodyMask: 1,
    lakeMask: 1,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_LAKE,
    bodyId: numericId(lakeId),
    shoreDistance,
  };
}

function riverSample(
  terrainY: number,
  segment: Segment,
  t: number,
  distance: number,
  sentinel: number,
): HydrologySample {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const length = Math.hypot(dx, dz) || 1;
  const discharge = segment.dischargeA + (segment.dischargeB - segment.dischargeA) * t;
  const width = segment.widthA + (segment.widthB - segment.widthA) * t;
  const waterY = Math.max(terrainY + 0.05, segment.waterA + (segment.waterB - segment.waterA) * t);
  const strength = Math.min(1, Math.log2(Math.max(2, discharge)) / 16);
  return {
    ...drySample(terrainY, sentinel),
    waterY,
    waterYFar: waterY,
    depth: waterY - terrainY,
    bodyMask: 1,
    riverMask: 1,
    flowX: dx / length * strength,
    flowZ: dz / length * strength,
    flowStrength: strength,
    riverDepth: waterY - terrainY,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: numericId(segment.river.id),
    shoreDistance: Math.max(0, width * 0.5 - distance),
  };
}

function sampleGraphWater(
  graph: HydrologyGraph,
  segmentIndex: SegmentIndex,
  lakeShoreDistance: Float32Array,
  terrainY: number,
  x: number,
  z: number,
  drySentinelDepthM: number,
): HydrologySample {
  const lakeLocation = lakeAt(graph, x, z);
  if (lakeLocation.index >= 0) {
    const lake = graph.lakes[lakeLocation.index]!;
    if (lake.levelM > terrainY + 0.01) {
      return lakeSample(terrainY, lake.levelM, lake.id, drySentinelDepthM, lakeShoreDistance[lakeLocation.cell]!);
    }
  }
  const best = closestRiver(segmentIndex, x, z);
  return best
    ? riverSample(terrainY, best.segment, best.t, best.distance, drySentinelDepthM)
    : drySample(terrainY, drySentinelDepthM);
}

/** Uses the graph and its persisted erosion field as the only generated-base authority. */
export function createGraphHydrologySampler(
  graph: HydrologyGraph,
  terrain: TerrainHeightSampler,
  drySentinelDepthM = 2,
): GraphHydrologySampler {
  activateErosionAuthority(graph);
  const segmentIndex = graphSegmentIndex(graph);
  const shoreDistance = lakeShoreDistanceField(graph);
  return {
    carveHeight: (x, z, baseHeight, config) => carveCanonicalHeight(graph, segmentIndex, x, z, baseHeight, config),
    sample(x, z) {
      const fallback = terrain.surfaceHeight(x, z);
      const terrainY = canonicalBaseHeight(graph, x, z, fallback);
      return sampleGraphWater(graph, segmentIndex, shoreDistance, terrainY, x, z, drySentinelDepthM);
    },
  };
}

/** Samples water against the graph-carved canonical erosion surface. */
export function createCarvedGraphHydrologySampler(
  graph: HydrologyGraph,
  terrain: TerrainHeightSampler,
  carve: GraphTerrainCarveConfig,
  drySentinelDepthM = 2,
): GraphHydrologySampler {
  activateErosionAuthority(graph);
  const segmentIndex = graphSegmentIndex(graph);
  const shoreDistance = lakeShoreDistanceField(graph);
  return {
    carveHeight: (x, z, baseHeight, config) => carveCanonicalHeight(graph, segmentIndex, x, z, baseHeight, config),
    sample(x, z) {
      const fallback = terrain.surfaceHeight(x, z);
      const terrainY = carveCanonicalHeight(graph, segmentIndex, x, z, fallback, carve);
      return sampleGraphWater(graph, segmentIndex, shoreDistance, terrainY, x, z, drySentinelDepthM);
    },
  };
}
