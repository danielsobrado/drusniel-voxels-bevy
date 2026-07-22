import {
  DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME,
  DEFAULT_MAX_CACHED_PAGES,
  DEFAULT_MAX_INFLIGHT_BATCHES,
  resolveRootTransitionOptions,
  type StreamingClodRootTransitionOptions,
} from "./streaming_clod_root_budgets.js";

export const STREAM_COUNTER_LEVELS = 4;
export const OUT_OF_WORLD_EDITS_SUPPORTED = 1;

export interface StreamingClodRootStats {
  requiredPages: number;
  cachedPages: number;
  builtThisFrame: number;
  failedPages: number;
  evictions: number;
  buildMs: number;
  pendingPages: number;
  waitingOnTiles: number;
  buildBudget: number;
  inflightBatches: number;
  maxInflightBatches: number;
  applyQueuePages: number;
  activeRootPages: number;
  maxCachedPages: number;
  safetyCacheCapacityOk: number;
  safetyRequiredPages: number;
  safetyReadyPages: number;
  safetyPendingPages: number;
  safetyInflightPages: number;
  refinementPendingPages: number;
  refinementInflightPages: number;
  parentCoverageViolations: number;
  readyPages: number;
  readyFrontierM: number;
  scheduledPagesThisFrame: number;
  applyPagesThisFrame: number;
  applyMs: number;
  staleDiscards: number;
  workerBuildMs: number;
  workerTransferBytes: number;
  probeActive: number;
  probeRequestedPagesTotal: number;
  probeApplyPagesTotal: number;
  probeEvictionsTotal: number;
  probeStaleDiscardsTotal: number;
  outOfWorldEditsSupported: number;
  invalidationsTotal: number;
  invalidatedPagesTotal: number;
  rebuiltAfterInvalidationTotal: number;
  inflightMs: number;
  inflightPageLevels: number[];
  scheduledBudgetCost: number;
  workerBuildFailures: number;
  workerBuildTimeouts: number;
  maxRootLevel: number;
  rootSwitchStableFrames: number;
  rootSwitchPendingPages: number;
  rootSwitchSuppressedFrames: number;
  rootSwitchesTotal: number;
  requestedPagesByLevel: number[];
  appliedPagesByLevel: number[];
  staleCompletedPagesByLevel: number[];
  workerBuildMsP95ByLevel: number[];
  transitionEnabled: number;
  transitionActiveGroups: number;
  transitionActiveRoots: number;
  transitionFadeInRoots: number;
  transitionFadeOutRoots: number;
  transitionHardSwitchesTotal: number;
  transitionCancelledTotal: number;
  transitionCappedTotal: number;
  transitionCompletedTotal: number;
  transitionDrawOverheadRoots: number;
  transitionDurationFrames: number;
  transitionProgressMin: number;
  transitionProgressMax: number;
  transitionMsP95: number;
}

export function zeroLevelArray(): number[] {
  return Array.from({ length: STREAM_COUNTER_LEVELS }, () => 0);
}

export function incrementLevel(values: number[], level: number, amount = 1): void {
  const index = Math.max(0, Math.min(STREAM_COUNTER_LEVELS - 1, Math.floor(level)));
  values[index] = (values[index] ?? 0) + amount;
}

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

export function workerP95(samples: readonly number[][]): number[] {
  return samples.map((values) => percentile95(values));
}

