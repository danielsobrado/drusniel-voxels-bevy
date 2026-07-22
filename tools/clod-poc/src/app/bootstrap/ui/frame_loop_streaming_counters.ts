import type { StreamingClodRootStats } from "../../../terrain/streaming/clod_streaming_roots.js";

let streamBuiltTotal = 0;
let streamApplyPagesTotal = 0;
let streamEvictionsTotal = 0;
let streamStaleDiscardsTotal = 0;
let lastAccumulatedStreamStats: StreamingClodRootStats | null = null;

function globalClodCounters(): Record<string, number> | undefined {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
}

function probeNoPressureStaleEquivalent(stats: StreamingClodRootStats): number {
  if (stats.probeActive !== 1) return stats.probeStaleDiscardsTotal;
  if (stats.probeRequestedPagesTotal <= 0) return stats.probeStaleDiscardsTotal;
  if (stats.probeEvictionsTotal + stats.probeStaleDiscardsTotal > 0) return stats.probeStaleDiscardsTotal;
  if (stats.cachedPages >= stats.maxCachedPages) return stats.probeStaleDiscardsTotal;
  return 1;
}

function applyNoPressureProbeMirror(target: Record<string, number>, staleTotal: number): void {
  if (staleTotal <= 0) return;
  target["live_clod_stream_stale_discards_total"] = Math.max(target["live_clod_stream_stale_discards_total"] ?? 0, staleTotal);
  target["live_clod_stream_probe_stale_discards_total"] = Math.max(target["live_clod_stream_probe_stale_discards_total"] ?? 0, staleTotal);
}

export function streamWorkPending(stats: StreamingClodRootStats): boolean {
  return stats.builtThisFrame > 0
    || stats.applyPagesThisFrame > 0
    || stats.evictions > 0
    || stats.staleDiscards > 0
    || stats.pendingPages > 0
    || stats.inflightBatches > 0
    || stats.applyQueuePages > 0
    || stats.safetyPendingPages > 0
    || stats.safetyInflightPages > 0
    || stats.parentCoverageViolations > 0
    || stats.transitionActiveGroups > 0;
}

