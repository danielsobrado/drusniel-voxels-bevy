import { describe, expect, it } from "vitest";
import { FAR_SUMMARY_GPU_RECORD_BYTES } from "./gpu-config.js";
import type { FarSummaryCpuReferenceMetrics } from "./cpu-reference.js";
import {
  compareFarSummaryGpuRecordToCpu,
  decodeFarSummaryGpuRecord,
  decodeFarSummaryGpuRecords,
  farSummaryGpuV2FallbackChannels,
  type FarSummaryGpuRecord,
} from "./gpu-records.js";

function record(overrides: Partial<FarSummaryGpuRecord> = {}): FarSummaryGpuRecord {
  return {
    heightMin: 1,
    heightMax: 3,
    heightAvg: 2,
    slopeMean: 0.25,
    avgNormalX: 0,
    avgNormalY: 1,
    avgNormalZ: 0,
    dominantMaterial: 2,
    materialVariance: 0.125,
    grassEligibility: 0.75,
    roughnessMean: 0.25,
    waterCoverage: 0.125,
    canopyCoverage: 0.5,
    slopeMax: 0.5,
    ...farSummaryGpuV2FallbackChannels(2),
    revision: 7,
    flags: 11,
    sampleCount: 16,
    ...overrides,
  };
}

function cpu(overrides: Partial<FarSummaryCpuReferenceMetrics> = {}): FarSummaryCpuReferenceMetrics {
  return {
    sampleCount: 16,
    heightMin: 1,
    heightMax: 3,
    heightAvg: 2,
    avgNormalX: 0,
    avgNormalY: 1,
    avgNormalZ: 0,
    dominantMaterial: 2,
    materialVariance: 0.125,
    canopyCoverage: 0.5,
    waterCoverage: 0.125,
    slopeMean: 0.25,
    slopeMax: 0.5,
    roughnessMean: 0.25,
    grassEligibility: 0.75,
    ...farSummaryGpuV2FallbackChannels(2),
    ...overrides,
  };
}

function encode(records: readonly FarSummaryGpuRecord[]): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(1, records.length) * FAR_SUMMARY_GPU_RECORD_BYTES);
  const view = new DataView(buffer);
  records.forEach((item, index) => {
    const base = index * FAR_SUMMARY_GPU_RECORD_BYTES;
    view.setFloat32(base, item.heightMin, true);
    view.setFloat32(base + 4, item.heightMax, true);
    view.setFloat32(base + 8, item.heightAvg, true);
    view.setFloat32(base + 12, item.slopeMean, true);
    view.setFloat32(base + 16, item.avgNormalX, true);
    view.setFloat32(base + 20, item.avgNormalY, true);
    view.setFloat32(base + 24, item.avgNormalZ, true);
    view.setFloat32(base + 32, item.dominantMaterial, true);
    view.setFloat32(base + 36, item.materialVariance, true);
    view.setFloat32(base + 40, item.grassEligibility, true);
    view.setFloat32(base + 44, item.roughnessMean, true);
    view.setFloat32(base + 48, item.waterCoverage, true);
    view.setFloat32(base + 52, item.canopyCoverage, true);
    view.setFloat32(base + 56, item.slopeMax, true);
    view.setFloat32(base + 60, item.waterLevel, true);
    view.setFloat32(base + 64, item.canopyHeightAvg, true);
    view.setFloat32(base + 68, item.speciesPine, true);
    view.setFloat32(base + 72, item.speciesBroadleaf, true);
    view.setFloat32(base + 76, item.speciesDeadwood, true);
    view.setUint32(base + 80, item.bodyKind, true);
    view.setUint32(base + 84, item.revision, true);
    view.setUint32(base + 88, item.flags, true);
    view.setUint32(base + 92, item.sampleCount, true);
    view.setFloat32(base + 96, item.shoreDistance, true);
    view.setFloat32(base + 100, item.flowX, true);
    view.setFloat32(base + 104, item.flowZ, true);
    view.setFloat32(base + 108, item.structureCoverage, true);
    view.setFloat32(base + 112, item.caveEntranceCoverage, true);
    view.setFloat32(base + 116, item.occluderHeight, true);
  });
  return buffer;
}

