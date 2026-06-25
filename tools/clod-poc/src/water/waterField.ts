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
import type { HydrologySystem } from "./hydrologySystem.js";

/** Adapter for the terrain surface height used to anchor fake water levels. */
export interface TerrainHeightSampler {
  surfaceHeight(x: number, z: number): number;
}

export interface WaterFlow {
  x: number;
  z: number;
  speed: number;
  progress: number;
  drop: number;
}

export interface WaterFieldResult {
  waterY: number;
  terrainY: number;
  depth: number;
  bodyMask: number;
  flow: WaterFlow;
}

export interface EdgeOceanSettings {
  enabled: boolean;
  startDistance: number;
  fullDepthDistance: number;
  minDepth: number;
  maxDepth: number;
  level: number;
}

export const DEFAULT_EDGE_OCEAN_SETTINGS: EdgeOceanSettings = {
  enabled: false,
  startDistance: 96,
  fullDepthDistance: 32,
  minDepth: 2,
  maxDepth: 18,
  level: 18,
};

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
  levelPrefix: number[];
  levels: number[];
  totalLength: number;
  halfWidth: number;
  levelOffset: number;
  downstreamDrop: number;
}

function buildLakeRuntime(lake: LakeBodyConfig, sampler: TerrainHeightSampler): LakeRuntime {
  const rx = Math.max(0.001, lake.radius[0]);
  const rz = Math.max(0.001, lake.radius[1]);
  const terrainSamples: number[] = [];
  const step = Math.max(2, Math.min(rx, rz) / 8);
  for (let dz = -rz; dz <= rz; dz += step) {
    for (let dx = -rx; dx <= rx; dx += step) {
      const nx = dx / rx;
      const nz = dz / rz;
      if (nx * nx + nz * nz <= 1) {
        terrainSamples.push(sampler.surfaceHeight(lake.center[0] + dx, lake.center[1] + dz));
      }
    }
  }
  if (terrainSamples.length === 0) terrainSamples.push(sampler.surfaceHeight(lake.center[0], lake.center[1]));
  terrainSamples.sort((a, b) => a - b);
  const p20 = terrainSamples[Math.min(terrainSamples.length - 1, Math.max(0, Math.floor((terrainSamples.length - 1) * 0.2)))];
  return {
    center: [...lake.center] as [number, number],
    radius: [rx, rz],
    invRadius: [1 / rx, 1 / rz],
    levelOffset: lake.levelOffset,
    waterLevel: p20 + lake.levelOffset,
  };
}

