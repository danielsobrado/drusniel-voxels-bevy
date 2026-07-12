import * as THREE from "three";
import type { TerrainHeightSampler } from "./waterField.js";
import type { HydrologyConfig } from "./hydrologyConfig.js";
import { createHydrologyGrid, sampleGridBilinear, sampleHydrologyGrid, type HydrologyGrid, type HydrologySample } from "./hydrologyGrid.js";
import { fillDepressions } from "./depressionFill.js";
import { computeFlowAccumulation } from "./flowAccumulation.js";
import { carveRiversAndClassifyWater } from "./riverCarve.js";
import { buildWaterSurface } from "./waterSurfaceBuild.js";
import { buildFarWaterSurface } from "./farWaterSurface.js";
import { buildMoistureField } from "./moistureField.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import { computeBodyIds, computeShoreDistance } from "./bodyIdentity.js";
import { HydrologyTileCache, type HydrologyTileCacheStats, type HydrologyTileRemoteSource } from "./hydrologyTileSource.js";
import type { HydrologyTileAtlasSource } from "./hydrologyAtlas.js";
import { packHydrologyFieldsTexels, packHydrologyWaterSurfaceTexels } from "./hydrologyGpuPacking.js";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";

export interface HydrologyBodyKindCounts {
  dry: number;
  ocean: number;
  lake: number;
  river: number;
  pond: number;
  marsh: number;
}

export interface HydrologyStats {
  buildMs: number;
  simRes: number;
  farRes: number;
  particles: number;
  wetCells: number;
  lakeCells: number;
  riverCells: number;
  dryCells: number;
  maxWaterYJump: number;
  moistureMin: number;
  moistureMax: number;
  maxFlowSpeed: number;
  bodyKindCounts: HydrologyBodyKindCounts;
  waterYFarMin: number;
  waterYFarMax: number;
}

const INFINITE_ISLANDS_SCENE = "infinite-islands";

export class HydrologySystem {
  readonly grid: HydrologyGrid;
  readonly stats: HydrologyStats;
  private readonly infiniteWorldSamples: boolean;
  private readonly unifiedStartup: boolean;
  private readonly sampler: TerrainHeightSampler;
  private readonly drySentinelDepthM: number;
  private readonly tileCache: HydrologyTileCache | null;
  private readonly boundaryBlendM: number;
  private readonly atlasTilesPerSide: number;
  private waterTexture: THREE.DataTexture | null = null;
  private fieldsTexture: THREE.DataTexture | null = null;

  private constructor(
    grid: HydrologyGrid,
    stats: HydrologyStats,
    infiniteWorldSamples: boolean,
    unifiedStartup: boolean,
    sampler: TerrainHeightSampler,
    drySentinelDepthM: number,
    tileCache: HydrologyTileCache | null,
    boundaryBlendM: number,
    atlasTilesPerSide: number,
  ) {
    this.grid = grid;
    this.stats = stats;
    this.infiniteWorldSamples = infiniteWorldSamples;
    this.unifiedStartup = unifiedStartup;
    this.sampler = sampler;
    this.drySentinelDepthM = drySentinelDepthM;
    this.tileCache = tileCache;
    this.boundaryBlendM = boundaryBlendM;
    this.atlasTilesPerSide = atlasTilesPerSide;
  }