function expectDecodedRecordToMatch(decoded: FarSummaryGpuRecord, expected: FarSummaryGpuRecord): void {
  expect(decoded.heightMin).toBeCloseTo(expected.heightMin, 6);
  expect(decoded.heightMax).toBeCloseTo(expected.heightMax, 6);
  expect(decoded.heightAvg).toBeCloseTo(expected.heightAvg, 6);
  expect(decoded.slopeMean).toBeCloseTo(expected.slopeMean, 6);
  expect(decoded.avgNormalX).toBeCloseTo(expected.avgNormalX, 6);
  expect(decoded.avgNormalY).toBeCloseTo(expected.avgNormalY, 6);
  expect(decoded.avgNormalZ).toBeCloseTo(expected.avgNormalZ, 6);
  expect(decoded.materialVariance).toBeCloseTo(expected.materialVariance, 6);
  expect(decoded.grassEligibility).toBeCloseTo(expected.grassEligibility, 6);
  expect(decoded.roughnessMean).toBeCloseTo(expected.roughnessMean, 6);
  expect(decoded.waterCoverage).toBeCloseTo(expected.waterCoverage, 6);
  expect(decoded.canopyCoverage).toBeCloseTo(expected.canopyCoverage, 6);
  expect(decoded.slopeMax).toBeCloseTo(expected.slopeMax, 6);
  expect(decoded.waterLevel).toBeCloseTo(expected.waterLevel, 6);
  expect(decoded.bodyKind).toBe(expected.bodyKind);
  expect(decoded.shoreDistance).toBeCloseTo(expected.shoreDistance, 6);
  expect(decoded.flowX).toBeCloseTo(expected.flowX, 6);
  expect(decoded.flowZ).toBeCloseTo(expected.flowZ, 6);
  expect(decoded.canopyHeightAvg).toBeCloseTo(expected.canopyHeightAvg, 6);
  expect(decoded.speciesPine).toBeCloseTo(expected.speciesPine, 6);
  expect(decoded.speciesBroadleaf).toBeCloseTo(expected.speciesBroadleaf, 6);
  expect(decoded.speciesDeadwood).toBeCloseTo(expected.speciesDeadwood, 6);
  expect(decoded.structureCoverage).toBeCloseTo(expected.structureCoverage, 6);
  expect(decoded.caveEntranceCoverage).toBeCloseTo(expected.caveEntranceCoverage, 6);
  expect(decoded.occluderHeight).toBeCloseTo(expected.occluderHeight, 6);
  expect(decoded.dominantMaterial).toBe(expected.dominantMaterial);
  expect(decoded.revision).toBe(expected.revision);
  expect(decoded.flags).toBe(expected.flags);
  expect(decoded.sampleCount).toBe(expected.sampleCount);
}

describe("decodeFarSummaryGpuRecords", () => {
  it("decodes the stable GPU summary record ABI", () => {
    const expected = record({
      roughnessMean: 0.2,
      waterCoverage: 0.1,
      canopyCoverage: 0.3,
      waterLevel: 11,
      bodyKind: 2,
      shoreDistance: 7,
      flowX: 0.4,
      flowZ: -0.2,
      canopyHeightAvg: 33,
      speciesPine: 0.2,
      speciesBroadleaf: 0.7,
      speciesDeadwood: 0.1,
      structureCoverage: 0.25,
      caveEntranceCoverage: 0.125,
      occluderHeight: 18,
    });
    const decoded = decodeFarSummaryGpuRecord(encode([expected]), 0);
    expectDecodedRecordToMatch(decoded, expected);
  });

  it("decodes multiple records", () => {
    const decoded = decodeFarSummaryGpuRecords(encode([record(), record({ revision: 8, heightAvg: 4 })]), 2);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.revision).toBe(7);
    expect(decoded[1]!.revision).toBe(8);
    expect(decoded[1]!.heightAvg).toBe(4);
  });

  it("rejects out-of-range buffers", () => {
    expect(() => decodeFarSummaryGpuRecords(new ArrayBuffer(4), 1)).toThrow(/too small/);
    expect(() => decodeFarSummaryGpuRecord(new ArrayBuffer(FAR_SUMMARY_GPU_RECORD_BYTES), 1)).toThrow(/out of range/);
  });
});

describe("compareFarSummaryGpuRecordToCpu", () => {
  it("passes matching GPU and CPU summaries", () => {
    const result = compareFarSummaryGpuRecordToCpu(record(), cpu());
    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("fails numeric mismatches beyond tolerance", () => {
    const result = compareFarSummaryGpuRecordToCpu(record({ heightAvg: 4 }), cpu());
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.field === "heightAvg")).toBe(true);
  });

  it("fails dominant material mismatches exactly", () => {
    const result = compareFarSummaryGpuRecordToCpu(record({ dominantMaterial: 3 }), cpu());
    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual({ field: "dominantMaterial", gpu: 3, cpu: 2, tolerance: 0 });
  });

  it("fails layout-v2 channel mismatches", () => {
    const result = compareFarSummaryGpuRecordToCpu(record({ waterLevel: 20, bodyKind: 2 }), cpu());
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.field === "waterLevel")).toBe(true);
    expect(result.mismatches.some((mismatch) => mismatch.field === "bodyKind")).toBe(true);
  });
});
