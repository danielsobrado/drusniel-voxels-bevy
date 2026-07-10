import type { WaterConfig } from "./waterConfig.js";
import type { HydrologySystem } from "./hydrologySystem.js";
import { HYDROLOGY_BODY_DRY, HYDROLOGY_BODY_OCEAN, HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import {
  FLOW_EPSILON,
  STILL_FLOW,
  type TerrainHeightSampler,
  type WaterFlow,
  type WaterFieldResult,
  type ShoreSurfBandSettings,
  type ClipmapExclusionBandSettings,
  type LakeRuntime,
  type RiverRuntime,
} from "./water_field_types.js";
import { DEFAULT_SHORE_SURF_BAND_SETTINGS, DEFAULT_CLIPMAP_EXCLUSION_BAND_SETTINGS } from "./water_field_defaults.js";
import {
  cloneShoreSurfSettings,
  cloneClipmapExclusionBandSettings,
  buildLakeRuntime,
  buildRiverRuntime,
  clamp01,
  smooth01,
  smoothMask,
  pointSegmentInfo,
  cascadeWhitewaterDrop,
  shapeRiverSurfaceY,
} from "./water_field_helpers.js";

export type { TerrainHeightSampler, WaterFlow, WaterFieldResult, ShoreSurfBandSettings, ClipmapExclusionBandSettings } from "./water_field_types.js";
export { DEFAULT_SHORE_SURF_BAND_SETTINGS, DEFAULT_CLIPMAP_EXCLUSION_BAND_SETTINGS } from "./water_field_defaults.js";

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
    if (this.worldCells > 0 && !this.isInsidePlayableWorld(x, z) && !this.canSampleHydrologyOutsideWorld()) {
      return this.sampleDry(x, z);
    }
    const shoreSurf = this.sampleShoreSurfBand(x, z);
    if (shoreSurf) return shoreSurf;
    if (this.isInClipmapExclusionBand(x, z)) return this.sampleDry(x, z);
    if (this.source === "hydrology" && this.hydrology) return this.sampleHydrology(x, z, cellSize);
    return this.sampleFakeBodies(x, z, cellSize);
  }

  private sampleHydrology(x: number, z: number, cellSize: number): WaterFieldResult {
    if (!this.hydrology) return this.sampleDry(x, z);
    const s = this.hydrology.sample(x, z, cellSize);
    const useFar = cellSize >= this.farLevelMinCellSize;
    const baseWaterY = useFar ? s.waterYFar : s.waterY;
    const baseDepth = baseWaterY - s.terrainY;
    const riverMask = clamp01(s.riverMask);
    const flowDirLen = Math.hypot(s.flowX, s.flowZ);
    const flowSpeed = Math.max(0, s.flowStrength) * riverMask;
    if (flowDirLen > FLOW_EPSILON && flowSpeed > FLOW_EPSILON) {
      const dirX = s.flowX / flowDirLen;
      const dirZ = s.flowZ / flowDirLen;
      const drop = cascadeWhitewaterDrop(this.hydrologyRiverLocalDrop(x, z, dirX, dirZ, cellSize), flowSpeed);
      const bodyMask = baseDepth > 0 ? s.bodyMask : 0;
      const waterY = shapeRiverSurfaceY(x, z, baseWaterY, s.terrainY, cellSize, dirX, dirZ, flowSpeed, drop, bodyMask, riverMask, Math.max(baseDepth, s.riverDepth));
      const depth = waterY - s.terrainY;
      return {
        waterY, terrainY: s.terrainY, depth,
        bodyMask: depth > 0 ? bodyMask : 0,
        bodyKind: s.bodyKind,
        flow: { x: dirX, z: dirZ, speed: flowSpeed, progress: 0, drop },
      };
    }
    return {
      waterY: baseWaterY, terrainY: s.terrainY, depth: baseDepth,
      bodyMask: baseDepth > 0 ? s.bodyMask : 0, bodyKind: s.bodyKind, flow: { ...STILL_FLOW },
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
      if (weight > bestLakeWeight) { bestLakeWeight = weight; bestLakeLevel = lake.waterLevel; }
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
        if (info.dist < bestDist) { bestDist = info.dist; bestSegIdx = i; bestAccLen = accLen + river.segLengths[i] * info.t; }
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
        if (weight > bestRiverWeight) { bestRiverWeight = weight; bestRiverLevel = level; }
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
            x: dx / len, z: dz / len,
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
    const fakeKind = usingRiver ? HYDROLOGY_BODY_RIVER : bestLakeWeight > 0 ? HYDROLOGY_BODY_LAKE : HYDROLOGY_BODY_DRY;
    return { waterY, terrainY, depth: waterY - terrainY, bodyMask, bodyKind: bodyMask > 0 ? fakeKind : HYDROLOGY_BODY_DRY, flow: bestFlow };
  }

  private hydrologyRiverLocalDrop(x: number, z: number, dirX: number, dirZ: number, cellSize = 0): number {
    if (!this.hydrology) return 0;
    const grid = this.hydrology.grid;
    const sampleStep = Math.max(1, grid.worldCells / Math.max(1, grid.res - 1)) * 2;
    const up = this.hydrology.sample(x - dirX * sampleStep, z - dirZ * sampleStep, cellSize);
    const down = this.hydrology.sample(x + dirX * sampleStep, z + dirZ * sampleStep, cellSize);
    if (up.riverMask <= 0.05 && down.riverMask <= 0.05) return 0;
    return Math.max(0, up.waterY - down.waterY);
  }

  private sampleDry(x: number, z: number): WaterFieldResult {
    const terrainY = this.terrainYAt(x, z);
    const waterY = terrainY - this.drySentinelDepth;
    return { waterY, terrainY, depth: waterY - terrainY, bodyMask: 0, bodyKind: HYDROLOGY_BODY_DRY, flow: { ...STILL_FLOW } };
  }

  private isInsidePlayableWorld(x: number, z: number): boolean {
    return this.worldCells > 0 && x >= 0 && x <= this.worldCells && z >= 0 && z <= this.worldCells;
  }

  private canSampleHydrologyOutsideWorld(): boolean {
    return this.source === "hydrology" && this.hydrology?.supportsInfiniteWorldSamples() === true;
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
    return { waterY, terrainY, depth, bodyMask: Math.min(1, strength * shallowNorm), bodyKind: HYDROLOGY_BODY_OCEAN, flow: { ...STILL_FLOW } };
  }
}
