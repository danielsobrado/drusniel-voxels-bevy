// WaterField — pure spatial service that answers water surface queries for the
// fake lake/river bodies defined in config/water.yaml.
//
// Dry areas return terrainY - drySentinelDepth so the water mesh sits below the
// terrain and is depth-tested out (or discarded in the shader when depth <= 0).
// Lakes are flat at terrainHeight(center) + levelOffset. Rivers use a capsule
// distance to the configured polyline with a sloped level along its length.
//
// This module has NO dependency on the CLOD page builder. It only reads the
// terrain height sampler (an adapter) so water can track the terrain surface.
import type { LakeBodyConfig, RiverBodyConfig, WaterConfig } from "./waterConfig.js";

/** Adapter for the terrain surface height used to anchor fake water levels. */
export interface TerrainHeightSampler {
  surfaceHeight(x: number, z: number): number;
}

export interface WaterFlow {
  x: number;
  z: number;
  speed: number;
}

export interface WaterFieldResult {
  waterY: number;
  terrainY: number;
  depth: number;
  bodyMask: number;
  flow: WaterFlow;
}

const FLOW_EPSILON = 1e-6;

interface LakeRuntime {
  center: [number, number];
  radius: [number, number];
  invRadius: [number, number];
  levelOffset: number;
  waterLevel: number;
}

interface RiverRuntime {
  points: Array<[number, number]>;
  segLengths: number[];
  totalLength: number;
  halfWidth: number;
  levelOffset: number;
  downstreamDrop: number;
  /** Water level at the polyline start; slopes down by downstreamDrop over totalLength. */
  startLevel: number;
}

function buildLakeRuntime(lake: LakeBodyConfig, sampler: TerrainHeightSampler): LakeRuntime {
  const rx = Math.max(0.001, lake.radius[0]);
  const rz = Math.max(0.001, lake.radius[1]);
  const centerTerrainY = sampler.surfaceHeight(lake.center[0], lake.center[1]);
  return {
    center: [...lake.center] as [number, number],
    radius: [rx, rz],
    invRadius: [1 / rx, 1 / rz],
    levelOffset: lake.levelOffset,
    waterLevel: centerTerrainY + lake.levelOffset,
  };
}

function buildRiverRuntime(river: RiverBodyConfig, sampler: TerrainHeightSampler): RiverRuntime {
  const points = river.points.map((p) => [...p] as [number, number]);
  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    segLengths.push(len);
    totalLength += len;
  }
  const startTerrainY = sampler.surfaceHeight(points[0][0], points[0][1]);
  return {
    points,
    segLengths,
    totalLength: Math.max(1e-3, totalLength),
    halfWidth: Math.max(0.05, river.width * 0.5),
    levelOffset: river.levelOffset,
    downstreamDrop: river.downstreamDrop,
    startLevel: startTerrainY + river.levelOffset,
  };
}

