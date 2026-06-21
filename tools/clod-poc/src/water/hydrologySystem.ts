import * as THREE from "three";
import type { TerrainHeightSampler } from "./waterField.js";
import type { HydrologyConfig } from "./hydrologyConfig.js";
import { createHydrologyGrid, sampleGridBilinear, sampleHydrologyGrid, type HydrologyGrid, type HydrologySample } from "./hydrologyGrid.js";
import { fillDepressions } from "./depressionFill.js";
import { computeFlowAccumulation } from "./flowAccumulation.js";
import { carveRiversAndClassifyWater } from "./riverCarve.js";
import { buildWaterSurface } from "./waterSurfaceBuild.js";

export interface HydrologyStats {
  buildMs: number;
  simRes: number;
  particles: number;
  wetCells: number;
  lakeCells: number;
  riverCells: number;
  maxWaterYJump: number;
}

export class HydrologySystem {
  readonly grid: HydrologyGrid;
  readonly stats: HydrologyStats;
  private waterTexture: THREE.DataTexture | null = null;

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

  dispose(): void {
    this.waterTexture?.dispose();
    this.waterTexture = null;
  }

  static build(config: HydrologyConfig, worldCells: number, sampler: TerrainHeightSampler): HydrologySystem {
    const t0 = nowMs();
    const grid = createHydrologyGrid(config.simRes, worldCells, sampler);
    fillDepressions(grid, config.fill);
    computeFlowAccumulation(grid, config.accumulation, config.fill, config.rivers);
    carveRiversAndClassifyWater(grid, config.fill, config.rivers, config.talus);
    for (let i = 0; i < grid.waterYRaw.length; i++) {
      if (grid.riverMask[i] > 0.5) grid.waterYRaw[i] = grid.carvedBed[i] + grid.riverDepth[i];
    }
    buildWaterSurface(grid, config.waterSurface, config.drySentinelDepth);
    return new HydrologySystem(grid, collectStats(grid, config.accumulation.particles, nowMs() - t0));
  }

  sample(x: number, z: number): HydrologySample {
    return sampleHydrologyGrid(this.grid, x, z);
  }

  terrainHeight(x: number, z: number): number {
    return sampleGridBilinear(this.grid, this.grid.carvedBed, x, z);
  }
}

function collectStats(grid: HydrologyGrid, particles: number, buildMs: number): HydrologyStats {
  let wetCells = 0;
  let lakeCells = 0;
  let riverCells = 0;
  let maxWaterYJump = 0;
  for (let z = 0; z < grid.res; z++) {
    for (let x = 0; x < grid.res; x++) {
      const i = z * grid.res + x;
      if (grid.wetMask[i] > 0.5) wetCells++;
      if (grid.lakeMask[i] > 0.5) lakeCells++;
      if (grid.riverMask[i] > 0.5) riverCells++;
      if (x + 1 < grid.res) maxWaterYJump = Math.max(maxWaterYJump, Math.abs(grid.waterY[i] - grid.waterY[i + 1]));
      if (z + 1 < grid.res) maxWaterYJump = Math.max(maxWaterYJump, Math.abs(grid.waterY[i] - grid.waterY[i + grid.res]));
    }
  }
  return {
    buildMs,
    simRes: grid.res,
    particles,
    wetCells,
    lakeCells,
    riverCells,
    maxWaterYJump,
  };
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}
