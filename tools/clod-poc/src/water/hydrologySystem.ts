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

export class HydrologySystem {
  readonly grid: HydrologyGrid;
  readonly stats: HydrologyStats;
  private waterTexture: THREE.DataTexture | null = null;
  private fieldsTexture: THREE.DataTexture | null = null;

  private constructor(grid: HydrologyGrid, stats: HydrologyStats) {
    this.grid = grid;
    this.stats = stats;
  }

  /**
   * Hydrology field as a GPU texture (RGBA32F, nearest-filtered so no
   * `float32-filterable` feature is required). Channels:
   *   R = water-surface Y (dry cells carry a below-ground sentinel) — grass uses this
   *       vs its ground Y for partial-submersion discard.
   *   G = wet mask (1 inside a water body, else 0) — trees use this (XZ-only) to drop
   *       instances standing in lakes/rivers.
   *   B = carved-bed Y — the height the terrain mesh is actually built at; GPU veg
   *       snaps its ground to this so it stops floating over the carved terrain.
   * Cached. Consumed by the grass/tree node materials.
   */
  waterSurfaceTexture(): THREE.DataTexture {
    if (this.waterTexture) return this.waterTexture;
    const res = this.grid.res;
    const data = new Float32Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      const w = this.grid.waterY[i];
      data[i * 4] = w;
      data[i * 4 + 1] = this.grid.wetMask[i];
      data[i * 4 + 2] = this.grid.carvedBed[i];
      data[i * 4 + 3] = w;
    }
    const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
    texture.name = "hydrology-water-surface";
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.waterTexture = texture;
    return texture;
  }

  hydrologyFieldsTexture(): THREE.DataTexture {
    if (this.fieldsTexture) return this.fieldsTexture;
    const res = this.grid.res;
    const data = new Float32Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      data[i * 4] = this.grid.flowStrength[i];
      data[i * 4 + 1] = this.grid.riverDepth[i];
      data[i * 4 + 2] = this.grid.moisture[i];
      data[i * 4 + 3] = this.grid.bodyKind[i] / 255;
    }
    const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
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

  static build(config: HydrologyConfig, worldCells: number, sampler: TerrainHeightSampler): HydrologySystem {
    const t0 = nowMs();
    const grid = createHydrologyGrid(config.simRes, worldCells, sampler, config.waterSurface.farReduceFactor);
    fillDepressions(grid, config.fill);
    computeFlowAccumulation(grid, config.accumulation, config.fill, config.rivers);
    carveRiversAndClassifyWater(grid, config.fill, config.rivers, config.talus);
    applyRiverFlowSpeedMultiplier(grid, config.rivers.flowSpeedMultiplier);
    for (let i = 0; i < grid.waterYRaw.length; i++) {
      if (grid.riverMask[i] > 0.01) grid.waterYRaw[i] = grid.carvedBed[i] + grid.riverDepth[i];
    }
    buildWaterSurface(grid, config.waterSurface, config.waterSurface.drySentinelDepth);
    buildFarWaterSurface(grid, config.waterSurface);
    buildMoistureField(grid, config.moisture);
    const stats = collectStats(grid, config.accumulation.particles, nowMs() - t0);
    logHydrologySummary(stats);
    maybeDumpHydrologyFields(grid, config);
    return new HydrologySystem(grid, stats);
  }

  sample(x: number, z: number): HydrologySample {
    return sampleHydrologyGrid(this.grid, x, z);
  }

  terrainHeight(x: number, z: number): number {
    return sampleGridBilinear(this.grid, this.grid.carvedBed, x, z);
  }
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
