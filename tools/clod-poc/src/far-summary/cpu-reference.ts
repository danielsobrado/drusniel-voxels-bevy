import type { FarSummaryRingConfig } from "./config.js";
import { buildFarSummaryTile, type FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummarySample, FarSummaryTile } from "./types.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";

const GRASS_ELIGIBLE_MAX_SLOPE_RAD = 0.75;

export interface FarSummaryCpuReferenceInput {
  tile: FarSummaryGpuDirtyTile;
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
}

export interface FarSummaryCpuReferenceMetrics {
  sampleCount: number;
  heightMin: number;
  heightMax: number;
  heightAvg: number;
  avgNormalX: number;
  avgNormalY: number;
  avgNormalZ: number;
  dominantMaterial: number;
  materialVariance: number;
  canopyCoverage: number;
  waterCoverage: number;
  slopeMean: number;
  slopeMax: number;
  roughnessMean: number;
  grassEligibility: number;
  waterLevel: number;
  bodyKind: number;
  shoreDistance: number;
  flowX: number;
  flowZ: number;
  canopyHeightAvg: number;
  speciesPine: number;
  speciesBroadleaf: number;
  speciesDeadwood: number;
  structureCoverage: number;
  caveEntranceCoverage: number;
  occluderHeight: number;
}

export function buildCpuFarSummaryTileReference(input: FarSummaryCpuReferenceInput): FarSummaryTile {
  const ringConfig = ringConfigFromGpuTile(input.tile);
  const built = buildFarSummaryTile({
    key: input.tile.key,
    ringConfig,
    terrainSampler: input.terrainSampler,
    frameIndex: input.frameIndex,
    nowMs: input.nowMs,
  });
  return { ...built, revision: input.tile.revision };
}

export function summarizeCpuFarSummaryTileReference(tile: FarSummaryTile): FarSummaryCpuReferenceMetrics {
  const samples = tile.samples.filter((sample): sample is FarSummarySample => sample !== undefined);
  const sampleCount = samples.length;
  if (sampleCount === 0) return emptyMetrics();

  let heightMin = Number.POSITIVE_INFINITY;
  let heightMax = Number.NEGATIVE_INFINITY;
  let heightSum = 0;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let canopy = 0;
  let water = 0;
  let slope = 0;
  let slopeMax = 0;
  let roughness = 0;
  let grassEligibility = 0;
  let waterLevel = 0;
  let shoreDistance = 0;
  let flowX = 0;
  let flowZ = 0;
  let canopyHeightAvg = 0;
  let speciesPine = 0;
  let speciesBroadleaf = 0;
  let speciesDeadwood = 0;
  let structureCoverage = 0;
  let caveEntranceCoverage = 0;
  let occluderHeight = 0;
  const bodyKindCounts = new Map<number, number>();
  const materialCounts = new Map<number, number>();

  for (const sample of samples) {
    heightMin = Math.min(heightMin, sample.heightMin);
    heightMax = Math.max(heightMax, sample.heightMax);
    heightSum += sample.heightAvg;
    normalX += sample.normalX;
    normalY += sample.normalY;
    normalZ += sample.normalZ;
    canopy += sample.canopyCoverage;
    water += sample.waterCoverage;
    slope += sample.slope;
    slopeMax = Math.max(slopeMax, sample.slope);
    roughness += sample.roughness;
    grassEligibility += grassEligibilityForSample(sample);
    waterLevel += sample.waterLevel;
    shoreDistance += sample.shoreDistance;
    flowX += sample.flowX;
    flowZ += sample.flowZ;
    canopyHeightAvg += sample.canopyHeightAvg;
    speciesPine += sample.speciesPine;
    speciesBroadleaf += sample.speciesBroadleaf;
    speciesDeadwood += sample.speciesDeadwood;
    structureCoverage += sample.structureCoverage;
    caveEntranceCoverage += sample.caveEntranceCoverage;
    occluderHeight += sample.occluderHeight;
    bodyKindCounts.set(sample.bodyKind, (bodyKindCounts.get(sample.bodyKind) ?? 0) + 1);
    materialCounts.set(sample.dominantMaterial, (materialCounts.get(sample.dominantMaterial) ?? 0) + 1);
  }

  const dominantMaterial = dominantMaterialFromCounts(materialCounts);
  const dominantCount = materialCounts.get(dominantMaterial) ?? 0;
  const invSampleCount = 1 / sampleCount;
  const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;

  return {
    sampleCount,
    heightMin,
    heightMax,
    heightAvg: heightSum * invSampleCount,
    avgNormalX: normalX / normalLength,
    avgNormalY: normalY / normalLength,
    avgNormalZ: normalZ / normalLength,
    dominantMaterial,
    materialVariance: 1 - dominantCount * invSampleCount,
    canopyCoverage: canopy * invSampleCount,
    waterCoverage: water * invSampleCount,
    slopeMean: slope * invSampleCount,
    slopeMax,
    roughnessMean: roughness * invSampleCount,
    grassEligibility: grassEligibility * invSampleCount,
    waterLevel: waterLevel * invSampleCount,
    bodyKind: dominantNonZeroValueFromCounts(bodyKindCounts),
    shoreDistance: shoreDistance * invSampleCount,
    flowX: flowX * invSampleCount,
    flowZ: flowZ * invSampleCount,
    canopyHeightAvg: canopyHeightAvg * invSampleCount,
    speciesPine: speciesPine * invSampleCount,
    speciesBroadleaf: speciesBroadleaf * invSampleCount,
    speciesDeadwood: speciesDeadwood * invSampleCount,
    structureCoverage: structureCoverage * invSampleCount,
    caveEntranceCoverage: caveEntranceCoverage * invSampleCount,
    occluderHeight: occluderHeight * invSampleCount,
  };
}

