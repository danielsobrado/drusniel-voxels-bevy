import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import {
  coordLevel,
  pageContainsPage,
  pageCoveredByActiveRoots,
  pageFullyCoveredByFinerCachedPages,
  pageInsideFiniteStartupWorld,
  parseStreamingClodPageKey,
  streamingClodPageHasRequiredNotReadyDescendant,
  streamingClodPageKey,
  streamingClodRequiredPageCoords,
  streamingReadyFrontierM,
  type PageCoord,
} from "./streaming_clod_page_keys.js";
import {
  DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME,
  DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME,
  DEFAULT_MAX_CACHED_PAGES,
  DEFAULT_MAX_INFLIGHT_BATCHES,
  pageBudgetCost,
  queryStreamingRootSwitchStableFrames,
  resolveBudget,
  resolveRootTransitionOptions,
  resolveStreamingClodMaxRootLevel,
  type StreamingClodRootBudgetOptions,
  type StreamingClodRootBudgets,
  type StreamingClodRootTransitionOptions,
} from "./streaming_clod_root_budgets.js";
import {
  emptyStats,
  incrementLevel,
  mirrorStreamingProbeCounters,
  OUT_OF_WORLD_EDITS_SUPPORTED,
  percentile95,
  registerGlobalStreamProbe,
  resetStreamingCounterMirrors,
  STREAM_COUNTER_LEVELS,
  workerP95,
  zeroLevelArray,
  type StreamingClodRootStats,
} from "./streaming_clod_root_counters.js";
import {
  createActiveRootTransition,
  setEquals,
  snapshotRootTransition,
  stableSetKey,
  TRANSITION_MS_SAMPLE_LIMIT,
  transitionExtraRoots,
  transitionProgress,
  transitionRenderableRootIds,
  rootTransitionStateForNode,
  type ActiveRootTransition,
} from "./streaming_clod_root_transitions.js";

export {
  pageInsideFiniteStartupWorld,
  parseStreamingClodPageKey,
  sortStreamingClodPageCoordsForLoad,
  streamingClodPageHasRequiredNotReadyDescendant,
  streamingClodPageKey,
  streamingClodRequiredPageCoords,
  streamingReadyFrontierM,
  type PageCoord,
} from "./streaming_clod_page_keys.js";

export {
  pageBudgetCost,
  resolveStreamingClodMaxRootLevel,
  type StreamingClodRootBudgetOptions,
  type StreamingClodRootBudgets,
  type StreamingClodRootTransitionOptions,
} from "./streaming_clod_root_budgets.js";

export type { StreamingClodRootStats } from "./streaming_clod_root_counters.js";

export interface StreamingClodRootController {
  update(center: THREE.Vector3, radiusM: number): StreamingClodRootStats;
  stats(): StreamingClodRootStats;
  readyPageKeys(): readonly string[];
  cachedPageKeys(): readonly string[];
  refinedReadyPageKeys(): readonly string[];
  beginMovementProbe(): void;
  invalidateBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void;
  streamBudgets(): StreamingClodRootBudgets;
  setStreamBudgets(options: StreamingClodRootBudgetOptions): StreamingClodRootBudgets;
}

