import { describe, expect, it } from "vitest";
import { FAR_SUMMARY_GPU_RECORD_BYTES } from "./gpu-config.js";
import type { FarSummaryCpuReferenceMetrics } from "./cpu-reference.js";
import {
  compareFarSummaryGpuRecordToCpu,
  decodeFarSummaryGpuRecord,
  decodeFarSummaryGpuRecords,
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
    roughnessMean: 0.2,
    waterCoverage: 0.1,
    canopyCoverage: 0.3,
    slopeMax: 0.5,
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
    canopyCoverage: 0.3,
    waterCoverage: 0.1,
    slopeMean: 0.25,
    slopeMax: 0.5,
    roughnessMean: 0.2,
    grassEligibility: 0.75,
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
    view.setUint32(base + 84, item.revision, true);
    view.setUint32(base + 88, item.flags, true);
    view.setUint32(base + 92, item.sampleCount, true);
  });
  return buffer;
}

describe("decodeFarSummaryGpuRecords", () => {
  it("decodes the stable GPU summary record ABI", () => {
    const decoded = decodeFarSummaryGpuRecord(encode([record()]), 0);
    expect(decoded).toEqual(record());
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
});