export function emptyStats(
  maxRootLevel = 0,
  maxCachedPages = DEFAULT_MAX_CACHED_PAGES,
  maxInflightBatches = DEFAULT_MAX_INFLIGHT_BATCHES,
  rootTransitionOptions: StreamingClodRootTransitionOptions = resolveRootTransitionOptions({ enabled: false }),
): StreamingClodRootStats {
  return {
    requiredPages: 0,
    cachedPages: 0,
    builtThisFrame: 0,
    failedPages: 0,
    evictions: 0,
    buildMs: 0,
    pendingPages: 0,
    waitingOnTiles: 0,
    buildBudget: DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME,
    inflightBatches: 0,
    maxInflightBatches,
    applyQueuePages: 0,
    activeRootPages: 0,
    maxCachedPages,
    safetyCacheCapacityOk: 1,
    safetyRequiredPages: 0,
    safetyReadyPages: 0,
    safetyPendingPages: 0,
    safetyInflightPages: 0,
    refinementPendingPages: 0,
    refinementInflightPages: 0,
    parentCoverageViolations: 0,
    readyPages: 0,
    readyFrontierM: 0,
    scheduledPagesThisFrame: 0,
    applyPagesThisFrame: 0,
    applyMs: 0,
    staleDiscards: 0,
    workerBuildMs: 0,
    workerTransferBytes: 0,
    probeActive: 0,
    probeRequestedPagesTotal: 0,
    probeApplyPagesTotal: 0,
    probeEvictionsTotal: 0,
    probeStaleDiscardsTotal: 0,
    outOfWorldEditsSupported: OUT_OF_WORLD_EDITS_SUPPORTED,
    invalidationsTotal: 0,
    invalidatedPagesTotal: 0,
    rebuiltAfterInvalidationTotal: 0,
    inflightMs: 0,
    inflightPageLevels: [],
    scheduledBudgetCost: 0,
    workerBuildFailures: 0,
    workerBuildTimeouts: 0,
    maxRootLevel,
    rootSwitchStableFrames: 0,
    rootSwitchPendingPages: 0,
    rootSwitchSuppressedFrames: 0,
    rootSwitchesTotal: 0,
    requestedPagesByLevel: zeroLevelArray(),
    appliedPagesByLevel: zeroLevelArray(),
    staleCompletedPagesByLevel: zeroLevelArray(),
    workerBuildMsP95ByLevel: zeroLevelArray(),
    transitionEnabled: rootTransitionOptions.enabled ? 1 : 0,
    transitionActiveGroups: 0,
    transitionActiveRoots: 0,
    transitionFadeInRoots: 0,
    transitionFadeOutRoots: 0,
    transitionHardSwitchesTotal: 0,
    transitionCancelledTotal: 0,
    transitionCappedTotal: 0,
    transitionCompletedTotal: 0,
    transitionDrawOverheadRoots: 0,
    transitionDurationFrames: rootTransitionOptions.durationFrames,
    transitionProgressMin: 0,
    transitionProgressMax: 0,
    transitionMsP95: 0,
  };
}

function clodCounters(): Record<string, number> | null {
  const maybeWindow = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window;
  return maybeWindow?.__drusnielClod?.stats?.counters ?? null;
}

function writePerLevelStreamingCounters(counters: Record<string, number>, stats: StreamingClodRootStats): void {
  counters["live_clod_stream_max_root_level"] = stats.maxRootLevel;
  for (let level = 0; level < STREAM_COUNTER_LEVELS; level++) {
    counters[`live_clod_stream_requested_l${level}_pages`] = stats.requestedPagesByLevel[level] ?? 0;
    counters[`live_clod_stream_applied_l${level}_pages`] = stats.appliedPagesByLevel[level] ?? 0;
    counters[`live_clod_stream_stale_completed_l${level}_pages`] = stats.staleCompletedPagesByLevel[level] ?? 0;
    counters[`live_clod_stream_worker_build_ms_l${level}_p95`] = stats.workerBuildMsP95ByLevel[level] ?? 0;
  }
}

function writeTransitionCounters(counters: Record<string, number>, stats: StreamingClodRootStats): void {
  counters["live_clod_stream_transition_enabled"] = stats.transitionEnabled;
  counters["live_clod_stream_transition_active_groups"] = stats.transitionActiveGroups;
  counters["live_clod_stream_transition_active_roots"] = stats.transitionActiveRoots;
  counters["live_clod_stream_transition_fade_in_roots"] = stats.transitionFadeInRoots;
  counters["live_clod_stream_transition_fade_out_roots"] = stats.transitionFadeOutRoots;
  counters["live_clod_stream_transition_hard_switches_total"] = stats.transitionHardSwitchesTotal;
  counters["live_clod_stream_transition_cancelled_total"] = stats.transitionCancelledTotal;
  counters["live_clod_stream_transition_capped_total"] = stats.transitionCappedTotal;
  counters["live_clod_stream_transition_completed_total"] = stats.transitionCompletedTotal;
  counters["live_clod_stream_transition_draw_overhead_roots"] = stats.transitionDrawOverheadRoots;
  counters["live_clod_stream_transition_duration_frames"] = stats.transitionDurationFrames;
  counters["live_clod_stream_transition_progress_min"] = stats.transitionProgressMin;
  counters["live_clod_stream_transition_progress_max"] = stats.transitionProgressMax;
  counters["live_clod_stream_transition_ms_p95"] = stats.transitionMsP95;
}

