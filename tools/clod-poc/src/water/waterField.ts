import type { LakeBodyConfig, RiverBodyConfig, WaterConfig } from "./waterConfig.js";
import type { HydrologySystem } from "./hydrologySystem.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";

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

/** Shallow shore surf inside the playable border, not deep ocean. */
export interface ShoreSurfBandSettings {
  enabled: boolean;
  startDistance: number;
  fullSurfDistance: number;
  level: number;
  maxShallowDepth: number;
}

export interface ClipmapExclusionBandSettings {
  enabled: boolean;
  distance: number;
}

export const DEFAULT_SHORE_SURF_BAND_SETTINGS: ShoreSurfBandSettings = {
  enabled: false,
  startDistance: 48,
  fullSurfDistance: 16,
  level: 18,
  maxShallowDepth: 2.5,
};

export const DEFAULT_CLIPMAP_EXCLUSION_BAND_SETTINGS: ClipmapExclusionBandSettings = {
  enabled: false,
  distance: 0,
};

const FLOW_EPSILON = 1e-6;
const RIVER_GEOMETRY_CELL_FADE_START = 6;
const RIVER_GEOMETRY_CELL_FADE_END = 24;
const RIVER_MATERIAL_SETTINGS = readRiverMaterialSettings();
const STILL_FLOW: WaterFlow = { x: 0, z: 0, speed: 0, progress: 0, drop: 0 };

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

function cloneShoreSurfSettings(settings: ShoreSurfBandSettings): ShoreSurfBandSettings {
  return { ...settings };
}

