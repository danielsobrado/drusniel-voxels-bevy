import type { FarSummaryTile, FarSummarySample } from "./types.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import type { FarSummaryGpuRecord } from "./gpu-records.js";

export interface FarSummaryGpuTileCommitInput {
  descriptor: FarSummaryGpuDirtyTile;
  record: FarSummaryGpuRecord;
  frameIndex: number;
  nowMs: number;
}

export function farSummaryGpuRecordToTile(input: FarSummaryGpuTileCommitInput): FarSummaryTile {
  const sample = sampleFromGpuRecord(input.record);
  const tileCells = Math.max(1, input.descriptor.tileCells);
  const sampleCount = tileCells * tileCells;
  return {
    key: input.descriptor.key,
    state: "ready",
    revision: input.record.revision || input.descriptor.revision,
    builtEpoch: 0,
    lastTouchedFrame: input.frameIndex,
    lastTouchedTimeMs: input.nowMs,
    cellSizeM: input.descriptor.cellSizeM,
    tileCells,
    originX: input.descriptor.originX,
    originZ: input.descriptor.originZ,
    samples: Array.from({ length: sampleCount }, () => ({ ...sample })),
  };
}

function sampleFromGpuRecord(record: FarSummaryGpuRecord): FarSummarySample {
  return {
    heightMin: record.heightMin,
    heightMax: record.heightMax,
    heightAvg: record.heightAvg,
    normalX: record.avgNormalX,
    normalY: record.avgNormalY,
    normalZ: record.avgNormalZ,
    dominantMaterial: record.dominantMaterial,
    materialVariance: record.materialVariance,
    canopyCoverage: record.canopyCoverage,
    waterCoverage: record.waterCoverage,
    slope: record.slopeMean,
    roughness: record.roughnessMean,
  };
}
