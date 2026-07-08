import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryGpuPlan } from "./gpu-planner.js";
import type { FarSummaryGpuConfig } from "./gpu-config.js";
import type { FarSummaryGpuCounters } from "./gpu-counters.js";
import {
  buildCpuFarSummaryTileReference,
  summarizeCpuFarSummaryTileReference,
} from "./cpu-reference.js";
import {
  compareFarSummaryGpuRecordToCpu,
  DEFAULT_FAR_SUMMARY_GPU_PARITY_TOLERANCES,
  type FarSummaryGpuParityMismatch,
  type FarSummaryGpuParityTolerances,
  type FarSummaryGpuRecord,
} from "./gpu-records.js";

export type FarSummaryGpuParitySkipReason =
  | "gpu_disabled"
  | "strict_parity_disabled"
  | "debug_readback_disabled"
  | "no_debug_readbacks";

export interface FarSummaryGpuParityReadback {
  batchIndex: number;
  records: readonly FarSummaryGpuRecord[];
}

export interface FarSummaryGpuTileParityFailure {
  batchIndex: number;
  recordIndex: number;
  tileId: string;
  reason: "missing_batch" | "missing_tile" | "field_mismatch";
  mismatches: FarSummaryGpuParityMismatch[];
}

export interface FarSummaryGpuParityEvaluation {
  enabled: boolean;
  checkedTiles: number;
  failedTiles: number;
  skippedReason: FarSummaryGpuParitySkipReason | null;
  failures: FarSummaryGpuTileParityFailure[];
}

export interface FarSummaryGpuParityInput {
  config: FarSummaryGpuConfig;
  plan: FarSummaryGpuPlan;
  debugReadbacks: readonly FarSummaryGpuParityReadback[];
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
  tolerances?: FarSummaryGpuParityTolerances;
}

export function shouldEvaluateFarSummaryGpuStrictParity(config: FarSummaryGpuConfig): boolean {
  return config.enabled && config.strictParity && config.debugReadback;
}

export function evaluateFarSummaryGpuDebugReadbackParity(input: FarSummaryGpuParityInput): FarSummaryGpuParityEvaluation {
  const skippedReason = paritySkipReason(input.config, input.debugReadbacks.length);
  if (skippedReason) {
    return {
      enabled: false,
      checkedTiles: 0,
      failedTiles: 0,
      skippedReason,
      failures: [],
    };
  }

  const tolerances = input.tolerances ?? DEFAULT_FAR_SUMMARY_GPU_PARITY_TOLERANCES;
  const failures: FarSummaryGpuTileParityFailure[] = [];
  let checkedTiles = 0;

  for (const readback of input.debugReadbacks) {
    const batch = input.plan.batches[readback.batchIndex];
    if (!batch) {
      failures.push({
        batchIndex: readback.batchIndex,
        recordIndex: -1,
        tileId: "missing-batch",
        reason: "missing_batch",
        mismatches: [],
      });
      continue;
    }

    readback.records.forEach((record, recordIndex) => {
      const tile = batch.tiles[recordIndex];
      if (!tile) {
        failures.push({
          batchIndex: readback.batchIndex,
          recordIndex,
          tileId: `missing-tile:${readback.batchIndex}:${recordIndex}`,
          reason: "missing_tile",
          mismatches: [],
        });
        return;
      }

      checkedTiles++;
      const cpuTile = buildCpuFarSummaryTileReference({
        tile,
        terrainSampler: input.terrainSampler,
        frameIndex: input.frameIndex,
        nowMs: input.nowMs,
      });
      const cpuMetrics = summarizeCpuFarSummaryTileReference(cpuTile);
      const parity = compareFarSummaryGpuRecordToCpu(record, cpuMetrics, tolerances);
      if (!parity.passed) {
        failures.push({
          batchIndex: readback.batchIndex,
          recordIndex,
          tileId: tileId(tile.ring, tile.tileX, tile.tileZ),
          reason: "field_mismatch",
          mismatches: parity.mismatches,
        });
      }
    });
  }

  return {
    enabled: true,
    checkedTiles,
    failedTiles: failures.length,
    skippedReason: null,
    failures,
  };
}

export function applyFarSummaryGpuParityEvaluationToCounters(
  counters: FarSummaryGpuCounters,
  evaluation: FarSummaryGpuParityEvaluation,
): void {
  if (!evaluation.enabled) return;
  counters.parityCheckedTiles += evaluation.checkedTiles;
  counters.parityFailedTiles += evaluation.failedTiles;
}

function paritySkipReason(config: FarSummaryGpuConfig, readbackCount: number): FarSummaryGpuParitySkipReason | null {
  if (!config.enabled) return "gpu_disabled";
  if (!config.strictParity) return "strict_parity_disabled";
  if (!config.debugReadback) return "debug_readback_disabled";
  if (readbackCount <= 0) return "no_debug_readbacks";
  return null;
}

function tileId(ring: number, x: number, z: number): string {
  return `r${ring}:${x},${z}`;
}