/** Distance from point p to segment a-b, plus projection t in [0,1] along the segment. */
function pointSegmentInfo(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { dist: number; t: number; closestX: number; closestZ: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const segLenSq = dx * dx + dz * dz;
  let t = 0;
  if (segLenSq > FLOW_EPSILON) {
    t = ((px - ax) * dx + (pz - az) * dz) / segLenSq;
    t = Math.min(1, Math.max(0, t));
  }
  const closestX = ax + dx * t;
  const closestZ = az + dz * t;
  const dist = Math.hypot(px - closestX, pz - closestZ);
  return { dist, t, closestX, closestZ };
}

/** Smooth minimum so body overlaps blend without hard seams at capsule/ellipse edges. */
function smoothMask(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class WaterField {
  private readonly sampler: TerrainHeightSampler;
  private readonly drySentinelDepth: number;
  private readonly lakes: LakeRuntime[];
  private readonly rivers: RiverRuntime[];

  constructor(config: WaterConfig, sampler: TerrainHeightSampler) {
    this.sampler = sampler;
    this.drySentinelDepth = config.drySentinelDepth;
    this.lakes = config.fakeBodies.lakes.map((lake) => buildLakeRuntime(lake, sampler));
    this.rivers = config.fakeBodies.rivers.map((river) => buildRiverRuntime(river, sampler));
  }

  /** Terrain surface height at (x,z), exposed for the clipmap vertex fill. */
  terrainYAt(x: number, z: number): number {
    return this.sampler.surfaceHeight(x, z);
  }

  /** Water surface height at (x,z). Dry areas return terrainY - drySentinelDepth. */
  waterYAt(x: number, z: number): number {
    return this.sample(x, z).waterY;
  }

  /** Water depth (waterY - terrainY). Negative in dry areas. */
  depthAt(x: number, z: number): number {
    return this.sample(x, z).depth;
  }

  /** Flow direction and speed at (x,z). Lakes ~0; rivers follow the closest segment. */
  flowAt(x: number, z: number): WaterFlow {
    return this.sample(x, z).flow;
  }

  /** Body mask in [0,1]: lake/river occupancy, blended at edges. 0 in dry areas. */
  bodyMaskAt(x: number, z: number): number {
    return this.sample(x, z).bodyMask;
  }

  /** Full result in one pass (cheaper than four separate calls for vertex fill). */
  sample(x: number, z: number): WaterFieldResult {
    const terrainY = this.sampler.surfaceHeight(x, z);

    let bestLakeLevel = Number.POSITIVE_INFINITY;
    let bestLakeWeight = 0;
    let maxLakeMask = 0;

    for (const lake of this.lakes) {
      const dx = (x - lake.center[0]) * lake.invRadius[0];
      const dz = (z - lake.center[1]) * lake.invRadius[1];
      const r2 = dx * dx + dz * dz;

      // Soft edge over the outer 6% of the ellipse so shore foam has a gradient.
      const edgeStart = 0.94 * 0.94;
      const weight = 1 - smoothMask(edgeStart, 1.0, r2);
      if (weight > 0) {
        maxLakeMask = Math.max(maxLakeMask, weight);
        // Inside the lake the water level is flat; if terrain is above the lake,
        // depth goes negative and the shader discards.
        const level = lake.waterLevel;
        if (weight > bestLakeWeight) {
          bestLakeWeight = weight;
          bestLakeLevel = level;
        }
      }
    }

    let bestRiverLevel = Number.POSITIVE_INFINITY;
    let bestRiverWeight = 0;
    let maxRiverMask = 0;

    let bestFlowSpeed = 0;
    let bestFlowX = 0;
    let bestFlowZ = 0;
    let bestFlowWeight = 0;

    for (const river of this.rivers) {
      let bestDist = Infinity;
      let bestSegIdx = 0;
      let accLen = 0;
      let bestAccLen = 0;

      for (let i = 0; i < river.points.length - 1; i++) {
        const info = pointSegmentInfo(
          x,
          z,
          river.points[i][0],
          river.points[i][1],
          river.points[i + 1][0],
          river.points[i + 1][1],
        );
        if (info.dist < bestDist) {
          bestDist = info.dist;
          bestSegIdx = i;
          bestAccLen = accLen + river.segLengths[i] * info.t;
        }
        accLen += river.segLengths[i];
      }

      // Calculations for Mask
      const m = 1 - smoothMask(river.halfWidth * 0.9, river.halfWidth, bestDist);
      maxRiverMask = Math.max(maxRiverMask, m);

      // Calculations for Level
      const inside = bestDist <= river.halfWidth;
      const proximity = 1 - smoothMask(river.halfWidth * 0.9, river.halfWidth, bestDist);
      if (inside || proximity > 0) {
        const weight = inside ? 1 : proximity;
        const frac = bestAccLen / river.totalLength;
        const sloped = river.startLevel - frac * river.downstreamDrop;
        const level = sloped;
        if (weight > bestRiverWeight) {
          bestRiverWeight = weight;
          bestRiverLevel = level;
        }
      }

      // Calculations for Flow
      const flowProximity = 1 - smoothMask(river.halfWidth * 0.5, river.halfWidth, bestDist);
      if (flowProximity > 0) {
        const ax = river.points[bestSegIdx][0];
        const az = river.points[bestSegIdx][1];
        const bx = river.points[bestSegIdx + 1][0];
        const bz = river.points[bestSegIdx + 1][1];
        let dirX = bx - ax;
        let dirZ = bz - az;
        const len = Math.hypot(dirX, dirZ);
        if (len >= FLOW_EPSILON) {
          dirX /= len;
          dirZ /= len;
          if (flowProximity > bestFlowWeight) {
            bestFlowWeight = flowProximity;
            bestFlowSpeed = (river.downstreamDrop / Math.max(1, river.totalLength)) * 60;
            bestFlowX = dirX;
            bestFlowZ = dirZ;
          }
        }
      }
    }

    const bodyMask = Math.min(1, Math.max(0, Math.max(maxLakeMask, maxRiverMask)));

    let waterY = terrainY - this.drySentinelDepth;
    if (bestLakeWeight > 0 || bestRiverWeight > 0) {
      if (bestLakeWeight > bestRiverWeight) {
        waterY = bestLakeLevel;
      } else {
        waterY = bestRiverLevel;
      }
    }

    const flow = bestFlowWeight > 0
      ? { x: bestFlowX, z: bestFlowZ, speed: bestFlowSpeed }
      : { x: 0, z: 0, speed: 0 };

    return {
      waterY,
      terrainY,
      depth: waterY - terrainY,
      bodyMask,
      flow,
    };
  }
}
