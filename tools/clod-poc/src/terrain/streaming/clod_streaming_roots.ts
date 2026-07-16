import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode, StreamedRootRenderState } from "../../types.js";

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

export interface StreamingClodRootController {
  update(center: THREE.Vector3, radiusM: number): StreamingClodRootStats;
  stats(): StreamingClodRootStats;
  readyPageKeys(): readonly string[];
  cachedPageKeys(): readonly string[];
  refinedReadyPageKeys(): readonly string[];
  beginMovementProbe(): void;
  invalidateBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void;
}

export interface PageCoord {
  px: number;
  pz: number;
  level?: number;
  centerX: number;
  centerZ: number;
}

export function pageBudgetCost(level = 0): number {
  return 4 ** Math.max(0, Math.floor(level));
}

export interface StreamingClodRootBuildResult {
  nodes: readonly ClodPageNode[];
  buildMs: number;
  transferBytes?: number;
}

export interface StreamingClodRootTransitionOptions {
  enabled: boolean;
  mode: "crossfade";
  durationFrames: number;
  maxExtraRoots: number;
}

export interface StreamingClodRootControllerDeps {
  roots: ClodPageNode[];
  allNodes: ClodPageNode[];
  cfg: ClodPagesConfig;
  worldCells: number;
  enabled: boolean;
  buildBudgetPagesPerFrame?: number;
  applyBudgetPagesPerFrame?: number;
  maxCachedPages?: number;
  evictDistanceMultiplier?: number;
  maxRootLevel?: number;
  maxInflightBatches?: number;
  rootSwitchStableFrames?: number;
  rootTransition?: Partial<StreamingClodRootTransitionOptions>;
  buildPages: ((coords: readonly PageCoord[]) => Promise<StreamingClodRootBuildResult>) | null;
  canBuildPage?: (coord: PageCoord) => boolean;
  /**
   * Optional sliced preparation gate run before a page becomes activation-eligible.
   * Returning false keeps the page in the ready queue so the currently rendered roots
   * remain visible until the replacement view is resident.
   */
  prepareNodeForApply?: (node: ClodPageNode, deadlineMs: number) => boolean;
  prepareNodeBudgetMs?: number;
  onNodesBuilt?: (nodes: readonly ClodPageNode[]) => void;
  onRootsChanged?: () => void;
}

interface CachedPage {
  node: ClodPageNode;
  centerX: number;
  centerZ: number;
  lastTouchFrame: number;
  activeEligible: boolean;
}

interface ReadyPage {
  node: ClodPageNode;
  staleCounted: boolean;
}

interface InflightBatch {
  id: number;
  ids: Set<string>;
  coordsById: Map<string, PageCoord>;
  startMs: number;
  revisionById: Map<string, number>;
  timedOut?: boolean;
}

interface FailedBuildState {
  attempts: number;
  retryAfterFrame: number;
}

interface MovementProbeState {
  active: boolean;
  requestedIds: Set<string>;
  requestedPagesTotal: number;
  applyPagesTotal: number;
  evictionsTotal: number;
  staleDiscardsTotal: number;
}

interface StreamingClodConfigCarrier {
  streaming?: { clod?: { max_root_level?: number } };
}

interface ActiveRootTransition {
  id: number;
  fromRootIds: Set<string>;
  toRootIds: Set<string>;
  startedFrame: number;
  durationFrames: number;
}

const DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_MAX_INFLIGHT_BATCHES = 1;
const DEFAULT_MAX_CACHED_PAGES = 128;
const DEFAULT_EVICT_DISTANCE_MULTIPLIER = 2.5;
const DEFAULT_STREAM_MAX_ROOT_LEVEL = 1;
const DEFAULT_ROOT_SWITCH_STABLE_FRAMES = 8;
const DEFAULT_ROOT_TRANSITION_FRAMES = 12;
const DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS = 64;
const STREAM_COUNTER_LEVELS = 4;
const WORKER_BUILD_MS_SAMPLE_LIMIT = 128;
const TRANSITION_MS_SAMPLE_LIMIT = 128;
const BUILD_RETRY_BASE_COOLDOWN_FRAMES = 60;
const BUILD_RETRY_MAX_COOLDOWN_FRAMES = 600;
const OUT_OF_WORLD_EDITS_SUPPORTED = 1;

