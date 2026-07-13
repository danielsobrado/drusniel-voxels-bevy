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
  readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number;
  readonly waterA: number; readonly waterB: number;
  readonly widthA: number; readonly widthB: number;
  readonly dischargeA: number; readonly dischargeB: number;
}

interface SegmentIndex {
  readonly bucketSize: number;
  readonly buckets: Map<string, Segment[]>;
}

const SEGMENT_BUCKET_SIZE_M = 64;
const segmentIndexCache = new WeakMap<HydrologyGraph, SegmentIndex>();

function graphSegmentIndex(graph: HydrologyGraph): SegmentIndex {
  const cached = segmentIndexCache.get(graph);
  if (cached) return cached;
  const bucketSize = SEGMENT_BUCKET_SIZE_M;
  const buckets = new Map<string, Segment[]>();
  const add = (segment: Segment): void => {
    const halfWidth = Math.max(segment.widthA, segment.widthB) * 0.5;
    const minX = Math.floor((Math.min(segment.ax, segment.bx) - halfWidth) / bucketSize);
    const maxX = Math.floor((Math.max(segment.ax, segment.bx) + halfWidth) / bucketSize);
    const minZ = Math.floor((Math.min(segment.az, segment.bz) - halfWidth) / bucketSize);
    const maxZ = Math.floor((Math.max(segment.az, segment.bz) + halfWidth) / bucketSize);
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
      add({ river, ax: a.x, az: a.z, bx: b.x, bz: b.z, waterA: a.waterY, waterB: b.waterY,
        widthA: a.widthM, widthB: b.widthM, dischargeA: a.discharge, dischargeB: b.discharge });
    }
  }
  const built = { bucketSize, buckets };
  segmentIndexCache.set(graph, built);
  return built;
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

/**
 * Makes water depth and shoreline tests use the carved canonical terrain
 * surface, while retaining the same graph records used to carve its tiles.
 */