function buildRiverRuntime(river: RiverBodyConfig, sampler: TerrainHeightSampler): RiverRuntime {
  const points = river.points.map((p) => [...p] as [number, number]);
  const segLengths: number[] = [];
  const levelPrefix: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    segLengths.push(len);
    totalLength += len;
    levelPrefix.push(totalLength);
  }
  const levels = points.map((p) => sampler.surfaceHeight(p[0], p[1]) + river.levelOffset);
  for (let i = 1; i < levels.length; i++) levels[i] = Math.min(levels[i], levels[i - 1] - 0.02);
  if (river.downstreamDrop > 0 && levels.length > 1) {
    levels[levels.length - 1] = Math.min(levels[levels.length - 1], levels[0] - river.downstreamDrop);
    for (let i = levels.length - 2; i >= 0; i--) levels[i] = Math.max(levels[i], levels[i + 1] + 0.02);
  }
  return {
    points,
    segLengths,
    levelPrefix,
    levels,
    totalLength: Math.max(1e-3, totalLength),
    halfWidth: Math.max(0.05, river.width * 0.5),
    levelOffset: river.levelOffset,
    downstreamDrop: river.downstreamDrop,
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

function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function cloneOceanSettings(settings: EdgeOceanSettings): EdgeOceanSettings {
  return { ...settings };
}

export class WaterField {
  private readonly sampler: TerrainHeightSampler;
  private readonly drySentinelDepth: number;
  private readonly lakes: LakeRuntime[];
  private readonly rivers: RiverRuntime[];
  private readonly hydrology: HydrologySystem | null;
  private readonly source: WaterConfig["source"];
  private readonly farLevelMinCellSize: number;
  private readonly worldCells: number;
  private ocean = cloneOceanSettings(DEFAULT_EDGE_OCEAN_SETTINGS);

  constructor(config: WaterConfig, sampler: TerrainHeightSampler, hydrology: HydrologySystem | null = null, worldCells = 0) {
    this.sampler = sampler;
    this.drySentinelDepth = config.drySentinelDepth;
    this.hydrology = hydrology;
    this.source = config.source;
    this.farLevelMinCellSize = config.hydrology.waterSurface.farLevelMinCellSize;
    this.worldCells = Math.max(0, worldCells);
    this.lakes = config.fakeBodies.lakes.map((lake) => buildLakeRuntime(lake, sampler));
    this.rivers = config.fakeBodies.rivers
      .filter((river) => river.points.length >= 2)
      .map((river) => buildRiverRuntime(river, sampler));
  }

  setEdgeOcean(settings: Partial<EdgeOceanSettings>): void {
    this.ocean = {
      ...this.ocean,
      ...settings,
      startDistance: Math.max(1, settings.startDistance ?? this.ocean.startDistance),
      fullDepthDistance: Math.max(0, settings.fullDepthDistance ?? this.ocean.fullDepthDistance),
      minDepth: Math.max(0.01, settings.minDepth ?? this.ocean.minDepth),
      maxDepth: Math.max(0.01, settings.maxDepth ?? this.ocean.maxDepth),
      level: Number.isFinite(settings.level) ? Number(settings.level) : this.ocean.level,
    };
    if (this.ocean.fullDepthDistance > this.ocean.startDistance) {
      this.ocean.fullDepthDistance = this.ocean.startDistance;
    }
    if (this.ocean.maxDepth < this.ocean.minDepth) {
      this.ocean.maxDepth = this.ocean.minDepth;
    }
  }

  getEdgeOcean(): EdgeOceanSettings {
    return cloneOceanSettings(this.ocean);
  }

  /** Terrain surface height at (x,z), exposed for the clipmap vertex fill. */
  terrainYAt(x: number, z: number): number {
    if (this.source === "hydrology" && this.hydrology) return this.hydrology.terrainHeight(x, z);
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

  /** Body mask in [0,1]: lake/river/ocean occupancy, blended at edges. 0 in dry areas. */
  bodyMaskAt(x: number, z: number): number {
    return this.sample(x, z).bodyMask;
  }

  /** Full result in one pass (cheaper than four separate calls for vertex fill). */
  sample(x: number, z: number): WaterFieldResult {
    return this.sampleForCellSize(x, z, 0);
  }

  sampleForCellSize(x: number, z: number, cellSize: number): WaterFieldResult {
    const ocean = this.sampleEdgeOcean(x, z);
    if (ocean) return ocean;

    if (this.source === "hydrology" && this.hydrology) {
      const s = this.hydrology.sample(x, z);
      const useFar = cellSize >= this.farLevelMinCellSize;
      const waterY = useFar ? s.waterYFar : s.waterY;
      const depth = waterY - s.terrainY;
      const flowLen = Math.hypot(s.flowX, s.flowZ);
      return {
        waterY,
        terrainY: s.terrainY,
        depth,
        bodyMask: depth > 0 ? s.bodyMask : 0,
        flow: flowLen > FLOW_EPSILON
          ? {
              x: s.flowX / flowLen,
              z: s.flowZ / flowLen,
              speed: flowLen,
              progress: 0,
              drop: s.riverDepth,
            }
          : { x: 0, z: 0, speed: 0, progress: 0, drop: 0 },
      };
    }

    const terrainY = this.sampler.surfaceHeight(x, z);

    let bestLakeLevel = Number.POSITIVE_INFINITY;
    let bestLakeWeight = 0;
    let maxLakeMask = 0;

    for (const lake of this.lakes) {
      const dx = (x - lake.center[0]) * lake.invRadius[0];
      const dz = (z - lake.center[1]) * lake.invRadius[1];
      const r2 = dx * dx + dz * dz;
      const edgeStart = 0.94 * 0.94;
      const weight = 1 - smoothMask(edgeStart, 1.0, r2);
      if (weight > 0) {
        maxLakeMask = Math.max(maxLakeMask, weight);
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
    let bestFlowProgress = 0;
    let bestFlowDrop = 0;

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

      const m = 1 - smoothMask(river.halfWidth * 0.9, river.halfWidth, bestDist);
      maxRiverMask = Math.max(maxRiverMask, m);

      const inside = bestDist <= river.halfWidth;
      const proximity = 1 - smoothMask(river.halfWidth * 0.9, river.halfWidth, bestDist);
      if (inside || proximity > 0) {
        const weight = inside ? 1 : proximity;
        const segStart = river.levelPrefix[bestSegIdx] ?? 0;
        const segLen = Math.max(FLOW_EPSILON, river.segLengths[bestSegIdx] ?? 1);
        const segT = Math.min(1, Math.max(0, (bestAccLen - segStart) / segLen));
        const level = river.levels[bestSegIdx] * (1 - segT) + river.levels[bestSegIdx + 1] * segT;
        if (weight > bestRiverWeight) {
          bestRiverWeight = weight;
          bestRiverLevel = level;
        }
      }

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
            const centerFade = 1 - smoothMask(0, river.halfWidth, bestDist);
            const dropSpeed = (river.downstreamDrop / Math.max(1, river.totalLength)) * 60;
            bestFlowSpeed = dropSpeed * centerFade;
            bestFlowX = dirX;
            bestFlowZ = dirZ;
            bestFlowProgress = Math.min(1, Math.max(0, bestAccLen / river.totalLength));
            bestFlowDrop = Math.max(0, river.downstreamDrop);
          }
        }
      }
    }

    const bodyMask = Math.min(1, Math.max(0, Math.max(maxLakeMask, maxRiverMask)));

    let waterY = terrainY - this.drySentinelDepth;
    if (bestLakeWeight > 0 || bestRiverWeight > 0) {
      waterY = bestLakeWeight > bestRiverWeight ? bestLakeLevel : bestRiverLevel;
    }

    const flow = bestFlowWeight > 0
      ? {
          x: bestFlowX,
          z: bestFlowZ,
          speed: bestFlowSpeed,
          progress: bestFlowProgress,
          drop: bestFlowDrop,
        }
      : { x: 0, z: 0, speed: 0, progress: 0, drop: 0 };

    return {
      waterY,
      terrainY,
      depth: waterY - terrainY,
      bodyMask,
      flow,
    };
  }

  private sampleEdgeOcean(x: number, z: number): WaterFieldResult | null {
    if (!this.ocean.enabled || this.worldCells <= 0) return null;
    const edgeDistance = Math.min(x, z, this.worldCells - x, this.worldCells - z);
    if (edgeDistance >= this.ocean.startDistance) return null;

    const width = Math.max(1, this.ocean.startDistance - this.ocean.fullDepthDistance);
    const raw = (this.ocean.startDistance - edgeDistance) / width;
    const strength = edgeDistance <= this.ocean.fullDepthDistance ? 1 : smooth01(raw);
    if (strength <= 0) return null;

    const terrainY = this.terrainYAt(x, z);
    const oceanDepth = this.ocean.minDepth + (this.ocean.maxDepth - this.ocean.minDepth) * strength;
    const seaLevel = this.ocean.level;
    const waterY = Math.max(seaLevel, terrainY + Math.max(0.12, oceanDepth * 0.08));
    const depth = waterY - terrainY;
    return {
      waterY,
      terrainY,
      depth,
      bodyMask: Math.min(1, strength),
      flow: { x: 0, z: 0, speed: 0, progress: 0, drop: 0 },
    };
  }
}