function resolveBudget(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

function retryCooldownFrames(attempts: number): number {
  const multiplier = Math.min(8, 2 ** Math.max(0, attempts - 1));
  return Math.min(BUILD_RETRY_MAX_COOLDOWN_FRAMES, BUILD_RETRY_BASE_COOLDOWN_FRAMES * multiplier);
}

function querySearchParams(): URLSearchParams | null {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  const search = maybeWindow?.location?.search;
  return search ? new URLSearchParams(search) : null;
}

function queryStreamingClodMaxRootLevel(): number | undefined {
  const raw = querySearchParams()?.get("liveClodRootMaxLevel");
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function queryStreamingRootSwitchStableFrames(): number | undefined {
  const params = querySearchParams();
  if (!params) return undefined;
  const raw = params.get("liveClodRootSwitchStableFrames");
  if (raw === null || raw.trim() === "") return DEFAULT_ROOT_SWITCH_STABLE_FRAMES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_ROOT_SWITCH_STABLE_FRAMES;
}

function queryEnabledFlag(params: URLSearchParams | null, key: string): boolean | undefined {
  const raw = params?.get(key);
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  return raw === "1" || raw.toLowerCase() === "true";
}

function queryPositiveInteger(params: URLSearchParams | null, key: string, fallback: number): number {
  const parsed = Number(params?.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function queryNonNegativeInteger(params: URLSearchParams | null, key: string, fallback: number): number {
  const parsed = Number(params?.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function resolveRootTransitionOptions(override?: Partial<StreamingClodRootTransitionOptions>): StreamingClodRootTransitionOptions {
  const params = querySearchParams();
  const mode = params?.get("liveClodRootTransitionMode") === "crossfade" ? "crossfade" : "crossfade";
  return {
    enabled: override?.enabled ?? queryEnabledFlag(params, "liveClodRootTransition") ?? false,
    mode: override?.mode ?? mode,
    durationFrames: Math.max(1, Math.floor(override?.durationFrames ?? queryPositiveInteger(params, "liveClodRootTransitionFrames", DEFAULT_ROOT_TRANSITION_FRAMES))),
    maxExtraRoots: Math.max(0, Math.floor(override?.maxExtraRoots ?? queryNonNegativeInteger(params, "liveClodRootTransitionMaxExtraRoots", DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS))),
  };
}

export function resolveStreamingClodMaxRootLevel(cfg: ClodPagesConfig, override?: number): number {
  const fullMax = Math.max(0, Math.floor(cfg.page.quadtree_levels) - 1);
  const configured = (cfg as ClodPagesConfig & StreamingClodConfigCarrier).streaming?.clod?.max_root_level;
  const fallback = Math.min(DEFAULT_STREAM_MAX_ROOT_LEVEL, fullMax);
  const raw = override ?? queryStreamingClodMaxRootLevel() ?? configured ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, Math.min(fullMax, Math.floor(raw))) : fallback;
}

function coordLevel(coord: PageCoord): number {
  return Math.max(0, Math.floor(coord.level ?? 0));
}

function pageLevel0Bounds(page: { level: number; px: number; pz: number }): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const scale = 2 ** page.level;
  return { minX: page.px * scale, minZ: page.pz * scale, maxX: (page.px + 1) * scale, maxZ: (page.pz + 1) * scale };
}

function pageContainsPage(ancestorKey: string, descendantKey: string): boolean {
  const ancestor = parseStreamingClodPageKey(ancestorKey);
  const descendant = parseStreamingClodPageKey(descendantKey);
  if (ancestor.level <= descendant.level) return false;
  const ancestorBounds = pageLevel0Bounds(ancestor);
  const descendantBounds = pageLevel0Bounds(descendant);
  return descendantBounds.minX >= ancestorBounds.minX
    && descendantBounds.minZ >= ancestorBounds.minZ
    && descendantBounds.maxX <= ancestorBounds.maxX
    && descendantBounds.maxZ <= ancestorBounds.maxZ;
}

function pageFullyCoveredByFinerCachedPages(pageKey: string, cachedKeys: Iterable<string>): boolean {
  const page = parseStreamingClodPageKey(pageKey);
  if (page.level <= 0) return false;
  const bounds = pageLevel0Bounds(page);
  const span = bounds.maxX - bounds.minX;
  const covered = new Set<number>();

  for (const key of cachedKeys) {
    if (key === pageKey) continue;
    const child = parseStreamingClodPageKey(key);
    if (child.level >= page.level) continue;
    const childBounds = pageLevel0Bounds(child);
    const minX = Math.max(bounds.minX, childBounds.minX);
    const minZ = Math.max(bounds.minZ, childBounds.minZ);
    const maxX = Math.min(bounds.maxX, childBounds.maxX);
    const maxZ = Math.min(bounds.maxZ, childBounds.maxZ);
    if (minX >= maxX || minZ >= maxZ) continue;
    for (let z = minZ; z < maxZ; z++) {
      for (let x = minX; x < maxX; x++) covered.add((z - bounds.minZ) * span + (x - bounds.minX));
    }
  }

  return covered.size === span * span;
}

function pageCoveredByActiveRoots(pageKey: string, activeKeys: Iterable<string>): boolean {
  for (const activeKey of activeKeys) {
    if (activeKey === pageKey || pageContainsPage(activeKey, pageKey)) return true;
  }
  return pageFullyCoveredByFinerCachedPages(pageKey, activeKeys);
}

function stableSetKey(ids: Iterable<string>): string {
  return [...ids].sort().join("|");
}

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function zeroLevelArray(): number[] {
  return Array.from({ length: STREAM_COUNTER_LEVELS }, () => 0);
}

function incrementLevel(values: number[], level: number, amount = 1): void {
  const index = Math.max(0, Math.min(STREAM_COUNTER_LEVELS - 1, Math.floor(level)));
  values[index] = (values[index] ?? 0) + amount;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function workerP95(samples: readonly number[][]): number[] {
  return samples.map((values) => percentile95(values));
}

function clodCounters(): Record<string, number> | null {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } } }).window;
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

function mirrorStreamingProbeCounters(stats: StreamingClodRootStats): void {
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

function resetStreamingCounterMirrors(): void {
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

function registerGlobalStreamProbe(beginMovementProbe: () => void): void {
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

export function streamingClodPageKey(px: number, pz: number, level = 0): string {
  return `L${Math.max(0, Math.floor(level))}:${px},${pz}`;
}

// Parsing happens O(cached²) per frame inside eviction sorts and active-root/coverage checks;
// memoize so steady-state frames do Map lookups instead of string splits + allocations.
const parsedPageKeyCache = new Map<string, { level: number; px: number; pz: number }>();
const PARSED_PAGE_KEY_CACHE_LIMIT = 8192;

export function parseStreamingClodPageKey(key: string): { level: number; px: number; pz: number } {
  const memo = parsedPageKeyCache.get(key);
  if (memo) return memo;
  const [levelText, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(level) || !Number.isInteger(px) || !Number.isInteger(pz)) throw new Error(`Invalid streaming CLOD page key ${key}`);
  if (parsedPageKeyCache.size >= PARSED_PAGE_KEY_CACHE_LIMIT) parsedPageKeyCache.clear();
  const parsed = { level, px, pz };
  parsedPageKeyCache.set(key, parsed);
  return parsed;
}

export function streamingClodPageHasRequiredNotReadyDescendant(pageKey: string, required: Iterable<string>, cached: ReadonlySet<string>): boolean {
  const parent = parseStreamingClodPageKey(pageKey);
  for (const key of required) {
    if (cached.has(key)) continue;
    const child = parseStreamingClodPageKey(key);
    if (parent.level <= child.level) continue;
    const scale = 2 ** (parent.level - child.level);
    if (Math.floor(child.px / scale) === parent.px && Math.floor(child.pz / scale) === parent.pz) return true;
  }
  return false;
}

export function sortStreamingClodPageCoordsForLoad(coords: readonly PageCoord[], center: THREE.Vector3): PageCoord[] {
  return [...coords].sort((a, b) => {
    const levelA = coordLevel(a);
    const levelB = coordLevel(b);
    if (levelA !== levelB) return levelB - levelA;
    const da = Math.hypot(center.x - a.centerX, center.z - a.centerZ);
    const db = Math.hypot(center.x - b.centerX, center.z - b.centerZ);
    return da - db || a.px - b.px || a.pz - b.pz;
  });
}

export function streamingClodRequiredPageCoords(center: THREE.Vector3, radiusM: number, pageSizeM: number, maxLevel = 0): PageCoord[] {
  const radius = Math.max(0, Number.isFinite(radiusM) ? radiusM : 0);
  const pageSize = Math.max(1, Number.isFinite(pageSizeM) ? pageSizeM : 1);
  const highestLevel = Math.max(0, Math.floor(maxLevel));
  const minPx = Math.floor((center.x - radius) / pageSize);
  const maxPx = Math.floor((center.x + radius) / pageSize);
  const minPz = Math.floor((center.z - radius) / pageSize);
  const maxPz = Math.floor((center.z + radius) / pageSize);
  const halfDiag = pageSize * Math.SQRT2 * 0.5;
  const coordsById = new Map<string, PageCoord>();

  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      const centerX = (px + 0.5) * pageSize;
      const centerZ = (pz + 0.5) * pageSize;
      if (Math.hypot(center.x - centerX, center.z - centerZ) > radius + halfDiag) continue;
      for (let level = 0; level <= highestLevel; level++) {
        const scale = 2 ** level;
        const levelPx = Math.floor(px / scale);
        const levelPz = Math.floor(pz / scale);
        const levelPageSize = pageSize * scale;
        const key = streamingClodPageKey(levelPx, levelPz, level);
        if (coordsById.has(key)) continue;
        coordsById.set(key, { px: levelPx, pz: levelPz, level, centerX: (levelPx + 0.5) * levelPageSize, centerZ: (levelPz + 0.5) * levelPageSize });
      }
    }
  }

  return sortStreamingClodPageCoordsForLoad([...coordsById.values()], center);
}

/** Returns the conservative radius whose required level-zero pages are ready. */
export function streamingReadyFrontierM(
  center: Pick<THREE.Vector3, "x" | "z">,
  radiusM: number,
  pageSizeM: number,
  required: readonly PageCoord[],
  refinedReadyIds: ReadonlySet<string>,
): number {
  const radius = Math.max(0, Number.isFinite(radiusM) ? radiusM : 0);
  const pageSize = Math.max(1, Number.isFinite(pageSizeM) ? pageSizeM : 1);
  const halfDiagonal = pageSize * Math.SQRT2 * 0.5;
  let frontier = radius;
  for (const coord of required) {
    if (coordLevel(coord) !== 0) continue;
    if (refinedReadyIds.has(streamingClodPageKey(coord.px, coord.pz, 0))) continue;
    frontier = Math.min(
      frontier,
      Math.max(0, Math.hypot(center.x - coord.centerX, center.z - coord.centerZ) - halfDiagonal),
    );
  }
  return frontier;
}

export function pageInsideFiniteStartupWorld(px: number, pz: number, worldPagesX: number, worldPagesZ: number, level = 0): boolean {
  const scale = 2 ** Math.max(0, Math.floor(level));
  const minX = px * scale;
  const minZ = pz * scale;
  return minX >= 0 && minZ >= 0 && minX + scale <= worldPagesX && minZ + scale <= worldPagesZ;
}

export function createStreamingClodRootController(deps: StreamingClodRootControllerDeps): StreamingClodRootController {
  const pageSize = deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size;
  const worldPagesX = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  const worldPagesZ = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  const buildBudget = resolveBudget(deps.buildBudgetPagesPerFrame, DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME);
  const applyBudget = resolveBudget(deps.applyBudgetPagesPerFrame, DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME);
  const maxInflightBatches = Math.max(1, resolveBudget(deps.maxInflightBatches, DEFAULT_MAX_INFLIGHT_BATCHES));
  const maxCachedPages = Math.max(1, Math.floor(deps.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES));
  const evictDistanceMultiplier = Math.max(1, deps.evictDistanceMultiplier ?? DEFAULT_EVICT_DISTANCE_MULTIPLIER);
  const maxRootLevel = resolveStreamingClodMaxRootLevel(deps.cfg, deps.maxRootLevel);
  const startupRoots = [...deps.roots];
  const startupRootIds = new Set(startupRoots.map((node) => node.id));
  const rootSwitchStableFrames = Math.max(0, Math.floor(deps.rootSwitchStableFrames ?? queryStreamingRootSwitchStableFrames() ?? 0));
  const rootTransitionOptions = resolveRootTransitionOptions(deps.rootTransition);
  const cached = new Map<string, CachedPage>();
  const failed = new Map<string, FailedBuildState>();
  const ready: ReadyPage[] = [];
  const probe: MovementProbeState = { active: false, requestedIds: new Set<string>(), requestedPagesTotal: 0, applyPagesTotal: 0, evictionsTotal: 0, staleDiscardsTotal: 0 };
  const requestedPagesByLevel = zeroLevelArray();
  const appliedPagesByLevel = zeroLevelArray();
  const staleCompletedPagesByLevel = zeroLevelArray();
  const workerBuildSamplesByLevel = Array.from({ length: STREAM_COUNTER_LEVELS }, () => [] as number[]);
  // Worker samples only arrive when a batch completes, so the per-level p95 (a copy +
  // sort of up to 128 samples per level) is cached until the next sample lands.
  let workerBuildP95Cache: number[] | null = null;
  const transitionMsSamples: number[] = [];
  let frame = 0;
  let active = deps.enabled;
  let requiredNow = new Set<string>();
  const inFlight = new Map<number, InflightBatch>();
  const contentRevisions = new Map<string, number>();
  const staleRootIds = new Set<string>();
  let nextBatchId = 1;
  let completedWorkerBuildMs = 0;
  let completedWorkerTransferBytes = 0;
  let completedStaleDiscards = 0;
  let invalidationsTotal = 0;
  let invalidatedPagesTotal = 0;
  let rebuiltAfterInvalidationTotal = 0;
  let workerBuildFailures = 0;
  let workerBuildTimeouts = 0;
  let activeRootIds = new Set<string>();
  // resolveActiveRootIds is O(cached²); only re-resolve when the cached set or eligibility changed
  // (or a switch/transition is in progress) instead of every frame.
  let activeRootSetDirty = true;
  let pendingRootSwitchIds = new Set<string>();
  let pendingRootSwitchKey = "";
  let pendingRootSwitchStableFrames = 0;
  let rootSwitchSuppressedFrames = 0;
  let rootSwitchesTotal = 0;
  let activeRootTransition: ActiveRootTransition | null = null;
  let nextTransitionGroupId = 1;
  let transitionHardSwitchesTotal = 0;
  let transitionCancelledTotal = 0;
  let transitionCappedTotal = 0;
  let transitionCompletedTotal = 0;
  let latest: StreamingClodRootStats = emptyStats(maxRootLevel, maxCachedPages, maxInflightBatches, rootTransitionOptions);

  const beginMovementProbe = (): void => {
    probe.active = true;
    probe.requestedIds.clear();
    probe.requestedPagesTotal = 0;
    probe.applyPagesTotal = 0;
    probe.evictionsTotal = 0;
    probe.staleDiscardsTotal = 0;
    resetStreamingCounterMirrors();
  };
  registerGlobalStreamProbe(beginMovementProbe);

  const cacheHorizonContains = (centerX: number, centerZ: number, center: THREE.Vector3, radiusM: number): boolean =>
    Math.hypot(center.x - centerX, center.z - centerZ) <= Math.max(0, radiusM) * evictDistanceMultiplier;

  const pageCenter = (node: ClodPageNode): { centerX: number; centerZ: number } => ({
    centerX: (node.footprint.minX + node.footprint.maxX) / 2,
    centerZ: (node.footprint.minZ + node.footprint.maxZ) / 2,
  });

  const clearNodeTransition = (id: string): void => {
    const node = cached.get(id)?.node;
    if (node?.rootTransition) delete node.rootTransition;
  };

  const clearAllRootTransitions = (): void => {
    for (const id of cached.keys()) clearNodeTransition(id);
  };

  const removeRoot = (id: string): void => {
    clearNodeTransition(id);
    for (let i = deps.roots.length - 1; i >= 0; i--) if (deps.roots[i]?.id === id) deps.roots.splice(i, 1);
    for (let i = deps.allNodes.length - 1; i >= 0; i--) if (deps.allNodes[i]?.id === id) deps.allNodes.splice(i, 1);
  };

  const cacheNode = (node: ClodPageNode, activeEligible: boolean): boolean => {
    if (staleRootIds.has(node.id)) rebuiltAfterInvalidationTotal++;
    staleRootIds.delete(node.id);
    const existing = cached.get(node.id);
    const { centerX, centerZ } = pageCenter(node);
    if (existing) {
      existing.node = node;
      existing.centerX = centerX;
      existing.centerZ = centerZ;
      existing.lastTouchFrame = frame;
      if (activeEligible && !existing.activeEligible) {
        existing.activeEligible = true;
        activeRootSetDirty = true;
      }
      return false;
    }
    deps.allNodes.push(node);
    cached.set(node.id, { node, centerX, centerZ, lastTouchFrame: frame, activeEligible });
    failed.delete(node.id);
    activeRootSetDirty = true;
    return true;
  };

  const resolveActiveRootIds = (): Set<string> => {
    const eligibleKeys = [...cached.entries()].filter(([, entry]) => entry.activeEligible).map(([key]) => key);
    const activeIds: string[] = [];
    const sortedKeys = eligibleKeys.sort((a, b) => {
      const pageA = parseStreamingClodPageKey(a);
      const pageB = parseStreamingClodPageKey(b);
      if (pageA.level !== pageB.level) return pageB.level - pageA.level;
      return a.localeCompare(b);
    });
    for (const key of sortedKeys) {
      if (activeIds.some((activeId) => pageContainsPage(activeId, key))) continue;
      if (pageFullyCoveredByFinerCachedPages(key, eligibleKeys)) continue;
      activeIds.push(key);
    }
    return new Set(activeIds);
  };

  const requiredSafetyIds = (requiredIds: Iterable<string>): Set<string> =>
    new Set([...requiredIds].filter((id) => parseStreamingClodPageKey(id).level === maxRootLevel));

  const rootSetCoversSafety = (rootIds: ReadonlySet<string>): boolean => {
    const safetyIds = requiredSafetyIds(requiredNow);
    if (safetyIds.size === 0) return true;
    for (const safetyId of safetyIds) if (!pageCoveredByActiveRoots(safetyId, rootIds)) return false;
    return true;
  };

  const setRenderableRootIds = (ids: Iterable<string>): void => {
    const streamedIds = new Set(ids);
    for (let i = deps.roots.length - 1; i >= 0; i--) {
      const id = deps.roots[i]?.id;
      if (id !== undefined && (cached.has(id) || startupRootIds.has(id))) deps.roots.splice(i, 1);
    }
    if (!rootSetCoversSafety(streamedIds)) deps.roots.push(...startupRoots);
    for (const id of [...streamedIds].sort()) {
      const node = cached.get(id)?.node;
      if (node) deps.roots.push(node);
    }
  };

  const commitActiveRootIds = (nextActiveRootIds: Set<string>): void => {
    clearAllRootTransitions();
    setRenderableRootIds(nextActiveRootIds);
    activeRootIds = nextActiveRootIds;
    activeRootTransition = null;
    pendingRootSwitchIds = new Set<string>();
    pendingRootSwitchKey = "";
    pendingRootSwitchStableFrames = 0;
    rootSwitchesTotal++;
  };

  const transitionProgress = (transition: ActiveRootTransition): number =>
    Math.max(0, Math.min(1, (frame - transition.startedFrame) / transition.durationFrames));

  const transitionRenderableRootIds = (transition: ActiveRootTransition): Set<string> =>
    new Set([...transition.fromRootIds, ...transition.toRootIds].filter((id) => cached.has(id)));

  const applyRootTransitionState = (transition: ActiveRootTransition): void => {
    clearAllRootTransitions();
    const progress = transitionProgress(transition);
    for (const id of transitionRenderableRootIds(transition)) {
      const node = cached.get(id)?.node;
      if (!node) continue;
      let mode: StreamedRootRenderState["mode"] = "stable";
      if (transition.fromRootIds.has(id) && !transition.toRootIds.has(id)) mode = "fadeOut";
      else if (transition.toRootIds.has(id) && !transition.fromRootIds.has(id)) mode = "fadeIn";
      node.rootTransition = { mode, progress: mode === "stable" ? 1 : progress, groupId: transition.id, parentHeightMorphReady: false };
    }
    setRenderableRootIds(transitionRenderableRootIds(transition));
  };

  const hardSwitchActiveRootIds = (nextActiveRootIds: Set<string>, reason: "cancel" | "cap" | "safety" | "disabled"): void => {
    if (reason === "cancel") transitionCancelledTotal++;
    if (reason === "cap") transitionCappedTotal++;
    if (reason === "cancel" || reason === "cap" || reason === "safety") transitionHardSwitchesTotal++;
    commitActiveRootIds(nextActiveRootIds);
  };

  const transitionExtraRoots = (fromRootIds: ReadonlySet<string>, toRootIds: ReadonlySet<string>): number =>
    [...fromRootIds].filter((id) => !toRootIds.has(id)).length;

  const startRootTransition = (nextActiveRootIds: Set<string>): void => {
    activeRootTransition = {
      id: nextTransitionGroupId++,
      fromRootIds: new Set(activeRootIds),
      toRootIds: new Set(nextActiveRootIds),
      startedFrame: frame,
      durationFrames: rootTransitionOptions.durationFrames,
    };
    pendingRootSwitchIds = new Set<string>();
    pendingRootSwitchKey = "";
    pendingRootSwitchStableFrames = 0;
    applyRootTransitionState(activeRootTransition);
  };

  const syncActiveRootsInner = (): boolean => {
    if (!activeRootTransition && !activeRootSetDirty && pendingRootSwitchKey === "") return false;
    const nextActiveRootIds = resolveActiveRootIds();
    activeRootSetDirty = false;

    if (activeRootTransition) {
      const currentCoversSafety = rootSetCoversSafety(activeRootIds);
      const nextCoversSafety = rootSetCoversSafety(nextActiveRootIds);
      if (!currentCoversSafety) {
        hardSwitchActiveRootIds(nextCoversSafety ? nextActiveRootIds : new Set(activeRootTransition.toRootIds), "safety");
        return true;
      }
      if (!setEquals(nextActiveRootIds, activeRootTransition.toRootIds)) {
        hardSwitchActiveRootIds(nextActiveRootIds, "cancel");
        return true;
      }
      if (transitionProgress(activeRootTransition) >= 1) {
        transitionCompletedTotal++;
        commitActiveRootIds(new Set(activeRootTransition.toRootIds));
        return true;
      }
      applyRootTransitionState(activeRootTransition);
      return false;
    }

    if (setEquals(nextActiveRootIds, activeRootIds)) {
      pendingRootSwitchIds = new Set<string>();
      pendingRootSwitchKey = "";
      pendingRootSwitchStableFrames = 0;
      return false;
    }

    const currentCoversSafety = activeRootIds.size > 0 && rootSetCoversSafety(activeRootIds);
    const nextCoversSafety = rootSetCoversSafety(nextActiveRootIds);
    const canHoldCurrent = rootSwitchStableFrames > 0 && currentCoversSafety && nextCoversSafety;
    if (canHoldCurrent) {
      const nextKey = stableSetKey(nextActiveRootIds);
      if (nextKey === pendingRootSwitchKey) pendingRootSwitchStableFrames++;
      else {
        pendingRootSwitchKey = nextKey;
        pendingRootSwitchIds = new Set(nextActiveRootIds);
        pendingRootSwitchStableFrames = 1;
      }
      if (pendingRootSwitchStableFrames < rootSwitchStableFrames) {
        rootSwitchSuppressedFrames++;
        return false;
      }
    }

    const targetIds = canHoldCurrent ? new Set(pendingRootSwitchIds) : nextActiveRootIds;
    const canTransition = rootTransitionOptions.enabled
      && rootTransitionOptions.mode === "crossfade"
      && activeRootIds.size > 0
      && currentCoversSafety
      && rootSetCoversSafety(targetIds);
    if (canTransition) {
      if (transitionExtraRoots(activeRootIds, targetIds) > rootTransitionOptions.maxExtraRoots) {
        hardSwitchActiveRootIds(targetIds, "cap");
        return true;
      }
      startRootTransition(targetIds);
      return true;
    }

    hardSwitchActiveRootIds(targetIds, rootTransitionOptions.enabled && !currentCoversSafety ? "safety" : "disabled");
    return true;
  };

  const syncActiveRoots = (): boolean => {
    const startedAt = performance.now();
    try {
      return syncActiveRootsInner();
    } finally {
      if (rootTransitionOptions.enabled) {
        transitionMsSamples.push(Math.max(0, performance.now() - startedAt));
        if (transitionMsSamples.length > TRANSITION_MS_SAMPLE_LIMIT) transitionMsSamples.shift();
      }
    }
  };

  const safetyCoverageRootIds = (safetyIds: ReadonlySet<string>): Set<string> => {
    const protectedIds = new Set<string>();
    for (const activeId of activeRootIds) {
      for (const safetyId of safetyIds) {
        if (activeId === safetyId || pageContainsPage(activeId, safetyId)) {
          protectedIds.add(activeId);
          break;
        }
      }
    }
    if (activeRootTransition) for (const id of transitionRenderableRootIds(activeRootTransition)) protectedIds.add(id);
    return protectedIds;
  };

  const evictCachedPage = (id: string, cachedIds: Set<string>): void => {
    cached.delete(id);
    cachedIds.delete(id);
    activeRootSetDirty = true;
    removeRoot(id);
    activeRootIds.delete(id);
    pendingRootSwitchIds.delete(id);
    if (activeRootTransition?.fromRootIds.has(id) || activeRootTransition?.toRootIds.has(id)) {
      activeRootTransition = null;
      transitionCancelledTotal++;
    }
  };

  const evictionPriority = (id: string, entry: CachedPage, protectedSafetyIds: ReadonlySet<string>, center: THREE.Vector3, radiusM: number): number => {
    if (protectedSafetyIds.has(id)) return 99;
    const page = parseStreamingClodPageKey(id);
    if (page.level < maxRootLevel) return 0;
    return cacheHorizonContains(entry.centerX, entry.centerZ, center, radiusM) ? 2 : 1;
  };

  const evict = (center: THREE.Vector3, radiusM: number): number => {
    let evictions = 0;
    const cachedIds = new Set(cached.keys());
    const protectedSafetyIds = safetyCoverageRootIds(requiredSafetyIds(requiredNow));
    const outsideHorizon = [...cached.entries()]
      .filter(([, entry]) => !cacheHorizonContains(entry.centerX, entry.centerZ, center, radiusM))
      .sort((a, b) => evictionPriority(a[0], a[1], protectedSafetyIds, center, radiusM) - evictionPriority(b[0], b[1], protectedSafetyIds, center, radiusM)
        || a[1].lastTouchFrame - b[1].lastTouchFrame
        || a[0].localeCompare(b[0]));
    for (const [id, entry] of outsideHorizon) {
      if (!cached.has(id)) continue;
      if (cacheHorizonContains(entry.centerX, entry.centerZ, center, radiusM)) continue;
      if (protectedSafetyIds.has(id)) continue;
      if (streamingClodPageHasRequiredNotReadyDescendant(id, requiredNow, cachedIds)) continue;
      evictCachedPage(id, cachedIds);
      evictions++;
    }
    if (cached.size <= maxCachedPages) return evictions;
    const lru = [...cached.entries()].sort((a, b) => evictionPriority(a[0], a[1], protectedSafetyIds, center, radiusM) - evictionPriority(b[0], b[1], protectedSafetyIds, center, radiusM)
      || a[1].lastTouchFrame - b[1].lastTouchFrame
      || a[0].localeCompare(b[0]));
    while (cached.size > maxCachedPages && lru.length > 0) {
      const [id] = lru.shift()!;
      if (!cached.has(id)) continue;
      if (protectedSafetyIds.has(id)) continue;
      if (streamingClodPageHasRequiredNotReadyDescendant(id, requiredNow, cachedIds)) continue;
      evictCachedPage(id, cachedIds);
      evictions++;
    }
    return evictions;
  };

  const buildStillWanted = (id: string): boolean => active && requiredNow.has(id) && (!cached.has(id) || staleRootIds.has(id));
  const buildInFlight = (id: string): boolean => {
    for (const batch of inFlight.values()) if (batch.ids.has(id)) return true;
    return false;
  };
  const currentInflightIds = (): Set<string> => new Set([...inFlight.values()].flatMap((batch) => [...batch.ids]));
  const failedBuildCoolingDown = (id: string): boolean => {
    const failure = failed.get(id);
    return failure !== undefined && frame < failure.retryAfterFrame;
  };

  const missingRequiredAncestor = (id: string): boolean => {
    const page = parseStreamingClodPageKey(id);
    for (let level = page.level + 1; level <= maxRootLevel; level++) {
      const scale = 2 ** (level - page.level);
      const ancestorKey = streamingClodPageKey(Math.floor(page.px / scale), Math.floor(page.pz / scale), level);
      if (requiredNow.has(ancestorKey) && !cached.has(ancestorKey)) return true;
    }
    return false;
  };

  const countStaleCompleted = (nodeId: string): void => {
    incrementLevel(staleCompletedPagesByLevel, parseStreamingClodPageKey(nodeId).level);
  };

  const discardStaleReadyPages = (center: THREE.Vector3, radiusM: number): number => {
    let stale = 0;
    for (let i = ready.length - 1; i >= 0; i--) {
      const entry = ready[i]!;
      if (buildStillWanted(entry.node.id)) continue;
      const { centerX, centerZ } = pageCenter(entry.node);
      ready.splice(i, 1);
      if (cacheHorizonContains(centerX, centerZ, center, radiusM)) {
        cacheNode(entry.node, false);
        if (!entry.staleCounted) countStaleCompleted(entry.node.id);
        continue;
      }
      stale++;
      if (!entry.staleCounted) countStaleCompleted(entry.node.id);
      if (probe.active && probe.requestedIds.has(entry.node.id)) probe.staleDiscardsTotal++;
    }
    return stale;
  };

  const applyReadyPages = (center: THREE.Vector3, radiusM: number): { applied: number; applyMs: number; staleDiscards: number } => {
    const staleDiscards = discardStaleReadyPages(center, radiusM);
    if (applyBudget <= 0 || ready.length === 0) return { applied: 0, applyMs: 0, staleDiscards };
    const appliedNodes: ClodPageNode[] = [];
    const startedAt = performance.now();
    const prepareDeadlineMs = startedAt + Math.max(0, deps.prepareNodeBudgetMs ?? 0);
    while (ready.length > 0 && appliedNodes.length < applyBudget) {
      const entry = ready[0]!;
      const node = entry.node;
      if (!buildStillWanted(node.id)) {
        ready.shift();
        const { centerX, centerZ } = pageCenter(node);
        if (cacheHorizonContains(centerX, centerZ, center, radiusM)) {
          cacheNode(node, false);
          if (!entry.staleCounted) countStaleCompleted(node.id);
        } else {
          if (!entry.staleCounted) countStaleCompleted(node.id);
          if (probe.active && probe.requestedIds.has(node.id)) probe.staleDiscardsTotal++;
        }
        continue;
      }
      if (deps.prepareNodeForApply && !deps.prepareNodeForApply(node, prepareDeadlineMs)) break;
      ready.shift();
      cacheNode(node, true);
      appliedNodes.push(node);
      incrementLevel(appliedPagesByLevel, node.level);
      if (probe.active && probe.requestedIds.has(node.id)) probe.applyPagesTotal++;
    }
    if (appliedNodes.length > 0) deps.onNodesBuilt?.(appliedNodes);
    return { applied: appliedNodes.length, applyMs: performance.now() - startedAt, staleDiscards };
  };

  const rememberWorkerBuildSample = (nodes: readonly ClodPageNode[], buildMs: number): void => {
    if (nodes.length === 0 || !Number.isFinite(buildMs)) return;
    const perNodeMs = Math.max(0, buildMs) / nodes.length;
    for (const node of nodes) {
      const level = Math.max(0, Math.min(STREAM_COUNTER_LEVELS - 1, Math.floor(node.level)));
      const samples = workerBuildSamplesByLevel[level]!;
      samples.push(perNodeMs);
      if (samples.length > WORKER_BUILD_MS_SAMPLE_LIMIT) samples.shift();
    }
    workerBuildP95Cache = null;
  };

  const buildStillQueued = (id: string): boolean => ready.some((entry) => entry.node.id === id);

  const countStreamCoverage = (requiredIds: ReadonlySet<string>) => {
    const safetyIds = [...requiredSafetyIds(requiredIds)];
    let safetyReadyPages = 0;
    let safetyPendingPages = 0;
    let safetyInflightPages = 0;
    let refinementPendingPages = 0;
    let refinementInflightPages = 0;
    let parentCoverageViolations = 0;

    const inflightIds = currentInflightIds();
    const coverageRoots = activeRootTransition ? transitionRenderableRootIds(activeRootTransition) : activeRootIds;
    for (const id of safetyIds) {
      const covered = pageCoveredByActiveRoots(id, coverageRoots);
      if (covered) {
        safetyReadyPages++;
        continue;
      }
      parentCoverageViolations++;
      if (inflightIds.has(id)) safetyInflightPages++;
      else safetyPendingPages++;
    }

    for (const id of requiredIds) {
      if (parseStreamingClodPageKey(id).level === maxRootLevel || cached.has(id)) continue;
      if (inflightIds.has(id)) refinementInflightPages++;
      else refinementPendingPages++;
    }

    return { safetyRequiredPages: safetyIds.length, safetyCacheCapacityOk: safetyIds.length <= maxCachedPages ? 1 : 0, safetyReadyPages, safetyPendingPages, safetyInflightPages, refinementPendingPages, refinementInflightPages, parentCoverageViolations };
  };

  const handleBuildRejection = (batch: InflightBatch, error: unknown): void => {
    inFlight.delete(batch.id);
    workerBuildFailures++;
    for (const id of batch.ids) {
      const previous = failed.get(id);
      const attempts = (previous?.attempts ?? 0) + 1;
      failed.set(id, { attempts, retryAfterFrame: frame + retryCooldownFrames(attempts) });
    }
    console.warn(`[clod-stream] worker failed to build ${batch.ids.size} streamed root page(s)`, error);
  };

  const dispatchBuild = (coords: readonly PageCoord[]): number => {
    if (!deps.buildPages || coords.length === 0 || inFlight.size >= maxInflightBatches) return 0;
    const coordsById = new Map(coords.map((coord) => [streamingClodPageKey(coord.px, coord.pz, coordLevel(coord)), coord]));
    const batch: InflightBatch = {
      id: nextBatchId++,
      ids: new Set(coordsById.keys()),
      coordsById,
      startMs: performance.now(),
      revisionById: new Map([...coordsById.keys()].map((id) => [id, contentRevisions.get(id) ?? 0])),
    };
    inFlight.set(batch.id, batch);
    for (const coord of coords) incrementLevel(requestedPagesByLevel, coordLevel(coord));
    if (probe.active) {
      for (const id of batch.ids) probe.requestedIds.add(id);
      probe.requestedPagesTotal += batch.ids.size;
    }
    let result: Promise<StreamingClodRootBuildResult>;
    try {
      result = deps.buildPages(coords);
    } catch (error) {
      handleBuildRejection(batch, error);
      return batch.ids.size;
    }
    void result.then((built) => {
      inFlight.delete(batch.id);
      const buildMs = Number.isFinite(built.buildMs) ? Math.max(0, built.buildMs) : 0;
      completedWorkerBuildMs += buildMs;
      completedWorkerTransferBytes += Number.isFinite(built.transferBytes) ? Math.max(0, built.transferBytes ?? 0) : 0;
      rememberWorkerBuildSample(built.nodes, buildMs);
      for (const node of built.nodes) {
        if ((batch.revisionById.get(node.id) ?? 0) !== (contentRevisions.get(node.id) ?? 0)) {
          countStaleCompleted(node.id);
          completedStaleDiscards++;
          continue;
        }
        if (buildStillWanted(node.id)) ready.push({ node, staleCounted: false });
        else {
          ready.push({ node, staleCounted: true });
          countStaleCompleted(node.id);
        }
      }
    }).catch((error) => handleBuildRejection(batch, error));
    return batch.ids.size;
  };

  const safetyFirstCandidates = (required: readonly PageCoord[], coverage: ReturnType<typeof countStreamCoverage>): readonly PageCoord[] => {
    if (coverage.safetyPendingPages > 0) return required.filter((coord) => coordLevel(coord) === maxRootLevel);
    if (coverage.safetyInflightPages > 0) return [];
    return required;
  };

  const scheduleBuilds = (required: readonly PageCoord[], coverage: ReturnType<typeof countStreamCoverage>): { scheduled: number; cost: number; waitingOnTiles: number } => {
    if (!deps.buildPages || buildBudget <= 0) return { scheduled: 0, cost: 0, waitingOnTiles: 0 };
    let scheduled = 0;
    let scheduledCost = 0;
    let waitingOnTiles = 0;
    const scheduledIds = new Set<string>();
    const candidates = safetyFirstCandidates(required, coverage);
    while (inFlight.size < maxInflightBatches) {
      const batch: PageCoord[] = [];
      let currentCost = 0;
      for (const coord of candidates) {
        const id = streamingClodPageKey(coord.px, coord.pz, coordLevel(coord));
        if (scheduledIds.has(id) || (cached.has(id) && !staleRootIds.has(id)) || buildInFlight(id) || missingRequiredAncestor(id) || failedBuildCoolingDown(id) || buildStillQueued(id)) continue;
        if (deps.canBuildPage && !deps.canBuildPage(coord)) {
          waitingOnTiles++;
          continue;
        }
        const pageCost = pageBudgetCost(coordLevel(coord));
        if (batch.length > 0 && currentCost + pageCost > buildBudget) break;
        batch.push(coord);
        scheduledIds.add(id);
        currentCost += pageCost;
      }
      if (batch.length === 0) break;
      const batchScheduled = dispatchBuild(batch);
      if (batchScheduled === 0) break;
      scheduled += batchScheduled;
      scheduledCost += currentCost;
    }
    return { scheduled, cost: scheduledCost, waitingOnTiles };
  };

  const transitionSnapshot = () => {
    if (!activeRootTransition) return { activeGroups: 0, activeRoots: 0, fadeIn: 0, fadeOut: 0, drawOverhead: 0, progressMin: 0, progressMax: 0 };
    const ids = transitionRenderableRootIds(activeRootTransition);
    let fadeIn = 0;
    let fadeOut = 0;
    for (const id of ids) {
      const mode = cached.get(id)?.node.rootTransition?.mode;
      if (mode === "fadeIn") fadeIn++;
      if (mode === "fadeOut") fadeOut++;
    }
    const progress = transitionProgress(activeRootTransition);
    return { activeGroups: 1, activeRoots: fadeIn + fadeOut, fadeIn, fadeOut, drawOverhead: fadeOut, progressMin: progress, progressMax: progress };
  };

  const currentReadyPageIdSet = (): Set<string> => {
    const ids = new Set(activeRootIds);
    if (activeRootTransition) for (const id of transitionRenderableRootIds(activeRootTransition)) ids.add(id);
    return ids;
  };
  const currentReadyPageKeys = (): string[] => [...currentReadyPageIdSet()].sort();

  return {
    update(center, radiusM) {
      frame++;
      active = deps.enabled;
      if (!active) {
        requiredNow = new Set();
        ready.length = 0;
        inFlight.clear();
        activeRootIds = new Set();
        activeRootSetDirty = true;
        pendingRootSwitchIds = new Set();
        pendingRootSwitchKey = "";
        pendingRootSwitchStableFrames = 0;
        activeRootTransition = null;
        clearAllRootTransitions();
        latest = emptyStats(maxRootLevel, maxCachedPages, maxInflightBatches, rootTransitionOptions);
        mirrorStreamingProbeCounters(latest);
        return latest;
      }
      const required = streamingClodRequiredPageCoords(center, radiusM, pageSize, maxRootLevel)
        .filter((coord) => !pageInsideFiniteStartupWorld(coord.px, coord.pz, worldPagesX, worldPagesZ, coordLevel(coord)));
      const requiredIds = new Set(required.map((coord) => streamingClodPageKey(coord.px, coord.pz, coordLevel(coord))));
      requiredNow = requiredIds;
      for (const coord of required) {
        const existing = cached.get(streamingClodPageKey(coord.px, coord.pz, coordLevel(coord)));
        if (existing) {
          existing.lastTouchFrame = frame;
          if (!existing.activeEligible) {
            existing.activeEligible = true;
            activeRootSetDirty = true;
          }
        }
      }
      const evictions = evict(center, radiusM);
      if (probe.active) probe.evictionsTotal += evictions;
      const workerBuildMs = completedWorkerBuildMs;
      const workerTransferBytes = completedWorkerTransferBytes;
      let staleDiscards = completedStaleDiscards;
      completedWorkerBuildMs = 0;
      completedWorkerTransferBytes = 0;
      completedStaleDiscards = 0;
      const applied = applyReadyPages(center, radiusM);
      staleDiscards += applied.staleDiscards;
      const activeRootsChanged = syncActiveRoots();
      const coverageBeforeSchedule = countStreamCoverage(requiredIds);
      const { scheduled: scheduledPagesThisFrame, cost: scheduledBudgetCost, waitingOnTiles } = scheduleBuilds(required, coverageBeforeSchedule);
      if (evictions > 0 || activeRootsChanged || applied.applied > 0) deps.onRootsChanged?.();
      let inflightMs = 0;
      for (const batch of inFlight.values()) {
        const batchInflightMs = performance.now() - batch.startMs;
        inflightMs = Math.max(inflightMs, batchInflightMs);
        if (batchInflightMs > 60000 && !batch.timedOut) {
          batch.timedOut = true;
          workerBuildTimeouts++;
        }
      }
      const inflightPageLevels = [...inFlight.values()].flatMap((batch) => [...batch.coordsById.values()].map((coord) => coordLevel(coord)));
      const coverage = countStreamCoverage(requiredIds);
      const refinedReadyIds = new Set(
        [...currentReadyPageIdSet()].filter((id) => parseStreamingClodPageKey(id).level === 0),
      );
      const transition = transitionSnapshot();
      latest = {
        requiredPages: requiredIds.size,
        cachedPages: cached.size,
        builtThisFrame: applied.applied,
        failedPages: [...requiredIds].filter((id) => failed.has(id)).length,
        evictions,
        buildMs: workerBuildMs,
        pendingPages: [...inFlight.values()].reduce((sum, batch) => sum + batch.ids.size, 0),
        waitingOnTiles,
        buildBudget,
        inflightBatches: inFlight.size,
        maxInflightBatches,
        applyQueuePages: ready.length,
        activeRootPages: activeRootTransition ? transitionRenderableRootIds(activeRootTransition).size : activeRootIds.size,
        maxCachedPages,
        safetyCacheCapacityOk: coverage.safetyCacheCapacityOk,
        safetyRequiredPages: coverage.safetyRequiredPages,
        safetyReadyPages: coverage.safetyReadyPages,
        safetyPendingPages: coverage.safetyPendingPages,
        safetyInflightPages: coverage.safetyInflightPages,
        refinementPendingPages: coverage.refinementPendingPages,
        refinementInflightPages: coverage.refinementInflightPages,
        parentCoverageViolations: coverage.parentCoverageViolations,
        readyPages: activeRootTransition ? transitionRenderableRootIds(activeRootTransition).size : activeRootIds.size,
        readyFrontierM: streamingReadyFrontierM(center, radiusM, pageSize, required, refinedReadyIds),
        scheduledPagesThisFrame,
        applyPagesThisFrame: applied.applied,
        applyMs: applied.applyMs,
        staleDiscards,
        workerBuildMs,
        workerTransferBytes,
        probeActive: probe.active ? 1 : 0,
        probeRequestedPagesTotal: probe.requestedPagesTotal,
        probeApplyPagesTotal: probe.applyPagesTotal,
        probeEvictionsTotal: probe.evictionsTotal,
        probeStaleDiscardsTotal: probe.staleDiscardsTotal,
        outOfWorldEditsSupported: OUT_OF_WORLD_EDITS_SUPPORTED,
        invalidationsTotal,
        invalidatedPagesTotal,
        rebuiltAfterInvalidationTotal,
        inflightMs,
        inflightPageLevels,
        scheduledBudgetCost,
        workerBuildFailures,
        workerBuildTimeouts,
        maxRootLevel,
        rootSwitchStableFrames: pendingRootSwitchStableFrames,
        rootSwitchPendingPages: pendingRootSwitchIds.size,
        rootSwitchSuppressedFrames,
        rootSwitchesTotal,
        requestedPagesByLevel: [...requestedPagesByLevel],
        appliedPagesByLevel: [...appliedPagesByLevel],
        staleCompletedPagesByLevel: [...staleCompletedPagesByLevel],
        workerBuildMsP95ByLevel: [...(workerBuildP95Cache ??= workerP95(workerBuildSamplesByLevel))],
        transitionEnabled: rootTransitionOptions.enabled ? 1 : 0,
        transitionActiveGroups: transition.activeGroups,
        transitionActiveRoots: transition.activeRoots,
        transitionFadeInRoots: transition.fadeIn,
        transitionFadeOutRoots: transition.fadeOut,
        transitionHardSwitchesTotal,
        transitionCancelledTotal,
        transitionCappedTotal,
        transitionCompletedTotal,
        transitionDrawOverheadRoots: transition.drawOverhead,
        transitionDurationFrames: rootTransitionOptions.durationFrames,
        transitionProgressMin: transition.progressMin,
        transitionProgressMax: transition.progressMax,
        transitionMsP95: percentile95(transitionMsSamples),
      };
      mirrorStreamingProbeCounters(latest);
      return latest;
    },
    stats() { return latest; },
    readyPageKeys() { return currentReadyPageKeys(); },
    cachedPageKeys() { return [...cached.keys()].sort(); },
    refinedReadyPageKeys() {
      return currentReadyPageKeys().filter((key) => parseStreamingClodPageKey(key).level === 0);
    },
    invalidateBounds(bounds) {
      invalidationsTotal++;
      for (let level = 0; level <= maxRootLevel; level++) {
        const span = pageSize * (2 ** level);
        const minPx = Math.floor(bounds.minX / span);
        const maxPx = Math.floor(bounds.maxX / span);
        const minPz = Math.floor(bounds.minZ / span);
        const maxPz = Math.floor(bounds.maxZ / span);
        for (let pz = minPz; pz <= maxPz; pz++) {
          for (let px = minPx; px <= maxPx; px++) {
            const id = streamingClodPageKey(px, pz, level);
            invalidatedPagesTotal++;
            contentRevisions.set(id, (contentRevisions.get(id) ?? 0) + 1);
            staleRootIds.add(id);
            failed.delete(id);
            for (let i = ready.length - 1; i >= 0; i--) {
              if (ready[i]!.node.id === id) ready.splice(i, 1);
            }
          }
        }
      }
    },
    beginMovementProbe,
  };
}

function emptyStats(
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