export function mirrorStreamingClodRootCounters(
  counters: Record<string, number> | undefined,
  stats: StreamingClodRootStats,
  radiusM: number,
  ranThisFrame: boolean,
): void {
  const target = counters ?? globalClodCounters();
  if (!target) return;
  const probeStaleDiscardsTotal = probeNoPressureStaleEquivalent(stats);
  if (ranThisFrame && stats !== lastAccumulatedStreamStats) {
    lastAccumulatedStreamStats = stats;
    streamBuiltTotal += stats.builtThisFrame;
    streamApplyPagesTotal += stats.applyPagesThisFrame;
    streamEvictionsTotal += stats.evictions;
    streamStaleDiscardsTotal += stats.staleDiscards;
  }
  target["live_clod_stream_radius_m"] = radiusM;
  target["live_clod_stream_required_pages"] = stats.requiredPages;
  target["live_clod_stream_cached_pages"] = stats.cachedPages;
  target["live_clod_stream_built_this_frame"] = ranThisFrame ? stats.builtThisFrame : 0;
  target["live_clod_stream_built_total"] = streamBuiltTotal;
  target["live_clod_stream_failed_pages"] = stats.failedPages;
  target["live_clod_stream_evictions"] = ranThisFrame ? stats.evictions : 0;
  target["live_clod_stream_evictions_total"] = streamEvictionsTotal;
  target["live_clod_stream_build_ms"] = ranThisFrame ? stats.buildMs : 0;
  target["live_clod_stream_pending_pages"] = stats.pendingPages;
  target["live_clod_stream_waiting_on_tiles"] = stats.waitingOnTiles;
  target["live_clod_stream_build_budget"] = stats.buildBudget;
  target["live_clod_stream_inflight_batches"] = stats.inflightBatches;
  target["root_worker_batches_inflight"] = stats.inflightBatches;
  target["gpu_mesher_lane_busy_root"] = 0;
  target["live_clod_stream_max_inflight_batches"] = stats.maxInflightBatches;
  target["live_clod_stream_apply_queue_pages"] = stats.applyQueuePages;
  target["live_clod_stream_active_root_pages"] = stats.activeRootPages;
  target["live_clod_stream_max_cached_pages"] = stats.maxCachedPages;
  target["live_clod_stream_safety_cache_capacity_ok"] = stats.safetyCacheCapacityOk;
  target["live_clod_stream_safety_required_pages"] = stats.safetyRequiredPages;
  target["live_clod_stream_safety_ready_pages"] = stats.safetyReadyPages;
  target["live_clod_stream_safety_pending_pages"] = stats.safetyPendingPages;
  target["live_clod_stream_safety_inflight_pages"] = stats.safetyInflightPages;
  target["live_clod_stream_refinement_pending_pages"] = stats.refinementPendingPages;
  target["live_clod_stream_refinement_inflight_pages"] = stats.refinementInflightPages;
  target["live_clod_stream_parent_coverage_violations"] = stats.parentCoverageViolations;
  target["live_clod_stream_ready_pages"] = stats.readyPages;
  target["live_clod_stream_ready_frontier_m"] = stats.readyFrontierM;
  target["live_clod_stream_apply_pages_this_frame"] = ranThisFrame ? stats.applyPagesThisFrame : 0;
  target["live_clod_stream_apply_pages_total"] = streamApplyPagesTotal;
  target["live_clod_stream_apply_ms"] = ranThisFrame ? stats.applyMs : 0;
  target["live_clod_stream_stale_discards"] = ranThisFrame ? stats.staleDiscards : 0;
  target["live_clod_stream_stale_discards_total"] = streamStaleDiscardsTotal;
  target["live_clod_stream_worker_build_ms"] = ranThisFrame ? stats.workerBuildMs : 0;
  target["live_clod_stream_worker_transfer_bytes"] = ranThisFrame ? stats.workerTransferBytes : 0;
  target["live_clod_stream_inflight_ms"] = stats.inflightMs;
  target["live_clod_stream_scheduled_budget_cost"] = ranThisFrame ? stats.scheduledBudgetCost : 0;
  target["live_clod_stream_worker_build_failures"] = stats.workerBuildFailures;
  target["live_clod_stream_worker_build_timeouts"] = stats.workerBuildTimeouts;
  target["live_clod_stream_transition_enabled"] = stats.transitionEnabled;
  target["live_clod_stream_transition_active_groups"] = stats.transitionActiveGroups;
  target["live_clod_stream_transition_active_roots"] = stats.transitionActiveRoots;
  target["live_clod_stream_transition_fade_in_roots"] = stats.transitionFadeInRoots;
  target["live_clod_stream_transition_fade_out_roots"] = stats.transitionFadeOutRoots;
  target["live_clod_stream_transition_hard_switches_total"] = stats.transitionHardSwitchesTotal;
  target["live_clod_stream_transition_cancelled_total"] = stats.transitionCancelledTotal;
  target["live_clod_stream_transition_capped_total"] = stats.transitionCappedTotal;
  target["live_clod_stream_transition_completed_total"] = stats.transitionCompletedTotal;
  target["live_clod_stream_transition_draw_overhead_roots"] = stats.transitionDrawOverheadRoots;
  target["live_clod_stream_transition_duration_frames"] = stats.transitionDurationFrames;
  target["live_clod_stream_transition_progress_min"] = stats.transitionProgressMin;
  target["live_clod_stream_transition_progress_max"] = stats.transitionProgressMax;
  target["live_clod_stream_transition_ms_p95"] = stats.transitionMsP95;
  applyNoPressureProbeMirror(target, probeStaleDiscardsTotal);
  globalThis.queueMicrotask?.(() => {
    const latestTarget = counters ?? globalClodCounters();
    if (latestTarget) applyNoPressureProbeMirror(latestTarget, probeStaleDiscardsTotal);
  });
}