export function createCarvedGraphHydrologySampler(
  graph: HydrologyGraph,
  terrain: TerrainHeightSampler,
  carve: GraphTerrainCarveConfig,
  drySentinelDepthM = 2,
): GraphHydrologySampler {
  const base = createGraphHydrologySampler(graph, terrain, drySentinelDepthM);
  const { bucketSize, buckets } = graphSegmentIndex(graph);
  return {
    carveHeight: base.carveHeight,
    sample(x, z) {
      const baseHeight = terrain.surfaceHeight(x, z);
      const macro = graph.macro;
      const gx = Math.round((x - macro.originM.x) / macro.spacingM);
      const gz = Math.round((z - macro.originM.z) / macro.spacingM);
      const lakeIndex = gx >= 0 && gz >= 0 && gx < macro.resX && gz < macro.resZ
        ? macro.lakeIndex[gz * macro.resX + gx]!
        : -1;
      const lake = lakeIndex >= 0 ? graph.lakes[lakeIndex]! : null;
      if (lake && lake.levelM > baseHeight + 0.01) {
        const terrainY = Math.min(baseHeight, lake.levelM - Math.max(0.05, carve.lakeBedDepthM));
        return lakeSample(terrainY, lake.levelM, lake.id, drySentinelDepthM);
      }

      const candidates = buckets.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`) ?? [];
      let terrainY = baseHeight;
      let best: { segment: Segment; t: number; distance: number } | null = null;
      for (const segment of candidates) {
        const dx = segment.bx - segment.ax;
        const dz = segment.bz - segment.az;
        const denom = dx * dx + dz * dz;
        const t = denom > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / denom)) : 0;
        const distance = Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
        const width = segment.widthA + (segment.widthB - segment.widthA) * t;
        const halfWidth = Math.max(0.5, width * 0.5);
        if (distance < halfWidth) {
          const strength = Math.pow(1 - distance / halfWidth, Math.max(0.1, carve.power));
          const graphWaterY = segment.waterA + (segment.waterB - segment.waterA) * t;
          const depth = Math.max(0.05, carve.depthM) * strength;
          terrainY = Math.min(
            terrainY,
            baseHeight - depth,
            graphWaterY - Math.min(depth, 0.3 + depth * 0.35),
          );
        }
        if (distance > width * 0.5 || (best && distance >= best.distance)) continue;
        best = { segment, t, distance };
      }

      if (lake && lake.levelM > terrainY + 0.01) {
        return lakeSample(terrainY, lake.levelM, lake.id, drySentinelDepthM);
      }
      if (!best) return drySample(terrainY, drySentinelDepthM);
      return riverSample(terrainY, best.segment, best.t, best.distance, drySentinelDepthM);
    },
  };
}

function numericId(id: string): number {
  const hex = id.slice(id.lastIndexOf(":") + 1);
  return (Number.parseInt(hex, 16) >>> 0) || 1;
}

function drySample(terrainY: number, sentinel: number): HydrologySample {
  return { terrainY, waterY: terrainY - sentinel, depth: 0, bodyMask: 0, lakeMask: 0, riverMask: 0,
    flowX: 0, flowZ: 0, flowStrength: 0, riverDepth: 0, waterYFar: terrainY - sentinel,
    moisture: 0, bodyKind: HYDROLOGY_BODY_DRY, bodyId: 0, shoreDistance: sentinel };
}

function lakeSample(terrainY: number, waterY: number, lakeId: string, sentinel: number): HydrologySample {
  return { ...drySample(terrainY, sentinel), waterY, waterYFar: waterY,
    depth: waterY - terrainY, bodyMask: 1, lakeMask: 1, moisture: 1,
    bodyKind: HYDROLOGY_BODY_LAKE, bodyId: numericId(lakeId), shoreDistance: 0 };
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
  return { ...drySample(terrainY, sentinel), waterY, waterYFar: waterY,
    depth: waterY - terrainY, bodyMask: 1, riverMask: 1, flowX: dx / length * strength,
    flowZ: dz / length * strength, flowStrength: strength, riverDepth: waterY - terrainY,
    moisture: 1, bodyKind: HYDROLOGY_BODY_RIVER, bodyId: numericId(segment.river.id),
    shoreDistance: Math.max(0, width * 0.5 - distance) };
}

export function createGraphHydrologySampler(
  graph: HydrologyGraph,
  terrain: TerrainHeightSampler,
  drySentinelDepthM = 2,
): GraphHydrologySampler {
  const { bucketSize, buckets } = graphSegmentIndex(graph);

  return {
    carveHeight(x, z, baseHeight, config) {
      const macro = graph.macro;
      const gx = Math.round((x - macro.originM.x) / macro.spacingM);
      const gz = Math.round((z - macro.originM.z) / macro.spacingM);
      if (gx >= 0 && gz >= 0 && gx < macro.resX && gz < macro.resZ) {
        const lakeIndex = macro.lakeIndex[gz * macro.resX + gx]!;
        if (lakeIndex >= 0) {
          const lake = graph.lakes[lakeIndex]!;
          if (lake.levelM > baseHeight + 0.01) return Math.min(baseHeight, lake.levelM - Math.max(0.05, config.lakeBedDepthM));
        }
      }
      const candidates = buckets.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`) ?? [];
      let carved = baseHeight;
      for (const segment of candidates) {
        const dx = segment.bx - segment.ax;
        const dz = segment.bz - segment.az;
        const denom = dx * dx + dz * dz;
        const t = denom > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / denom)) : 0;
        const distance = Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
        const halfWidth = Math.max(0.5, (segment.widthA + (segment.widthB - segment.widthA) * t) * 0.5);
        if (distance >= halfWidth) continue;
        const strength = Math.pow(1 - distance / halfWidth, Math.max(0.1, config.power));
        const waterY = segment.waterA + (segment.waterB - segment.waterA) * t;
        const depth = Math.max(0.05, config.depthM) * strength;
        carved = Math.min(carved, baseHeight - depth, waterY - Math.min(depth, 0.3 + depth * 0.35));
      }
      return carved;
    },
    sample(x, z) {
      const terrainY = terrain.surfaceHeight(x, z);
      const macro = graph.macro;
      const gx = Math.round((x - macro.originM.x) / macro.spacingM);
      const gz = Math.round((z - macro.originM.z) / macro.spacingM);
      if (gx >= 0 && gz >= 0 && gx < macro.resX && gz < macro.resZ) {
        const lakeIndex = macro.lakeIndex[gz * macro.resX + gx]!;
        if (lakeIndex >= 0) {
          const lake = graph.lakes[lakeIndex]!;
          if (lake.levelM <= terrainY + 0.01) return drySample(terrainY, drySentinelDepthM);
          const waterY = lake.levelM;
          return lakeSample(terrainY, waterY, lake.id, drySentinelDepthM);
        }
      }
      const candidates = buckets.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`) ?? [];
      let best: { segment: Segment; t: number; distance: number } | null = null;
      for (const segment of candidates) {
        const dx = segment.bx - segment.ax;
        const dz = segment.bz - segment.az;
        const denom = dx * dx + dz * dz;
        const t = denom > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / denom)) : 0;
        const distance = Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
        const width = segment.widthA + (segment.widthB - segment.widthA) * t;
        if (distance > width * 0.5 || (best && distance >= best.distance)) continue;
        best = { segment, t, distance };
      }
      if (!best) return drySample(terrainY, drySentinelDepthM);
      return riverSample(terrainY, best.segment, best.t, best.distance, drySentinelDepthM);
    },
  };
}