function cloneClipmapExclusionBandSettings(settings: ClipmapExclusionBandSettings): ClipmapExclusionBandSettings {
  return { ...settings };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function smoothMask(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  return smooth01((value - edge0) / (edge1 - edge0));
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
  const p20Index = Math.min(terrainSamples.length - 1, Math.max(0, Math.floor((terrainSamples.length - 1) * 0.2)));
  return {
    center: [...lake.center] as [number, number],
    radius: [rx, rz],
    invRadius: [1 / rx, 1 / rz],
    levelOffset: lake.levelOffset,
    waterLevel: terrainSamples[p20Index] + lake.levelOffset,
  };
}

function buildRiverRuntime(river: RiverBodyConfig, sampler: TerrainHeightSampler): RiverRuntime {
  const points = river.points.map((p) => [...p] as [number, number]);
  const segLengths: number[] = [];
  const levelPrefix: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    segLengths.push(len);
    totalLength += len;
    levelPrefix.push(totalLength);
  }

  const levels = points.map((p) => sampler.surfaceHeight(p[0], p[1]) + river.levelOffset);
  if (river.downstreamDrop > 0 && levels.length > 1) {
    const startLevel = levels[0];
    const endLevel = Math.min(levels[levels.length - 1], startLevel - river.downstreamDrop);
    for (let i = 1; i < levels.length; i += 1) {
      const progress = levelPrefix[i] / Math.max(1e-3, totalLength);
      levels[i] = Math.min(levels[i], startLevel + (endLevel - startLevel) * progress);
    }
    levels[levels.length - 1] = Math.min(levels[levels.length - 1], levels[0] - river.downstreamDrop);
  }
  for (let i = 1; i < levels.length; i += 1) levels[i] = Math.min(levels[i], levels[i - 1] - 0.02);

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

function pointSegmentInfo(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const segLenSq = dx * dx + dz * dz;
  const rawT = segLenSq > FLOW_EPSILON ? ((px - ax) * dx + (pz - az) * dz) / segLenSq : 0;
  const t = clamp01(rawT);
  const closestX = ax + dx * t;
  const closestZ = az + dz * t;
  return { dist: Math.hypot(px - closestX, pz - closestZ), t, closestX, closestZ };
}

function cascadeMask(flowSpeed: number, drop: number): number {
  const speedMask = smooth01(flowSpeed / 0.75);
  const dropMask = smoothMask(RIVER_MATERIAL_SETTINGS.cascadeDropStart, RIVER_MATERIAL_SETTINGS.cascadeDropEnd, drop);
  return speedMask * dropMask;
}

function cascadeWhitewaterDrop(drop: number, flowSpeed: number): number {
  const cascade = cascadeMask(flowSpeed, drop);
  if (cascade <= 0) return drop;
  return drop * (1 + cascade * RIVER_MATERIAL_SETTINGS.cascadeWhitewaterBoost)
    + cascade * RIVER_MATERIAL_SETTINGS.cascadeDropEnd * 0.35;
}

function flowSurfaceOffset(
  x: number,
  z: number,
  cellSize: number,
  dirX: number,
  dirZ: number,
  flowSpeed: number,
  drop: number,
  bodyMask: number,
  riverMask: number,
  depthHint: number,
): number {
  if (cellSize <= 0 || depthHint <= 0 || flowSpeed <= FLOW_EPSILON || riverMask <= 0.02) return 0;
  const detailFade = 1 - smoothMask(RIVER_GEOMETRY_CELL_FADE_START, RIVER_GEOMETRY_CELL_FADE_END, cellSize);
  if (detailFade <= 0) return 0;

  const river = clamp01(riverMask);
  const center = smoothMask(0.42, 0.96, clamp01(bodyMask));
  const bank = (1 - center) * river;
  const speed = smooth01(flowSpeed / 1.15);
  const rapid = Math.max(speed, smooth01(drop / 1.6));
  const cascade = cascadeMask(flowSpeed, drop);
  const along = x * dirX + z * dirZ;
  const side = x * -dirZ + z * dirX;
  const channelWave = Math.sin(along * 0.36 + Math.sin(side * 0.075) * 0.8);
  const sideWave = Math.cos(side * 0.42 + along * 0.035);
  const cascadeLip = smooth01(Math.sin(along * 0.72 + Math.sin(side * 0.11) * 0.9) * 0.5 + 0.5);
  const cascadeSheet = -RIVER_MATERIAL_SETTINGS.cascadeStepStrength * cascade * center * cascadeLip;
  const cascadeRough = (channelWave * 0.65 + sideWave * 0.35) * RIVER_MATERIAL_SETTINGS.cascadeRoughnessStrength * cascade * center;
  const centerTrough = -RIVER_MATERIAL_SETTINGS.geometryThalwegDip * center * smooth01(depthHint / 2.8);
  const bankLift = RIVER_MATERIAL_SETTINGS.geometryBankLift * bank * (1 + rapid * 0.35);
  const riffle = channelWave * RIVER_MATERIAL_SETTINGS.geometryRiffleStrength * rapid
    + sideWave * RIVER_MATERIAL_SETTINGS.geometrySideRiffleStrength * rapid * center;
  const raw = (centerTrough + bankLift + riffle + cascadeSheet + cascadeRough) * river * detailFade;
  const maxDown = Math.max(0, depthHint - 0.035);
  return Math.max(-maxDown, Math.min(RIVER_MATERIAL_SETTINGS.geometryMaxOffset, raw));
}

function shapeRiverSurfaceY(
  x: number,
  z: number,
  baseWaterY: number,
  terrainY: number,
  cellSize: number,
  dirX: number,
  dirZ: number,
  flowSpeed: number,
  drop: number,
  bodyMask: number,
  riverMask: number,
  depthHint: number,
): number {
  const offset = flowSurfaceOffset(x, z, cellSize, dirX, dirZ, flowSpeed, drop, bodyMask, riverMask, depthHint);
  if (offset === 0) return baseWaterY;
  return Math.max(terrainY + 0.035, baseWaterY + offset);
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
  private shoreSurf = cloneShoreSurfSettings(DEFAULT_SHORE_SURF_BAND_SETTINGS);
  private clipmapExclusionBand = cloneClipmapExclusionBandSettings(DEFAULT_CLIPMAP_EXCLUSION_BAND_SETTINGS);

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

  setShoreSurfBand(settings: Partial<ShoreSurfBandSettings>): void {
    this.shoreSurf = {
      ...this.shoreSurf,
      ...settings,
      startDistance: Math.max(1, settings.startDistance ?? this.shoreSurf.startDistance),
      fullSurfDistance: Math.max(0, settings.fullSurfDistance ?? this.shoreSurf.fullSurfDistance),
      maxShallowDepth: Math.max(0.01, settings.maxShallowDepth ?? this.shoreSurf.maxShallowDepth),
      level: Number.isFinite(settings.level) ? Number(settings.level) : this.shoreSurf.level,
    };
    if (this.shoreSurf.fullSurfDistance > this.shoreSurf.startDistance) {
      this.shoreSurf.fullSurfDistance = this.shoreSurf.startDistance;
    }
  }

  getShoreSurfBand(): ShoreSurfBandSettings {
    return cloneShoreSurfSettings(this.shoreSurf);
  }

  setClipmapExclusionBand(settings: Partial<ClipmapExclusionBandSettings>): void {
    this.clipmapExclusionBand = {
      ...this.clipmapExclusionBand,
      ...settings,
      distance: Math.max(0, settings.distance ?? this.clipmapExclusionBand.distance),
    };
  }

  getClipmapExclusionBand(): ClipmapExclusionBandSettings {
    return cloneClipmapExclusionBandSettings(this.clipmapExclusionBand);
  }

  terrainYAt(x: number, z: number): number {
    if (this.source === "hydrology" && this.hydrology) return this.hydrology.terrainHeight(x, z);
    return this.sampler.surfaceHeight(x, z);
  }

  waterYAt(x: number, z: number): number {
    return this.sample(x, z).waterY;
  }

  depthAt(x: number, z: number): number {
    return this.sample(x, z).depth;
  }

  flowAt(x: number, z: number): WaterFlow {
    return this.sample(x, z).flow;
  }

  bodyMaskAt(x: number, z: number): number {
    return this.sample(x, z).bodyMask;
  }

  sample(x: number, z: number): WaterFieldResult {
    return this.sampleForCellSize(x, z, 0);
  }

  sampleForCellSize(x: number, z: number, cellSize: number): WaterFieldResult {
    if (this.worldCells > 0 && !this.isInsidePlayableWorld(x, z)) return this.sampleDry(x, z);
    const shoreSurf = this.sampleShoreSurfBand(x, z);
    if (shoreSurf) return shoreSurf;
    if (this.isInClipmapExclusionBand(x, z)) return this.sampleDry(x, z);
    if (this.source === "hydrology" && this.hydrology) return this.sampleHydrology(x, z, cellSize);
    return this.sampleFakeBodies(x, z, cellSize);
  }

  private sampleHydrology(x: number, z: number, cellSize: number): WaterFieldResult {
    if (!this.hydrology) return this.sampleDry(x, z);
    const s = this.hydrology.sample(x, z);
    const useFar = cellSize >= this.farLevelMinCellSize;
    const baseWaterY = useFar ? s.waterYFar : s.waterY;
    const baseDepth = baseWaterY - s.terrainY;
    const riverMask = clamp01(s.riverMask);
    const flowDirLen = Math.hypot(s.flowX, s.flowZ);
    const flowSpeed = Math.max(0, s.flowStrength) * riverMask;

    if (flowDirLen > FLOW_EPSILON && flowSpeed > FLOW_EPSILON) {
      const dirX = s.flowX / flowDirLen;
      const dirZ = s.flowZ / flowDirLen;
      const drop = cascadeWhitewaterDrop(this.hydrologyRiverLocalDrop(x, z, dirX, dirZ), flowSpeed);
      const bodyMask = baseDepth > 0 ? s.bodyMask : 0;
      const waterY = shapeRiverSurfaceY(x, z, baseWaterY, s.terrainY, cellSize, dirX, dirZ, flowSpeed, drop, bodyMask, riverMask, Math.max(baseDepth, s.riverDepth));
      const depth = waterY - s.terrainY;
      return {
        waterY,
        terrainY: s.terrainY,
        depth,
        bodyMask: depth > 0 ? bodyMask : 0,
        flow: { x: dirX, z: dirZ, speed: flowSpeed, progress: 0, drop },
      };
    }

    return {
      waterY: baseWaterY,
      terrainY: s.terrainY,
      depth: baseDepth,
      bodyMask: baseDepth > 0 ? s.bodyMask : 0,
      flow: { ...STILL_FLOW },
    };
  }

  private sampleFakeBodies(x: number, z: number, cellSize: number): WaterFieldResult {
    const terrainY = this.sampler.surfaceHeight(x, z);
    let bestLakeLevel = Number.POSITIVE_INFINITY;
    let bestLakeWeight = 0;
    let maxLakeMask = 0;

    for (const lake of this.lakes) {
      const dx = (x - lake.center[0]) * lake.invRadius[0];
      const dz = (z - lake.center[1]) * lake.invRadius[1];
      const r2 = dx * dx + dz * dz;
      const weight = 1 - smoothMask(0.94 * 0.94, 1, r2);
      if (weight <= 0) continue;
      maxLakeMask = Math.max(maxLakeMask, weight);
      if (weight > bestLakeWeight) {
        bestLakeWeight = weight;
        bestLakeLevel = lake.waterLevel;
      }
    }

    let bestRiverLevel = Number.POSITIVE_INFINITY;
    let bestRiverWeight = 0;
    let maxRiverMask = 0;
    let bestFlow: WaterFlow = { ...STILL_FLOW };
    let bestFlowWeight = 0;

    for (const river of this.rivers) {
      let bestDist = Infinity;
      let bestSegIdx = 0;
      let accLen = 0;
      let bestAccLen = 0;

      for (let i = 0; i < river.points.length - 1; i += 1) {
        const info = pointSegmentInfo(x, z, river.points[i][0], river.points[i][1], river.points[i + 1][0], river.points[i + 1][1]);
        if (info.dist < bestDist) {
          bestDist = info.dist;
          bestSegIdx = i;
          bestAccLen = accLen + river.segLengths[i] * info.t;
        }
        accLen += river.segLengths[i];
      }

      const riverMask = 1 - smoothMask(river.halfWidth * 0.9, river.halfWidth, bestDist);
      maxRiverMask = Math.max(maxRiverMask, riverMask);
      const inside = bestDist <= river.halfWidth;
      if (inside || riverMask > 0) {
        const weight = inside ? 1 : riverMask;
        const segStart = river.levelPrefix[bestSegIdx] ?? 0;
        const segLen = Math.max(FLOW_EPSILON, river.segLengths[bestSegIdx] ?? 1);
        const segT = clamp01((bestAccLen - segStart) / segLen);
        const level = river.levels[bestSegIdx] * (1 - segT) + river.levels[bestSegIdx + 1] * segT;
        if (weight > bestRiverWeight) {
          bestRiverWeight = weight;
          bestRiverLevel = level;
        }
      }

      const flowProximity = 1 - smoothMask(river.halfWidth * 0.5, river.halfWidth, bestDist);
      if (flowProximity > bestFlowWeight) {
        const ax = river.points[bestSegIdx][0];
        const az = river.points[bestSegIdx][1];
        const bx = river.points[bestSegIdx + 1][0];
        const bz = river.points[bestSegIdx + 1][1];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len >= FLOW_EPSILON) {
          const segDrop = Math.max(0, (river.levels[bestSegIdx] ?? 0) - (river.levels[bestSegIdx + 1] ?? 0));
          const localSlopeSpeed = (segDrop / Math.max(1, river.segLengths[bestSegIdx] ?? 1)) * 90;
          const dropSpeed = (river.downstreamDrop / Math.max(1, river.totalLength)) * 60;
          bestFlowWeight = flowProximity;
          bestFlow = {
            x: dx / len,
            z: dz / len,
            speed: Math.max(dropSpeed, localSlopeSpeed) * (1 - smoothMask(0, river.halfWidth, bestDist)),
            progress: clamp01(bestAccLen / river.totalLength),
            drop: Math.max(segDrop, river.downstreamDrop),
          };
        }
      }
    }

    const bodyMask = clamp01(Math.max(maxLakeMask, maxRiverMask));
    const usingRiver = bestRiverWeight > 0 && bestRiverWeight >= bestLakeWeight;
    let waterY = terrainY - this.drySentinelDepth;
    if (bestLakeWeight > 0 || bestRiverWeight > 0) {
      waterY = usingRiver ? bestRiverLevel : bestLakeLevel;
    }
    if (usingRiver && bestFlow.speed > FLOW_EPSILON) {
      waterY = shapeRiverSurfaceY(x, z, waterY, terrainY, cellSize, bestFlow.x, bestFlow.z, bestFlow.speed, bestFlow.drop, bodyMask, maxRiverMask, waterY - terrainY);
    }

    return {
      waterY,
      terrainY,
      depth: waterY - terrainY,
      bodyMask,
      flow: bestFlow,
    };
  }

  private hydrologyRiverLocalDrop(x: number, z: number, dirX: number, dirZ: number): number {
    if (!this.hydrology) return 0;
    const grid = this.hydrology.grid;
    const sampleStep = Math.max(1, grid.worldCells / Math.max(1, grid.res - 1)) * 2;
    const up = this.hydrology.sample(x - dirX * sampleStep, z - dirZ * sampleStep);
    const down = this.hydrology.sample(x + dirX * sampleStep, z + dirZ * sampleStep);
    if (up.riverMask <= 0.05 && down.riverMask <= 0.05) return 0;
    return Math.max(0, up.waterY - down.waterY);
  }

  private sampleDry(x: number, z: number): WaterFieldResult {
    const terrainY = this.terrainYAt(x, z);
    const waterY = terrainY - this.drySentinelDepth;
    return { waterY, terrainY, depth: waterY - terrainY, bodyMask: 0, flow: { ...STILL_FLOW } };
  }

  private isInsidePlayableWorld(x: number, z: number): boolean {
    return this.worldCells > 0 && x >= 0 && x <= this.worldCells && z >= 0 && z <= this.worldCells;
  }

  private isInClipmapExclusionBand(x: number, z: number): boolean {
    if (!this.clipmapExclusionBand.enabled || this.clipmapExclusionBand.distance <= 0) return false;
    if (!this.isInsidePlayableWorld(x, z)) return false;
    const edgeDistance = Math.min(x, z, this.worldCells - x, this.worldCells - z);
    return edgeDistance < this.clipmapExclusionBand.distance;
  }

  private sampleShoreSurfBand(x: number, z: number): WaterFieldResult | null {
    if (!this.shoreSurf.enabled || !this.isInsidePlayableWorld(x, z)) return null;
    const edgeDistance = Math.min(x, z, this.worldCells - x, this.worldCells - z);
    if (edgeDistance >= this.shoreSurf.startDistance) return null;

    const width = Math.max(1, this.shoreSurf.startDistance - this.shoreSurf.fullSurfDistance);
    const raw = (this.shoreSurf.startDistance - edgeDistance) / width;
    const strength = edgeDistance <= this.shoreSurf.fullSurfDistance ? 1 : smooth01(raw);
    if (strength <= 0) return null;

    const terrainY = this.terrainYAt(x, z);
    const waterY = this.shoreSurf.level;
    const depth = waterY - terrainY;
    if (depth <= 0) return null;

    const shallowNorm = Math.min(1, depth / Math.max(0.01, this.shoreSurf.maxShallowDepth));
    return {
      waterY,
      terrainY,
      depth,
      bodyMask: Math.min(1, strength * shallowNorm),
      flow: { ...STILL_FLOW },
    };
  }
}