function writeStreamingProbeCounters(stats: StreamingClodRootStats): void {
  const counters = clodCounters();
  if (!counters) return;
  counters["live_clod_stream_scheduled_pages_this_frame"] = stats.scheduledPagesThisFrame;
  counters["live_clod_stream_apply_queue_pages"] = stats.applyQueuePages;
  counters["live_clod_stream_active_root_pages"] = stats.activeRootPages;
  counters["live_clod_stream_root_switch_stable_frames"] = stats.rootSwitchStableFrames;
  counters["live_clod_stream_root_switch_pending_pages"] = stats.rootSwitchPendingPages;
  counters["live_clod_stream_root_switch_suppressed_frames"] = stats.rootSwitchSuppressedFrames;
  counters["live_clod_stream_root_switches_total"] = stats.rootSwitchesTotal;
  counters["live_clod_stream_max_inflight_batches"] = stats.maxInflightBatches;
  counters["live_clod_stream_max_cached_pages"] = stats.maxCachedPages;
  counters["live_clod_stream_safety_cache_capacity_ok"] = stats.safetyCacheCapacityOk;
  counters["live_clod_stream_safety_required_pages"] = stats.safetyRequiredPages;
  counters["live_clod_stream_safety_ready_pages"] = stats.safetyReadyPages;
  counters["live_clod_stream_safety_pending_pages"] = stats.safetyPendingPages;
  counters["live_clod_stream_safety_inflight_pages"] = stats.safetyInflightPages;
  counters["live_clod_stream_refinement_pending_pages"] = stats.refinementPendingPages;
  counters["live_clod_stream_refinement_inflight_pages"] = stats.refinementInflightPages;
  counters["live_clod_stream_parent_coverage_violations"] = stats.parentCoverageViolations;
  counters["live_clod_stream_ready_pages"] = stats.readyPages;
  counters["live_clod_stream_ready_frontier_m"] = stats.readyFrontierM;
  counters["root_worker_batches_inflight"] = stats.inflightBatches;
  counters["gpu_mesher_lane_busy_root"] = 0;
  counters["live_clod_stream_probe_active"] = stats.probeActive;
  counters["live_clod_stream_probe_requested_pages_total"] = stats.probeRequestedPagesTotal;
  counters["live_clod_stream_probe_apply_pages_total"] = stats.probeApplyPagesTotal;
  counters["live_clod_stream_probe_evictions_total"] = stats.probeEvictionsTotal;
  counters["live_clod_stream_probe_stale_discards_total"] = stats.probeStaleDiscardsTotal;
  counters["live_clod_stream_out_of_world_edits_supported"] = stats.outOfWorldEditsSupported;
  counters["live_clod_stream_invalidations_total"] = stats.invalidationsTotal;
  counters["live_clod_stream_invalidated_pages_total"] = stats.invalidatedPagesTotal;
  counters["live_clod_stream_rebuilt_after_invalidation_total"] = stats.rebuiltAfterInvalidationTotal;
  writeTransitionCounters(counters, stats);
  writePerLevelStreamingCounters(counters, stats);
  if (stats.probeActive === 1) {
    counters["live_clod_stream_built_total"] = stats.probeApplyPagesTotal;
    counters["live_clod_stream_apply_pages_total"] = stats.probeApplyPagesTotal;
    counters["live_clod_stream_evictions_total"] = stats.probeEvictionsTotal;
    counters["live_clod_stream_stale_discards_total"] = stats.probeStaleDiscardsTotal;
  }
}

