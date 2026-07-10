import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopySummaryCell, CanopySummaryTile, CanopyWorldKey } from "./canopy_types.js";
import { emptyCanopySummaryCell } from "./canopy_types.js";
import type { TreeDistribution } from "./deterministic_tree_distribution.js";
import { worldCellIndex, worldCellOrigin } from "./deterministic_tree_distribution.js";
import type { CanopyTerrainSampler } from "./canopy_terrain_sampler.js";
import { clamp01 } from "./canopy_hash.js";
import { getNaadfIntegrationFromWindow } from "../naadf/canopyBridge.js";

export interface BuildCanopySummaryTileParams {
  key: CanopyWorldKey;
  originX: number;
  originZ: number;
  cellSizeM: number;
  resolution: number;
  config: CanopyShellConfig;
  terrainSampler: CanopyTerrainSampler;
  treeDistribution: TreeDistribution;
  revision?: number;
}

export interface CanopySummaryTileJob {
  step(budgetMs: number): CanopySummaryTile | null;
}

const BUILD_BUDGET_CHECK_INTERVAL = 16;

function lightSmoothCoverage(cells: CanopySummaryCell[], res: number): void {
  const copy = cells.map((c) => ({ ...c }));
  for (let gz = 0; gz < res; gz++) {
    for (let gx = 0; gx < res; gx++) {
      const i = gz * res + gx;
      const c = copy[i];
      if (c.coverage <= 0 && c.slope > 0.85) continue;
      let sum = c.coverage;
      let n = 1;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= res || nz >= res) continue;
        const ni = nz * res + nx;
        if (copy[ni].slope > 0.85) continue;
        sum += copy[ni].coverage;
        n++;
      }
      cells[i].coverage = clamp01(sum / n);
    }
  }
}

function isSteepRejectCell(cell: CanopySummaryCell, threshold: number): boolean {
  return cell.slope >= threshold && cell.coverage < 0.05;
}

function finalizeCanopyCells(cells: CanopySummaryCell[], resolution: number, config: CanopyShellConfig): void {
  lightSmoothCoverage(cells, resolution);

  for (const cell of cells) {
    cell.coverage = clamp01(cell.coverage);
    if (cell.coverage <= 0) {
      Object.assign(cell, { ...emptyCanopySummaryCell(), groundHeight: cell.groundHeight, slope: cell.slope, moisture: cell.moisture });
      continue;
    }
    const sp = cell.speciesPine + cell.speciesBroadleaf + cell.speciesDeadwood;
    if (sp > 1e-6) {
      cell.speciesPine /= sp;
      cell.speciesBroadleaf /= sp;
      cell.speciesDeadwood /= sp;
    }
    if (isSteepRejectCell(cell, config.treeDistribution.slopeRejectEnd)) {
      cell.coverage = 0;
    }
  }
}

export function createCanopySummaryTileJob(
  params: BuildCanopySummaryTileParams,
  now: () => number = () => performance.now(),
): CanopySummaryTileJob {
  const { key, originX, originZ, cellSizeM, resolution, treeDistribution, revision = 1 } = params;
  const cells: CanopySummaryCell[] = new Array(resolution * resolution);
  const naadf = getNaadfIntegrationFromWindow();
  let cursor = 0;
  let result: CanopySummaryTile | null = null;

  return {
    step(budgetMs: number): CanopySummaryTile | null {
      if (result) return result;
      const startedAt = now();
      const safeBudgetMs = Number.isFinite(budgetMs) && budgetMs >= 0 ? budgetMs : Number.POSITIVE_INFINITY;
      const total = resolution * resolution;

      while (cursor < total) {
        const batchEnd = Math.min(total, cursor + BUILD_BUDGET_CHECK_INTERVAL);
        for (; cursor < batchEnd; cursor++) {
          const gx = cursor % resolution;
          const gz = (cursor - gx) / resolution;
      const localX = originX + gx * cellSizeM;
      const localZ = originZ + gz * cellSizeM;
      const { cx, cz } = worldCellIndex(localX + cellSizeM * 0.5, localZ + cellSizeM * 0.5, cellSizeM);
      const worldOrigin = worldCellOrigin(cx, cz, cellSizeM);
      cells[gz * resolution + gx] = treeDistribution.accumulateCanopyCell(
        worldOrigin.x,
        worldOrigin.z,
        cellSizeM,
        params.terrainSampler,
      );
          if (naadf) {
            const idx = gz * resolution + gx;
        const sampleX = localX + cellSizeM * 0.5;
        const sampleZ = localZ + cellSizeM * 0.5;
        const summary = naadf.queryHeight(sampleX, sampleZ, "canopy");
        if (Number.isFinite(summary.canopyCoverage)) {
          cells[idx]!.coverage = clamp01(Math.max(cells[idx]!.coverage, summary.canopyCoverage));
        }
          }
        }
        if (cursor < total && now() - startedAt >= safeBudgetMs) return null;
      }

      finalizeCanopyCells(cells, resolution, params.config);
      result = { key, originX, originZ, cellSizeM, resolution, cells, revision };
      return result;
    },
  };
}

export function buildCanopySummaryTile(params: BuildCanopySummaryTileParams): CanopySummaryTile {
  const result = createCanopySummaryTileJob(params).step(Number.POSITIVE_INFINITY);
  if (!result) throw new Error("canopy summary tile did not complete with an unbounded budget");
  return result;
}

export function sampleSummaryCellAtWorld(
  tiles: Map<string, CanopySummaryTile>,
  worldX: number,
  worldZ: number,
  cellSizeM: number,
): CanopySummaryCell | null {
  const tileSizeM = cellSizeM * Math.ceil(512 / cellSizeM);
  const tileX = Math.floor(worldX / tileSizeM);
  const tileZ = Math.floor(worldZ / tileSizeM);
  for (const tile of tiles.values()) {
    if (
      worldX >= tile.originX && worldX < tile.originX + tile.resolution * tile.cellSizeM
      && worldZ >= tile.originZ && worldZ < tile.originZ + tile.resolution * tile.cellSizeM
    ) {
      const gx = Math.floor((worldX - tile.originX) / tile.cellSizeM);
      const gz = Math.floor((worldZ - tile.originZ) / tile.cellSizeM);
      if (gx < 0 || gz < 0 || gx >= tile.resolution || gz >= tile.resolution) return null;
      return tile.cells[gz * tile.resolution + gx];
    }
  }
  void tileX;
  void tileZ;
  return null;
}

export function tileResolutionForCellSize(tileSizeM: number, cellSizeM: number): number {
  return Math.max(1, Math.round(tileSizeM / cellSizeM));
}
