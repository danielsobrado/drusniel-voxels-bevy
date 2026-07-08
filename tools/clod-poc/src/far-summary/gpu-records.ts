import { FAR_SUMMARY_GPU_RECORD_BYTES } from "./gpu-config.js";
import type { FarSummaryCpuReferenceMetrics } from "./cpu-reference.js";

export interface FarSummaryGpuRecord {
  heightMin: number;
  heightMax: number;
  heightAvg: number;
  slopeMean: number;
  avgNormalX: number;
  avgNormalY: number;
  avgNormalZ: number;
  dominantMaterial: number;
  materialVariance: number;
  grassEligibility: number;
  roughnessMean: number;
  waterCoverage: number;
  canopyCoverage: number;
  slopeMax: number;
  revision: number;
  flags: number;
  sampleCount: number;
}

export interface FarSummaryGpuParityTolerances {
  height: number;
  normal: number;
  coverage: number;
  slope: number;
  roughness: number;
  materialVariance: number;
  grassEligibility: number;
}

export interface FarSummaryGpuParityMismatch {
  field: keyof FarSummaryGpuRecord | keyof FarSummaryCpuReferenceMetrics;
  gpu: number;
  cpu: number;
  tolerance: number;
}

export interface FarSummaryGpuParityResult {
  passed: boolean;
  mismatches: FarSummaryGpuParityMismatch[];
}

export const DEFAULT_FAR_SUMMARY_GPU_PARITY_TOLERANCES: FarSummaryGpuParityTolerances = {
  height: 0.05,
  normal: 0.02,
  coverage: 0.02,
  slope: 0.02,
  roughness: 0.02,
  materialVariance: 0.02,
  grassEligibility: 0.02,
};

export function decodeFarSummaryGpuRecords(buffer: ArrayBuffer, recordCount: number): FarSummaryGpuRecord[] {
  const count = Math.max(0, Math.floor(recordCount));
  if (buffer.byteLength < count * FAR_SUMMARY_GPU_RECORD_BYTES) {
    throw new Error(`far-summary GPU record buffer too small: ${buffer.byteLength} bytes for ${count} record(s)`);
  }
  return Array.from({ length: count }, (_, index) => decodeFarSummaryGpuRecord(buffer, index));
}

export function decodeFarSummaryGpuRecord(buffer: ArrayBuffer, index: number): FarSummaryGpuRecord {
  const base = Math.floor(index) * FAR_SUMMARY_GPU_RECORD_BYTES;
  if (base < 0 || base + FAR_SUMMARY_GPU_RECORD_BYTES > buffer.byteLength) {
    throw new Error(`far-summary GPU record index ${index} is out of range`);
  }
  const view = new DataView(buffer);
  return {
    heightMin: view.getFloat32(base, true),
    heightMax: view.getFloat32(base + 4, true),
    heightAvg: view.getFloat32(base + 8, true),
    slopeMean: view.getFloat32(base + 12, true),
    avgNormalX: view.getFloat32(base + 16, true),
    avgNormalY: view.getFloat32(base + 20, true),
    avgNormalZ: view.getFloat32(base + 24, true),
    dominantMaterial: Math.round(view.getFloat32(base + 32, true)),
    materialVariance: view.getFloat32(base + 36, true),
    grassEligibility: view.getFloat32(base + 40, true),
    roughnessMean: view.getFloat32(base + 44, true),
    waterCoverage: view.getFloat32(base + 48, true),
    canopyCoverage: view.getFloat32(base + 52, true),
    slopeMax: view.getFloat32(base + 56, true),
    revision: view.getUint32(base + 84, true),
    flags: view.getUint32(base + 88, true),
    sampleCount: view.getUint32(base + 92, true),
  };
}

export function compareFarSummaryGpuRecordToCpu(
  gpu: FarSummaryGpuRecord,
  cpu: FarSummaryCpuReferenceMetrics,
  tolerances: FarSummaryGpuParityTolerances = DEFAULT_FAR_SUMMARY_GPU_PARITY_TOLERANCES,
): FarSummaryGpuParityResult {
  const mismatches: FarSummaryGpuParityMismatch[] = [];
  compareNumber(mismatches, "heightMin", gpu.heightMin, cpu.heightMin, tolerances.height);
  compareNumber(mismatches, "heightMax", gpu.heightMax, cpu.heightMax, tolerances.height);
  compareNumber(mismatches, "heightAvg", gpu.heightAvg, cpu.heightAvg, tolerances.height);
  compareNumber(mismatches, "slopeMean", gpu.slopeMean, cpu.slopeMean, tolerances.slope);
  compareNumber(mismatches, "slopeMax", gpu.slopeMax, cpu.slopeMax, tolerances.slope);
  compareNumber(mismatches, "avgNormalX", gpu.avgNormalX, cpu.avgNormalX, tolerances.normal);
  compareNumber(mismatches, "avgNormalY", gpu.avgNormalY, cpu.avgNormalY, tolerances.normal);
  compareNumber(mismatches, "avgNormalZ", gpu.avgNormalZ, cpu.avgNormalZ, tolerances.normal);
  compareNumber(mismatches, "materialVariance", gpu.materialVariance, cpu.materialVariance, tolerances.materialVariance);
  compareNumber(mismatches, "canopyCoverage", gpu.canopyCoverage, cpu.canopyCoverage, tolerances.coverage);
  compareNumber(mismatches, "waterCoverage", gpu.waterCoverage, cpu.waterCoverage, tolerances.coverage);
  compareNumber(mismatches, "roughnessMean", gpu.roughnessMean, cpu.roughnessMean, tolerances.roughness);
  compareNumber(mismatches, "grassEligibility", gpu.grassEligibility, cpu.grassEligibility, tolerances.grassEligibility);
  if (gpu.dominantMaterial !== cpu.dominantMaterial) {
    mismatches.push({ field: "dominantMaterial", gpu: gpu.dominantMaterial, cpu: cpu.dominantMaterial, tolerance: 0 });
  }
  return { passed: mismatches.length === 0, mismatches };
}

function compareNumber(
  out: FarSummaryGpuParityMismatch[],
  field: FarSummaryGpuParityMismatch["field"],
  gpu: number,
  cpu: number,
  tolerance: number,
): void {
  if (Number.isFinite(gpu) && Number.isFinite(cpu) && Math.abs(gpu - cpu) <= tolerance) return;
  out.push({ field, gpu, cpu, tolerance });
}
