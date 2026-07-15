import { HEIGHT_UNITS_PER_METER, SEDIMENT_UNITS_PER_METER } from "./constants.js";
import type { ErosionArtifact, ErosionDiagnostics, ErodedMacroField } from "./types.js";

const EMPTY: ErosionDiagnostics = {
  erosion_enabled: 0,
  erosion_schema_version: 1,
  erosion_artifact_cache_hit: 0,
  erosion_artifact_bytes: 0,
  erosion_build_ms: 0,
  erosion_gpu_ms: 0,
  erosion_readback_ms: 0,
  erosion_checkpoint_count: 0,
  erosion_progress_percent: 0,
  erosion_height_min_m: 0,
  erosion_height_max_m: 0,
  erosion_total_eroded_m3: 0,
  erosion_total_deposited_m3: 0,
  erosion_mass_error_ratio: 0,
  erosion_cpu_gpu_mismatch_count: -1,
  erosion_gpu_timestamp_supported: 0,
  erosion_gpu_checkpoint_bytes: 0,
  erosion_gpu_checkpoint_resume: 0,
  erosion_main_thread_max_slice_ms: 0,
  erosion_artifact_hash_prefix: "",
};

let diagnostics: ErosionDiagnostics = { ...EMPTY };
let gpuPassCounters: Record<string, number> = {};

export function resetErosionDiagnostics(enabled: boolean): void {
  diagnostics = { ...EMPTY, erosion_enabled: enabled ? 1 : 0 };
  gpuPassCounters = {};
  publish();
}

export function updateErosionProgress(percent: number): void {
  diagnostics.erosion_progress_percent = Math.max(0, Math.min(100, percent));
  publish();
}

export function recordErosionArtifact(artifact: ErosionArtifact, cacheHit: boolean): void {
  const summary = summarizeField(artifact.field);
  gpuPassCounters = {};
  for (const [label, elapsedMs] of Object.entries(artifact.gpuPassTimingsMs)) {
    const key = `erosion_gpu_pass_${label.replace(/^erosion-/, "").replaceAll(/[^a-zA-Z0-9]+/g, "_")}_ms`;
    gpuPassCounters[key] = elapsedMs;
  }
  diagnostics = {
    ...diagnostics,
    erosion_enabled: diagnostics.erosion_enabled,
    erosion_artifact_cache_hit: cacheHit ? 1 : 0,
    erosion_artifact_bytes: artifact.compressedBytes.byteLength,
    erosion_build_ms: artifact.buildMs,
    erosion_gpu_ms: artifact.gpuMs,
    erosion_readback_ms: artifact.readbackMs,
    erosion_checkpoint_count: artifact.checkpointCount,
    erosion_progress_percent: 100,
    erosion_height_min_m: summary.minHeightM,
    erosion_height_max_m: summary.maxHeightM,
    erosion_total_eroded_m3: summary.erodedM3,
    erosion_total_deposited_m3: summary.depositedM3,
    erosion_mass_error_ratio: artifact.massErrorRatio,
    erosion_gpu_timestamp_supported: artifact.timestampQueriesSupported ? 1 : 0,
    erosion_artifact_hash_prefix: artifact.ref.hash.slice(0, 16),
  };
  publish();
}

export function recordCpuGpuMismatch(count: number): void {
  diagnostics.erosion_cpu_gpu_mismatch_count = count;
  publish();
}

export function recordGpuCheckpoint(byteLength: number, resumed = false): void {
  diagnostics.erosion_gpu_checkpoint_bytes = Math.max(0, byteLength);
  if (resumed) diagnostics.erosion_gpu_checkpoint_resume = 1;
  publish();
}

export function recordMainThreadSlice(elapsedMs: number): void {
  diagnostics.erosion_main_thread_max_slice_ms = Math.max(
    diagnostics.erosion_main_thread_max_slice_ms,
    Math.max(0, elapsedMs),
  );
  publish();
}

export function getErosionDiagnostics(): Readonly<ErosionDiagnostics> {
  return Object.freeze({ ...diagnostics });
}

function summarizeField(field: ErodedMacroField): {
  minHeightM: number;
  maxHeightM: number;
  erodedM3: number;
  depositedM3: number;
} {
  let minHeight = 0x7fffffff;
  let maxHeight = -0x80000000;
  let eroded = 0;
  let deposited = 0;
  for (let index = 0; index < field.heightFixed.length; index++) {
    minHeight = Math.min(minHeight, field.heightFixed[index]!);
    maxHeight = Math.max(maxHeight, field.heightFixed[index]!);
    const delta = field.deposition[index]!;
    if (delta < 0) eroded += -delta;
    else deposited += delta;
  }
  const cellArea = field.cellSizeM * field.cellSizeM;
  return {
    minHeightM: minHeight / HEIGHT_UNITS_PER_METER,
    maxHeightM: maxHeight / HEIGHT_UNITS_PER_METER,
    erodedM3: eroded / SEDIMENT_UNITS_PER_METER * cellArea,
    depositedM3: deposited / SEDIMENT_UNITS_PER_METER * cellArea,
  };
}

function publish(): void {
  if (typeof window === "undefined") return;
  const target = window as Window & { __drusnielErosionDiagnostics?: Readonly<ErosionDiagnostics> };
  target.__drusnielErosionDiagnostics = Object.freeze({ ...diagnostics });
  const counters = window.__drusnielClod?.stats?.counters;
  if (!counters) return;
  for (const [key, value] of Object.entries({ ...diagnostics, ...gpuPassCounters })) {
    if (typeof value === "number") counters[key] = value;
  }
}