  /**
   * Hydrology "water surface" GPU texture (canonical Layout A — see
   * hydrologyGpuPacking.ts for the channel table: R=waterY, G=wetMask, B=carvedBedY,
   * A=shoreDistance; RGBA32F, nearest-filtered so no `float32-filterable` feature is
   * required). Cached. Consumed by grass/tree/stone/understory node materials and
   * placement compute.
   */
  waterSurfaceTexture(): THREE.DataTexture {
    if (this.waterTexture) return this.waterTexture;
    const res = this.grid.res;
    const texture = new THREE.DataTexture(
      packHydrologyWaterSurfaceTexels(this.grid),
      res,
      res,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.name = "hydrology-water-surface";
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.waterTexture = texture;
    return texture;
  }

  /**
   * Hydrology "render fields" GPU texture (canonical Layout B — see
   * hydrologyGpuPacking.ts: R/G = flow direction scaled by strength, B = moisture,
   * A = bodyKind/255). Cached. Consumed by the post-fx froxel volume (moisture) and
   * available to flow-driven water/terrain materials.
   */
  hydrologyFieldsTexture(): THREE.DataTexture {
    if (this.fieldsTexture) return this.fieldsTexture;
    const res = this.grid.res;
    const texture = new THREE.DataTexture(
      packHydrologyFieldsTexels(this.grid),
      res,
      res,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.name = "hydrology-render-fields";
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.fieldsTexture = texture;
    return texture;
  }

  dispose(): void {
    this.waterTexture?.dispose();
    this.fieldsTexture?.dispose();
    this.waterTexture = null;
    this.fieldsTexture = null;
  }

  static build(
    config: HydrologyConfig,
    worldCells: number,
    sampler: TerrainHeightSampler,
    options: { infiniteWorldSamples?: boolean } = {},
  ): HydrologySystem {
    const t0 = nowMs();
    const infiniteWorldSamples = options.infiniteWorldSamples ?? infiniteIslandsScene();
    const unifiedStartup = infiniteWorldSamples && config.infinite.unifiedStartup;
    const tileCache = infiniteWorldSamples && config.infinite.maxResidentTiles > 0
      ? new HydrologyTileCache(sampler, {
          tileSizeM: config.infinite.tileSizeM,
          tileRes: config.infinite.tileRes,
          maxResidentTiles: config.infinite.maxResidentTiles,
          drySentinelDepthM: config.waterSurface.drySentinelDepth,
        })
      : null;

    const grid = unifiedStartup
      ? buildUnifiedStartupGrid(config, worldCells, sampler, tileCache)
      : buildLegacyHydrologyGrid(config, worldCells, sampler);
    const stats = collectStats(grid, unifiedStartup ? 0 : config.accumulation.particles, nowMs() - t0);
    logHydrologySummary(stats);
    maybeDumpHydrologyFields(grid, config);

    return new HydrologySystem(
      grid,
      stats,
      infiniteWorldSamples,
      unifiedStartup,
      sampler,
      config.waterSurface.drySentinelDepth,
      tileCache,
      config.infinite.boundaryBlendM,
      config.infinite.atlasTilesPerSide,
    );
  }

  supportsInfiniteWorldSamples(): boolean {
    return this.infiniteWorldSamples;
  }

  unifiedStartupActive(): boolean {
    return this.unifiedStartup;
  }

  /**
   * Canonical world-space hydrology sample. `cellSizeHint` (metres per consumer cell,
   * e.g. the water clipmap ring cell size) only selects the infinite-field access path:
   * fine consumers go through the tile cache, coarse rings (whose footprint would blow
   * the LRU budget — the 48 m ring spans ±3 km ≈ hundreds of tiles) sample the analytic
   * field directly. Tile bilinear vs analytic differ by at most the interpolation delta
   * of one 4 m tile cell, well below what a coarse ring can resolve.
   */
  sample(x: number, z: number, cellSizeHint = 0): HydrologySample {
    if (!this.infiniteWorldSamples) return sampleHydrologyGrid(this.grid, x, z);
    if (this.unifiedStartup) return this.sampleInfinite(x, z, cellSizeHint);
    if (!hydrologyCoordInsideStartupWorld(x, z, this.grid.worldCells)) return this.sampleInfinite(x, z, cellSizeHint);
    const t = this.gridWeight(x, z);
    if (t >= 1) return sampleHydrologyGrid(this.grid, x, z);
    // Legacy boundary blend: finite grid inside, traced field outside. Unified startup
    // bypasses this entire path and therefore has no authority handoff band.
    return blendHydrologySamples(this.sampleInfinite(x, z, cellSizeHint), sampleHydrologyGrid(this.grid, x, z), t);
  }

  terrainHeight(x: number, z: number): number {
    if (this.unifiedStartup) return this.sampler.surfaceHeight(x, z);
    if (!this.infiniteWorldSamples) return sampleGridBilinear(this.grid, this.grid.carvedBed, x, z);
    if (!hydrologyCoordInsideStartupWorld(x, z, this.grid.worldCells)) return this.sampler.surfaceHeight(x, z);
    const t = this.gridWeight(x, z);
    if (t >= 1) return sampleGridBilinear(this.grid, this.grid.carvedBed, x, z);
    const carved = sampleGridBilinear(this.grid, this.grid.carvedBed, x, z);
    return this.sampler.surfaceHeight(x, z) * (1 - t) + carved * t;
  }

  /** Blend weight of the finite grid at an inside-world coordinate (1 = pure grid). */
  private gridWeight(x: number, z: number): number {
    if (this.boundaryBlendM <= 0) return 1;
    const worldCells = this.grid.worldCells;
    const edgeDistance = Math.min(x, z, worldCells - x, worldCells - z);
    const raw = edgeDistance / this.boundaryBlendM;
    if (raw >= 1) return 1;
    return raw * raw * (3 - 2 * raw);
  }

  private sampleInfinite(x: number, z: number, cellSizeHint = 0): HydrologySample {
    if (this.tileCache && cellSizeHint <= this.tileCache.coarseBypassCellSize) {
      return this.tileCache.sample(x, z);
    }
    return sampleInfiniteHydrology(x, z, this.sampler, { drySentinelDepthM: this.drySentinelDepthM });
  }

  tileCacheStats(): HydrologyTileCacheStats | null {
    return this.tileCache ? this.tileCache.stats : null;
  }

  /** Metres per consumer cell above which sampleInfinite bypasses the tile cache;
   *  null when this system has no tile cache (finite worlds, cache disabled). */
  tileCoarseBypassCellSize(): number | null {
    return this.tileCache ? this.tileCache.coarseBypassCellSize : null;
  }

  attachTileRemote(remote: HydrologyTileRemoteSource | null): void {
    this.tileCache?.attachRemote(remote);
  }

  /** Tile-backed source for the streaming GPU hydrology atlas (Phase 4b); null when this
   *  system has no tile cache or the atlas is disabled by config. */
  tileAtlasSource(): HydrologyTileAtlasSource | null {
    const cache = this.tileCache;
    if (!cache || this.atlasTilesPerSide <= 0) return null;
    return {
      tileSizeM: cache.tileSize,
      tileRes: cache.tileResolution,
      atlasTilesPerSide: this.atlasTilesPerSide,
      peek: (tileX, tileZ) => cache.peekTile(tileX, tileZ),
      prefetch: (centerX, centerZ, radiusM) => cache.prefetchAround(centerX, centerZ, radiusM),
    };
  }

  /** Forward to the tile cache prefetcher (see HydrologyTileCache.prefetchAround);
   *  no-op without a cache. */
  prefetchTiles(centerX: number, centerZ: number, radiusM: number): void {
    this.tileCache?.prefetchAround(centerX, centerZ, radiusM);
  }
}

function buildLegacyHydrologyGrid(
  config: HydrologyConfig,
  worldCells: number,
  sampler: TerrainHeightSampler,
): HydrologyGrid {
  const grid = createHydrologyGrid(config.simRes, worldCells, sampler, config.waterSurface.farReduceFactor);
  fillDepressions(grid, config.fill);
  computeFlowAccumulation(grid, config.accumulation, config.fill, config.rivers);
  carveRiversAndClassifyWater(grid, config.fill, config.rivers, config.talus);
  applyRiverFlowSpeedMultiplier(grid, config.rivers.flowSpeedMultiplier);
  for (let i = 0; i < grid.waterYRaw.length; i++) {
    if (grid.riverMask[i] > 0.01) grid.waterYRaw[i] = grid.carvedBed[i] + grid.riverDepth[i];
  }
  buildWaterSurface(grid, config.waterSurface, config.waterSurface.drySentinelDepth);
  // Body identity + shore distance are derived from the final wet mask.
  computeBodyIds(grid);
  computeShoreDistance(grid);
  buildFarWaterSurface(grid, config.waterSurface);
  buildMoistureField(grid, config.moisture);
  return grid;
}

function buildUnifiedStartupGrid(
  config: HydrologyConfig,
  worldCells: number,
  sampler: TerrainHeightSampler,
  tileCache: HydrologyTileCache | null,
): HydrologyGrid {
  const grid = createHydrologyGrid(config.simRes, worldCells, sampler, config.waterSurface.farReduceFactor);
  const denom = Math.max(1, grid.res - 1);
  const options = { drySentinelDepthM: config.waterSurface.drySentinelDepth };
  for (let z = 0; z < grid.res; z++) {
    const worldZ = (z / denom) * worldCells;
    for (let x = 0; x < grid.res; x++) {
      const worldX = (x / denom) * worldCells;
      const sample = tileCache
        ? tileCache.sample(worldX, worldZ)
        : sampleInfiniteHydrology(worldX, worldZ, sampler, options);
      const index = z * grid.res + x;
      grid.originalBed[index] = sample.terrainY;
      grid.carvedBed[index] = sample.terrainY;
      grid.filledSurface[index] = sample.bodyMask > 0 ? sample.waterY : sample.terrainY;
      grid.accumulation[index] = 0;
      grid.flowStrength[index] = sample.flowStrength;
      grid.waterStrength[index] = sample.bodyMask;
      grid.riverDepth[index] = sample.riverDepth;
      grid.waterYRaw[index] = sample.waterY;
      grid.waterY[index] = sample.waterY;
      grid.wetMask[index] = sample.bodyMask;
      grid.lakeMask[index] = sample.lakeMask;
      grid.riverMask[index] = sample.riverMask;
      grid.moisture[index] = sample.moisture;
      grid.bodyKind[index] = sample.bodyKind;
      grid.flowDirX[index] = sample.flowX;
      grid.flowDirZ[index] = sample.flowZ;
      grid.bodyId[index] = sample.bodyId;
      grid.shoreDistance[index] = sample.shoreDistance;
    }
  }
  buildFarWaterSurface(grid, config.waterSurface);
  return grid;
}

/** Lerp two canonical samples; identity fields come from the dominant side. t = weight of `b`. */
function blendHydrologySamples(a: HydrologySample, b: HydrologySample, t: number): HydrologySample {
  const s = 1 - t;
  const dominant = t >= 0.5 ? b : a;
  const terrainY = a.terrainY * s + b.terrainY * t;
  const waterY = a.waterY * s + b.waterY * t;
  const bodyMask = a.bodyMask * s + b.bodyMask * t;
  const depthRaw = waterY - terrainY;
  return {
    terrainY,
    waterY,
    depth: bodyMask > 0 && depthRaw > 0 ? depthRaw : 0,
    bodyMask,
    lakeMask: a.lakeMask * s + b.lakeMask * t,
    riverMask: a.riverMask * s + b.riverMask * t,
    flowX: a.flowX * s + b.flowX * t,
    flowZ: a.flowZ * s + b.flowZ * t,
    flowStrength: a.flowStrength * s + b.flowStrength * t,
    riverDepth: a.riverDepth * s + b.riverDepth * t,
    waterYFar: a.waterYFar * s + b.waterYFar * t,
    moisture: a.moisture * s + b.moisture * t,
    bodyKind: dominant.bodyKind,
    bodyId: dominant.bodyId,
    shoreDistance: a.shoreDistance * s + b.shoreDistance * t,
  };
}

export function hydrologyCoordInsideStartupWorld(x: number, z: number, worldCells: number): boolean {
  return Number.isFinite(x)
    && Number.isFinite(z)
    && x >= 0
    && z >= 0
    && x <= worldCells
    && z <= worldCells;
}

export function hydrologySampleCoord(value: number, worldCells: number, wrapWorld: boolean): number {
  if (!Number.isFinite(value)) return 0;
  if (!wrapWorld) return value;
  const size = Number.isFinite(worldCells) && worldCells > 0 ? worldCells : 1;
  return ((value % size) + size) % size;
}

function infiniteIslandsScene(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("scene") === INFINITE_ISLANDS_SCENE;
}

function applyRiverFlowSpeedMultiplier(grid: HydrologyGrid, multiplier: number): void {
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;
  if (Math.abs(safeMultiplier - 1) < 1e-6) return;
  for (let i = 0; i < grid.flowStrength.length; i++) {
    if (grid.riverMask[i] <= 0.01) continue;
    grid.flowStrength[i] *= safeMultiplier;
  }
}

function collectStats(grid: HydrologyGrid, particles: number, buildMs: number): HydrologyStats {
  let wetCells = 0;
  let lakeCells = 0;
  let riverCells = 0;
  let dryCells = 0;
  let maxWaterYJump = 0;
  let maxFlowSpeed = 0;
  const moistureRange = finiteRange(grid.moisture);
  const waterYFarRange = finiteRange(grid.waterYFar);
  const bodyKindCounts: HydrologyBodyKindCounts = { dry: 0, ocean: 0, lake: 0, river: 0, pond: 0, marsh: 0 };
  for (let z = 0; z < grid.res; z++) {
    for (let x = 0; x < grid.res; x++) {
      const i = z * grid.res + x;
      if (grid.wetMask[i] > 0.5) wetCells++;
      else dryCells++;
      if (grid.lakeMask[i] > 0.5) lakeCells++;
      if (grid.riverMask[i] > 0.5) riverCells++;
      maxFlowSpeed = Math.max(maxFlowSpeed, Math.hypot(grid.flowDirX[i], grid.flowDirZ[i]) * grid.flowStrength[i]);
      countBodyKind(bodyKindCounts, grid.bodyKind[i]);
      if (x + 1 < grid.res) maxWaterYJump = Math.max(maxWaterYJump, Math.abs(grid.waterY[i] - grid.waterY[i + 1]));
      if (z + 1 < grid.res) maxWaterYJump = Math.max(maxWaterYJump, Math.abs(grid.waterY[i] - grid.waterY[i + grid.res]));
    }
  }
  return {
    buildMs,
    simRes: grid.res,
    farRes: grid.farRes,
    particles,
    wetCells,
    lakeCells,
    riverCells,
    dryCells,
    maxWaterYJump,
    moistureMin: moistureRange.min,
    moistureMax: moistureRange.max,
    maxFlowSpeed,
    bodyKindCounts,
    waterYFarMin: waterYFarRange.min,
    waterYFarMax: waterYFarRange.max,
  };
}

function finiteRange(values: Float32Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 0 };
}

function countBodyKind(counts: HydrologyBodyKindCounts, kind: number): void {
  if (kind === HYDROLOGY_BODY_OCEAN) counts.ocean++;
  else if (kind === HYDROLOGY_BODY_LAKE) counts.lake++;
  else if (kind === HYDROLOGY_BODY_RIVER) counts.river++;
  else if (kind === HYDROLOGY_BODY_POND) counts.pond++;
  else if (kind === HYDROLOGY_BODY_MARSH) counts.marsh++;
  else if (kind === HYDROLOGY_BODY_DRY) counts.dry++;
}

function logHydrologySummary(stats: HydrologyStats): void {
  console.info(
    `[hydrology] res=${stats.simRes} far=${stats.farRes} wet=${stats.wetCells} lake=${stats.lakeCells} ` +
      `river=${stats.riverCells} maxJump=${stats.maxWaterYJump.toFixed(3)} ` +
      `maxFlow=${stats.maxFlowSpeed.toFixed(3)} moisture=${stats.moistureMin.toFixed(3)}..${stats.moistureMax.toFixed(3)}`,
  );
}

function maybeDumpHydrologyFields(grid: HydrologyGrid, config: HydrologyConfig): void {
  const envDump = typeof process !== "undefined" && process.env?.CLOD_POC_DUMP_HYDROLOGY === "1";
  if (!config.debug.dumpFields && !envDump) return;
  const loadDump = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof import("./hydrologyDump.js")>;
  void loadDump("./hydrologyDump.js")
    .then(({ writeHydrologyDebugDump }) => writeHydrologyDebugDump(grid, config.debug.dumpDir))
    .catch((error: unknown) => {
      console.warn(`[hydrology] debug dump failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}
