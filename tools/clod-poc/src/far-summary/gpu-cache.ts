import type { FarSummaryTile, FarSummarySample } from "./types.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import type { FarSummaryGpuRecord } from "./gpu-records.js";

export interface FarSummaryGpuTileCommitInput {
  descriptor: FarSummaryGpuDirtyTile;
  record: FarSummaryGpuRecord;
  frameIndex: number;
  nowMs: number;
}

export interface FarSummaryGpuCellTileCommitInput {
  descriptor: FarSummaryGpuDirtyTile;
  records: readonly FarSummaryGpuRecord[];
  frameIndex: number;
  nowMs: number;
}

/**
 * Compatibility path for aggregate readbacks. Prefer farSummaryGpuCellRecordsToTile for cache commits.
 */
export function farSummaryGpuRecordToTile(input: FarSummaryGpuTileCommitInput): FarSummaryTile {
  const sample = sampleFromGpuRecord(input.record);
  const tileCells = Math.max(1, input.descriptor.tileCells);
  const sampleCount = tileCells * tileCells;
  return tileFromSamples(input.descriptor, Array.from({ length: sampleCount }, () => ({ ...sample })), input.frameIndex, input.nowMs, input.record.revision);
}

export function farSummaryGpuCellRecordsToTile(input: FarSummaryGpuCellTileCommitInput): FarSummaryTile {
  const tileCells = Math.max(1, input.descriptor.tileCells);
  const expectedSamples = tileCells * tileCells;
  if (input.records.length < expectedSamples) {
    throw new Error(`far-summary GPU cell commit for ${input.descriptor.ring}:${input.descriptor.tileX},${input.descriptor.tileZ} has ${input.records.length} record(s), expected ${expectedSamples}`);
  }
  const samples = input.records.slice(0, expectedSamples).map(sampleFromGpuRecord);
  const revision = input.records[0]?.revision ?? input.descriptor.revision;
  return tileFromSamples(input.descriptor, samples, input.frameIndex, input.nowMs, revision);
}

function tileFromSamples(
  descriptor: FarSummaryGpuDirtyTile,
  samples: FarSummarySample[],
  frameIndex: number,
  nowMs: number,
  revision: number,
): FarSummaryTile {
  const tileCells = Math.max(1, descriptor.tileCells);
  return {
    key: descriptor.key,
    state: "ready",
    revision: revision || descriptor.revision,
    builtEpoch: 0,
    lastTouchedFrame: frameIndex,
    lastTouchedTimeMs: nowMs,
    cellSizeM: descriptor.cellSizeM,
    tileCells,
    originX: descriptor.originX,
    originZ: descriptor.originZ,
    samples,
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