function ringConfigFromGpuTile(tile: FarSummaryGpuDirtyTile): FarSummaryRingConfig {
  return {
    name: `gpu_cpu_ref_r${tile.ring}`,
    startM: 0,
    endM: Number.POSITIVE_INFINITY,
    cellM: tile.cellSizeM,
    tileCells: tile.tileCells,
  };
}

function dominantMaterialFromCounts(counts: ReadonlyMap<number, number>): number {
  let dominantMaterial = 0;
  let dominantCount = -1;
  for (const [material, count] of counts) {
    if (count > dominantCount || (count === dominantCount && material < dominantMaterial)) {
      dominantMaterial = material;
      dominantCount = count;
    }
  }
  return dominantMaterial;
}

function dominantNonZeroValueFromCounts(counts: ReadonlyMap<number, number>): number {
  const nonZero = new Map([...counts].filter(([value]) => value !== 0));
  return nonZero.size > 0 ? dominantMaterialFromCounts(nonZero) : 0;
}

function grassEligibilityForSample(sample: FarSummarySample): number {
  const waterFactor = clamp01(1 - sample.waterCoverage);
  const slopeFactor = clamp01(1 - sample.slope / GRASS_ELIGIBLE_MAX_SLOPE_RAD);
  return waterFactor * slopeFactor;
}

function emptyMetrics(): FarSummaryCpuReferenceMetrics {
  return {
    sampleCount: 0,
    heightMin: 0,
    heightMax: 0,
    heightAvg: 0,
    avgNormalX: 0,
    avgNormalY: 1,
    avgNormalZ: 0,
    dominantMaterial: 0,
    materialVariance: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    slopeMean: 0,
    slopeMax: 0,
    roughnessMean: 0,
    grassEligibility: 0,
    waterLevel: 0,
    bodyKind: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    canopyHeightAvg: 0,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
    structureCoverage: 0,
    caveEntranceCoverage: 0,
    occluderHeight: 0,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