export interface StreamingClodRootBuildResult {
  nodes: readonly ClodPageNode[];
  buildMs: number;
  transferBytes?: number;
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

const DEFAULT_EVICT_DISTANCE_MULTIPLIER = 2.5;
const WORKER_BUILD_MS_SAMPLE_LIMIT = 128;
const BUILD_RETRY_BASE_COOLDOWN_FRAMES = 60;
const BUILD_RETRY_MAX_COOLDOWN_FRAMES = 600;

function retryCooldownFrames(attempts: number): number {
  const multiplier = Math.min(8, 2 ** Math.max(0, attempts - 1));
  return Math.min(BUILD_RETRY_MAX_COOLDOWN_FRAMES, BUILD_RETRY_BASE_COOLDOWN_FRAMES * multiplier);
}

export function createStreamingClodRootController(deps: StreamingClodRootControllerDeps): StreamingClodRootController {
  const pageSize = deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size;
  const worldPagesX = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  const worldPagesZ = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  let buildBudget = resolveBudget(deps.buildBudgetPagesPerFrame, DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME);
  let applyBudget = resolveBudget(deps.applyBudgetPagesPerFrame, DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME);
  let maxInflightBatches = Math.max(1, resolveBudget(deps.maxInflightBatches, DEFAULT_MAX_INFLIGHT_BATCHES));
  let maxCachedPages = Math.max(1, Math.floor(deps.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES));
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

  const transitionProgressAtFrame = (transition: ActiveRootTransition): number =>
    transitionProgress(transition, frame);

  const transitionResidentIds = (transition: ActiveRootTransition): Set<string> =>
    transitionRenderableRootIds(transition, (id) => cached.has(id));

  const applyRootTransitionState = (transition: ActiveRootTransition): void => {
    clearAllRootTransitions();
    const progress = transitionProgressAtFrame(transition);
    for (const id of transitionResidentIds(transition)) {
      const node = cached.get(id)?.node;
      if (!node) continue;
      node.rootTransition = rootTransitionStateForNode(transition, id, progress);
    }
    setRenderableRootIds(transitionResidentIds(transition));
  };

  const hardSwitchActiveRootIds = (nextActiveRootIds: Set<string>, reason: "cancel" | "cap" | "safety" | "disabled"): void => {
    if (reason === "cancel") transitionCancelledTotal++;
    if (reason === "cap") transitionCappedTotal++;
    if (reason === "cancel" || reason === "cap" || reason === "safety") transitionHardSwitchesTotal++;
    commitActiveRootIds(nextActiveRootIds);
  };

  const startRootTransition = (nextActiveRootIds: Set<string>): void => {
    activeRootTransition = createActiveRootTransition(
      activeRootIds,
      nextActiveRootIds,
      frame,
      rootTransitionOptions.durationFrames,
      nextTransitionGroupId++,
    );
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
      if (transitionProgressAtFrame(activeRootTransition) >= 1) {
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
    if (activeRootTransition) for (const id of transitionResidentIds(activeRootTransition)) protectedIds.add(id);
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
      // Count every apply while the movement probe is active. Filtering to
      // probe.requestedIds missed leftover pre-route ready-queue drains and
      // under-counted dense routes that reuse a larger resident cache.
      if (probe.active) probe.applyPagesTotal++;
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
    const coverageRoots = activeRootTransition ? transitionResidentIds(activeRootTransition) : activeRootIds;
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

  const transitionSnapshot = () =>
    snapshotRootTransition(
      activeRootTransition,
      frame,
      (id) => cached.has(id),
      (id) => cached.get(id)?.node.rootTransition?.mode,
    );

  const currentReadyPageIdSet = (): Set<string> => {
    const ids = new Set(activeRootIds);
    if (activeRootTransition) for (const id of transitionResidentIds(activeRootTransition)) ids.add(id);
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
        activeRootPages: activeRootTransition ? transitionResidentIds(activeRootTransition).size : activeRootIds.size,
        maxCachedPages,
        safetyCacheCapacityOk: coverage.safetyCacheCapacityOk,
        safetyRequiredPages: coverage.safetyRequiredPages,
        safetyReadyPages: coverage.safetyReadyPages,
        safetyPendingPages: coverage.safetyPendingPages,
        safetyInflightPages: coverage.safetyInflightPages,
        refinementPendingPages: coverage.refinementPendingPages,
        refinementInflightPages: coverage.refinementInflightPages,
        parentCoverageViolations: coverage.parentCoverageViolations,
        readyPages: activeRootTransition ? transitionResidentIds(activeRootTransition).size : activeRootIds.size,
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
    streamBudgets() {
      return {
        buildBudgetPagesPerFrame: buildBudget,
        applyBudgetPagesPerFrame: applyBudget,
        maxInflightBatches,
        maxCachedPages,
      };
    },
    setStreamBudgets(options) {
      const previous = {
        buildBudgetPagesPerFrame: buildBudget,
        applyBudgetPagesPerFrame: applyBudget,
        maxInflightBatches,
        maxCachedPages,
      };
      if (options.buildBudgetPagesPerFrame !== undefined) {
        buildBudget = resolveBudget(options.buildBudgetPagesPerFrame, buildBudget);
      }
      if (options.applyBudgetPagesPerFrame !== undefined) {
        applyBudget = resolveBudget(options.applyBudgetPagesPerFrame, applyBudget);
      }
      if (options.maxInflightBatches !== undefined) {
        maxInflightBatches = Math.max(1, resolveBudget(options.maxInflightBatches, maxInflightBatches));
      }
      if (options.maxCachedPages !== undefined) {
        maxCachedPages = Math.max(1, Math.floor(options.maxCachedPages));
      }
      latest = { ...latest, buildBudget, maxInflightBatches, maxCachedPages };
      return previous;
    },
  };
}
