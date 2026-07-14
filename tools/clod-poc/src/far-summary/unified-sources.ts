import type { CanopyShellConfig } from "../canopy/canopy_types_internal.js";
import {
  CANOPY_STRATIFIED_SAMPLE_COUNT,
  createTreeDistribution,
  type TreeDistribution,
} from "../canopy/deterministic_tree_distribution.js";
import type { FarSummaryCanopySample, FarSummaryWaterSample } from "./summary-tile-builder.js";

export interface FarSummaryHydrologySource {
  sample(x: number, z: number, cellSizeHint?: number): {
    bodyMask: number;
    waterY: number;
    bodyKind: number;
    shoreDistance: number;
    flowX: number;
    flowZ: number;
  };
}

export function sampleFarSummaryHydrology(
  source: FarSummaryHydrologySource,
  x: number,
  z: number,
  cellSizeHint = 1,
): FarSummaryWaterSample {
  const sample = source.sample(x, z, cellSizeHint);
  return {
    coverage: clamp01(sample.bodyMask),
    waterLevel: finiteOr(sample.waterY, 0),
    bodyKind: Math.max(0, Math.round(finiteOr(sample.bodyKind, 0))),
    shoreDistance: finiteOr(sample.shoreDistance, 0),
    flowX: finiteOr(sample.flowX, 0),
    flowZ: finiteOr(sample.flowZ, 0),
  };
}

export interface FarSummaryCanopySourceInput {
  getConfig: () => CanopyShellConfig;
  sampleHeight: (x: number, z: number) => number;
  sampleMaterial?: (x: number, z: number) => number;
  /**
   * Retained for source compatibility. Unified canopy masking consumes the tile's enriched
   * water field and intentionally does not resample hydrology from this callback.
   */
  sampleWater?: (x: number, z: number, cellSizeHint: number) => FarSummaryWaterSample;
}

export function createFarSummaryCanopySource(
  input: FarSummaryCanopySourceInput,
): (cellOriginX: number, cellOriginZ: number, cellSizeM: number) => FarSummaryCanopySample {
  let distributionKey = "";
  let distribution: TreeDistribution | null = null;

  const currentDistribution = (): TreeDistribution => {
    const config = input.getConfig();
    const nextKey = JSON.stringify([config.seed, config.treeDistribution]);
    if (!distribution || nextKey !== distributionKey) {
      distributionKey = nextKey;
      distribution = createTreeDistribution(config.treeDistribution, config.seed);
    }
    return distribution;
  };

  return (cellOriginX, cellOriginZ, cellSizeM) => {
    const cell = currentDistribution().accumulateCanopyCell(cellOriginX, cellOriginZ, cellSizeM, {
      sample(x, z) {
        const height = input.sampleHeight(x, z);
        const normal = estimateNormal(input.sampleHeight, x, z);
        return {
          height,
          normal,
          slope: Math.max(0, Math.min(1, 1 - normal.y)),
          materialHint: input.sampleMaterial?.(x, z) ?? 0,
          water: false,
        };
      },
    });
    // The canopy accumulator averages coverage across stratified samples while its weighted
    // attributes remain totals. Convert those totals into the v2 sample's average/weights.
    const speciesTotal = cell.speciesPine + cell.speciesBroadleaf + cell.speciesDeadwood;
    const speciesScale = speciesTotal > 1e-6 ? 1 / speciesTotal : 0;
    return {
      coverage: clamp01(cell.coverage),
      canopyHeightAvg: finiteOr(
        cell.coverage > 0 ? cell.canopyHeight / CANOPY_STRATIFIED_SAMPLE_COUNT : cell.groundHeight,
        cell.groundHeight,
      ),
      speciesPine: clamp01(cell.speciesPine * speciesScale),
      speciesBroadleaf: clamp01(cell.speciesBroadleaf * speciesScale),
      speciesDeadwood: clamp01(cell.speciesDeadwood * speciesScale),
    };
  };
}

function estimateNormal(
  sampleHeight: (x: number, z: number) => number,
  x: number,
  z: number,
): { x: number; y: number; z: number } {
  const step = 2;
  const nx = sampleHeight(x - step, z) - sampleHeight(x + step, z);
  const nz = sampleHeight(x, z - step) - sampleHeight(x, z + step);
  const ny = step * 2;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