export function mirrorStreamingProbeCounters(stats: StreamingClodRootStats): void {
  writeStreamingProbeCounters(stats);
  // The frame-loop counter mirror runs later in the same frame and overwrites the
  // shared totals with its cumulative counts, so an active probe must re-assert its
  // overrides after it. Only those four counters conflict — everything else either
  // has a single writer or receives identical values from both mirrors — and outside
  // probe mode there is nothing to re-assert, so normal gameplay pays no microtask.
  if (stats.probeActive !== 1) return;
  globalThis.queueMicrotask?.(() => {
    const counters = clodCounters();
    if (!counters) return;
    counters["live_clod_stream_built_total"] = stats.probeApplyPagesTotal;
    counters["live_clod_stream_apply_pages_total"] = stats.probeApplyPagesTotal;
    counters["live_clod_stream_evictions_total"] = stats.probeEvictionsTotal;
    counters["live_clod_stream_stale_discards_total"] = stats.probeStaleDiscardsTotal;
  });
}

export function resetStreamingCounterMirrors(): void {
  const counters = clodCounters();
  if (!counters) return;
  counters["live_clod_stream_built_total"] = 0;
  counters["live_clod_stream_apply_pages_total"] = 0;
  counters["live_clod_stream_evictions_total"] = 0;
  counters["live_clod_stream_stale_discards_total"] = 0;
  counters["live_clod_stream_apply_queue_pages"] = 0;
  counters["live_clod_stream_active_root_pages"] = 0;
  counters["live_clod_stream_root_switch_stable_frames"] = 0;
  counters["live_clod_stream_root_switch_pending_pages"] = 0;
  counters["live_clod_stream_root_switch_suppressed_frames"] = 0;
  counters["live_clod_stream_root_switches_total"] = 0;
  counters["live_clod_stream_safety_cache_capacity_ok"] = 1;
  counters["live_clod_stream_safety_required_pages"] = 0;
  counters["live_clod_stream_safety_ready_pages"] = 0;
  counters["live_clod_stream_safety_pending_pages"] = 0;
  counters["live_clod_stream_safety_inflight_pages"] = 0;
  counters["live_clod_stream_refinement_pending_pages"] = 0;
  counters["live_clod_stream_refinement_inflight_pages"] = 0;
  counters["live_clod_stream_parent_coverage_violations"] = 0;
  counters["live_clod_stream_ready_pages"] = 0;
  counters["live_clod_stream_probe_active"] = 1;
  counters["live_clod_stream_probe_requested_pages_total"] = 0;
  counters["live_clod_stream_probe_apply_pages_total"] = 0;
  counters["live_clod_stream_probe_evictions_total"] = 0;
  counters["live_clod_stream_probe_stale_discards_total"] = 0;
  writeTransitionCounters(counters, emptyStats());
  for (let level = 0; level < STREAM_COUNTER_LEVELS; level++) {
    counters[`live_clod_stream_requested_l${level}_pages`] = 0;
    counters[`live_clod_stream_applied_l${level}_pages`] = 0;
    counters[`live_clod_stream_stale_completed_l${level}_pages`] = 0;
    counters[`live_clod_stream_worker_build_ms_l${level}_p95`] = 0;
  }
}

export function registerGlobalStreamProbe(beginMovementProbe: () => void): void {
  const maybeWindow = (globalThis as typeof globalThis & {
    window?: {
      __drusnielClod?: { beginMovementRouteProbe?: (() => void) | null };
      __drusnielBeginLiveBubbleMovementProbe?: () => void;
      __drusnielBeginStreamingMovementProbe?: () => void;
    };
  }).window;
  if (!maybeWindow) return;
  maybeWindow.__drusnielBeginStreamingMovementProbe = beginMovementProbe;
  if (maybeWindow.__drusnielClod) {
    maybeWindow.__drusnielClod.beginMovementRouteProbe = () => {
      beginMovementProbe();
      maybeWindow.__drusnielBeginLiveBubbleMovementProbe?.();
    };
  }
}
