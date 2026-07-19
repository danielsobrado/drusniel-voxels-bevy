import type {
  HydrologyGravelBarsConfig,
  HydrologyGravelBedConfig,
} from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_RIVER,
  type HydrologyGrid,
  type HydrologySample,
} from "./hydrologyGrid.js";
import {
  applyGravelBarBedDecision,
  createGravelBarBedCounters,
  evaluateGravelBarBedElevation,
  recordGravelBarBedDecision,
  type GravelBarBedCounters,
} from "./gravel_bar_bed.js";
import { sampleGridBilinear } from "./hydrologyGrid.js";
import type {
  HydrologyWorldSampler,
} from "./hydrologyTileSource.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const MIN_BANK_PROBE_M = 1;

export interface GravelBarBedAuthority {
  readonly counters: GravelBarBedCounters;
  apply(x: number, z: number, sample: HydrologySample): HydrologySample;
  wrap(base: HydrologyWorldSampler): HydrologyWorldSampler;
}

export function createGravelBarBedAuthority(
  fieldConfig: HydrologyGravelBarsConfig,
  bedConfig: HydrologyGravelBedConfig,
  terrain: TerrainHeightSampler,
  counters: GravelBarBedCounters = createGravelBarBedCounters(),
): GravelBarBedAuthority {
  const enabled = fieldConfig.enabled
    && fieldConfig.strength > 0
    && bedConfig.enabled
    && bedConfig.maxElevationM > 0;

  const apply = (x: number, z: number, sample: HydrologySample): HydrologySample => {
    if (!enabled || sample.bodyKind !== HYDROLOGY_BODY_RIVER) return sample;
    const decision = evaluateGravelBarBedElevation(
      x,
      z,
      sample,
      fieldConfig,
      bedConfig,
      {
        channelCenterWeight: sample.bodyMask,
        localBankY: sampleLocalBankHeight(x, z, sample, fieldConfig, bedConfig, terrain),
      },
    );
    recordGravelBarBedDecision(counters, decision);
    return applyGravelBarBedDecision(sample, decision);
  };

  return {
    counters,
    apply,
    wrap: (base) => (x, z, sampler, options) => apply(x, z, base(x, z, sampler, options)),
  };
}

export function applyGravelBarBedToGrid(
  grid: HydrologyGrid,
  fieldConfig: HydrologyGravelBarsConfig,
  bedConfig: HydrologyGravelBedConfig,
  counters: GravelBarBedCounters = createGravelBarBedCounters(),
): GravelBarBedCounters {
  if (!fieldConfig.enabled || fieldConfig.strength <= 0 || !bedConfig.enabled || bedConfig.maxElevationM <= 0) {
    return counters;
  }

  const terrain: TerrainHeightSampler = {
    surfaceHeight: (x, z) => sampleGridBilinear(grid, grid.originalBed, x, z),
  };
  const authority = createGravelBarBedAuthority(fieldConfig, bedConfig, terrain, counters);
  const denominator = Math.max(1, grid.res - 1);
  for (let z = 0; z < grid.res; z += 1) {
    const worldZ = (z / denominator) * grid.worldCells;
    for (let x = 0; x < grid.res; x += 1) {
      const index = z * grid.res + x;
      if (grid.bodyKind[index] !== HYDROLOGY_BODY_RIVER) continue;
      const worldX = (x / denominator) * grid.worldCells;
      const sample = gridSample(grid, index);
      const resolved = authority.apply(worldX, worldZ, sample);
      if (resolved === sample) continue;
      grid.carvedBed[index] = resolved.terrainY;
      grid.riverDepth[index] = resolved.riverDepth;
    }
  }
  return counters;
}

export function cloneGravelBarBedCounters(counters: GravelBarBedCounters): GravelBarBedCounters {
  return { ...counters };
}

function gridSample(grid: HydrologyGrid, index: number): HydrologySample {
  const terrainY = grid.carvedBed[index]!;
  const waterY = grid.waterY[index]!;
  const wet = grid.wetMask[index]! > 0;
  const depth = wet ? Math.max(0, waterY - terrainY) : 0;
  return {
    terrainY,
    waterY,
    depth,
    bodyMask: grid.wetMask[index]!,
    lakeMask: grid.lakeMask[index]!,
    riverMask: grid.riverMask[index]!,
    flowX: grid.flowDirX[index]!,
    flowZ: grid.flowDirZ[index]!,
    flowStrength: grid.flowStrength[index]!,
    riverDepth: grid.riverDepth[index]!,
    waterYFar: waterY,
    moisture: grid.moisture[index]!,
    bodyKind: grid.bodyKind[index]!,
    bodyId: grid.bodyId[index]!,
    shoreDistance: grid.shoreDistance[index]!,
  };
}

function sampleLocalBankHeight(
  x: number,
  z: number,
  sample: HydrologySample,
  fieldConfig: HydrologyGravelBarsConfig,
  bedConfig: HydrologyGravelBedConfig,
  terrain: TerrainHeightSampler,
): number | undefined {
  const flowLength = Math.hypot(sample.flowX, sample.flowZ);
  if (!(flowLength > 1e-5)) return undefined;
  const normalX = -sample.flowZ / flowLength;
  const normalZ = sample.flowX / flowLength;
  const bankOffsetM = Math.max(
    MIN_BANK_PROBE_M,
    sample.shoreDistance + MIN_BANK_PROBE_M,
    fieldConfig.maxShoreDistanceM + bedConfig.bankClearanceM,
  );
  const bankA = terrain.surfaceHeight(x + normalX * bankOffsetM, z + normalZ * bankOffsetM);
  const bankB = terrain.surfaceHeight(x - normalX * bankOffsetM, z - normalZ * bankOffsetM);
  if (!Number.isFinite(bankA) && !Number.isFinite(bankB)) return undefined;
  if (!Number.isFinite(bankA)) return bankB;
  if (!Number.isFinite(bankB)) return bankA;
  return Math.min(bankA, bankB);
}
