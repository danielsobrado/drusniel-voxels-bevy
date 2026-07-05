import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";

export interface StreamingClodRootStats {
  requiredPages: number;
  cachedPages: number;
  builtThisFrame: number;
  failedPages: number;
  evictions: number;
  buildMs: number;
  pendingPages: number;
  buildBudget: number;
  inflightBatches: number;
  readyPages: number;
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
  inflightMs: number;
  inflightPageLevels: number[];
  scheduledBudgetCost: number;
  workerBuildFailures: number;
  workerBuildTimeouts: number;
  maxRootLevel: number;
  requestedPagesByLevel: number[];
  appliedPagesByLevel: number[];
  staleCompletedPagesByLevel: number[];
  workerBuildMsP95ByLevel: number[];
}

export interface StreamingClodRootController {
  update(center: THREE.Vector3, radiusM: number): StreamingClodRootStats;
  stats(): StreamingClodRootStats;
  readyPageKeys(): readonly string[];
  beginMovementProbe(): void;
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
  buildPages: ((coords: readonly PageCoord[]) => Promise<StreamingClodRootBuildResult>) | null;
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
  ids: Set<string>;
  coordsById: Map<string, PageCoord>;
  startMs: number;
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

const DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_MAX_CACHED_PAGES = 128;
const DEFAULT_EVICT_DISTANCE_MULTIPLIER = 2.5;
const DEFAULT_STREAM_MAX_ROOT_LEVEL = 1;
const STREAM_COUNTER_LEVELS = 4;
const WORKER_BUILD_MS_SAMPLE_LIMIT = 128;
const BUILD_RETRY_BASE_COOLDOWN_FRAMES = 60;
const BUILD_RETRY_MAX_COOLDOWN_FRAMES = 600;
const OUT_OF_WORLD_EDITS_SUPPORTED = 0;

function resolveBudget(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

function retryCooldownFrames(attempts: number): number {
  const multiplier = Math.min(8, 2 ** Math.max(0, attempts - 1));
  return Math.min(BUILD_RETRY_MAX_COOLDOWN_FRAMES, BUILD_RETRY_BASE_COOLDOWN_FRAMES * multiplier);
}

function queryStreamingClodMaxRootLevel(): number | undefined {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  const search = maybeWindow?.location?.search;
  if (!search) return undefined;
  const parsed = Number(new URLSearchParams(search).get("liveClodRootMaxLevel"));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
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
  return {
    minX: page.px * scale,
    minZ: page.pz * scale,
    maxX: (page.px + 1) * scale,
    maxZ: (page.pz + 1) * scale,
  };
}

function pageContainsPage(ancestorKey: string, descendantKey: string): boolean {
  const ancestor = parseStreamingClodPageKey(ancestorKey);
  const descendant = parseStreamingClodPageKey(descendantKey);
  if (ancestor.level <= descendant.level) return false;
  const ancestorBounds = pageLevel0Bounds(ancestor);
  const descendantBounds = pageLevel0Bounds(descendant);
  return (
    descendantBounds.minX >= ancestorBounds.minX &&
    descendantBounds.minZ >= ancestorBounds.minZ &&
    descendantBounds.maxX <= ancestorBounds.maxX &&
    descendantBounds.maxZ <= ancestorBounds.maxZ
  );
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

function writeStreamingProbeCounters(stats: StreamingClodRootStats): void {
  const counters = clodCounters();
  if (!counters) return;
  counters["live_clod_stream_scheduled_pages_this_frame"] = stats.scheduledPagesThisFrame;
  counters["live_clod_stream_probe_active"] = stats.probeActive;
  counters["live_clod_stream_probe_requested_pages_total"] = stats.probeRequestedPagesTotal;
  counters["live_clod_stream_probe_apply_pages_total"] = stats.probeApplyPagesTotal;
  counters["live_clod_stream_probe_evictions_total"] = stats.probeEvictionsTotal;
  counters["live_clod_stream_probe_stale_discards_total"] = stats.probeStaleDiscardsTotal;
  counters["live_clod_stream_out_of_world_edits_supported"] = stats.outOfWorldEditsSupported;
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
  globalThis.queueMicrotask?.(() => writeStreamingProbeCounters(stats));
}

function resetStreamingCounterMirrors(): void {
  const counters = clodCounters();
  if (!counters) return;
  counters["live_clod_stream_built_total"] = 0;
  counters["live_clod_stream_apply_pages_total"] = 0;
  counters["live_clod_stream_evictions_total"] = 0;
  counters["live_clod_stream_stale_discards_total"] = 0;
  counters["live_clod_stream_probe_active"] = 1;
  counters["live_clod_stream_probe_requested_pages_total"] = 0;
  counters["live_clod_stream_probe_apply_pages_total"] = 0;
  counters["live_clod_stream_probe_evictions_total"] = 0;
  counters["live_clod_stream_probe_stale_discards_total"] = 0;
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

export function parseStreamingClodPageKey(key: string): { level: number; px: number; pz: number } {
  const [levelText, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(level) || !Number.isInteger(px) || !Number.isInteger(pz)) throw new Error(`Invalid streaming CLOD page key ${key}`);
  return { level, px, pz };
}

export function streamingClodPageHasRequiredNotReadyDescendant(
  pageKey: string,
  required: Iterable<string>,
  cached: ReadonlySet<string>,
): boolean {
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
        coordsById.set(key, {
          px: levelPx,
          pz: levelPz,
          level,
          centerX: (levelPx + 0.5) * levelPageSize,
          centerZ: (levelPz + 0.5) * levelPageSize,
        });
      }
    }
  }

  return sortStreamingClodPageCoordsForLoad([...coordsById.values()], center);
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
  const maxCachedPages = Math.max(1, Math.floor(deps.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES));
  const evictDistanceMultiplier = Math.max(1, deps.evictDistanceMultiplier ?? DEFAULT_EVICT_DISTANCE_MULTIPLIER);
  const maxRootLevel = resolveStreamingClodMaxRootLevel(deps.cfg, deps.maxRootLevel);
  const cached = new Map<string, CachedPage>();
  const failed = new Map<string, FailedBuildState>();
  const ready: ReadyPage[] = [];
  const probe: MovementProbeState = { active: false, requestedIds: new Set<string>(), requestedPagesTotal: 0, applyPagesTotal: 0, evictionsTotal: 0, staleDiscardsTotal: 0 };
  const requestedPagesByLevel = zeroLevelArray();
  const appliedPagesByLevel = zeroLevelArray();
  const staleCompletedPagesByLevel = zeroLevelArray();
  const workerBuildSamplesByLevel = Array.from({ length: STREAM_COUNTER_LEVELS }, () => [] as number[]);
  let frame = 0;
  let active = deps.enabled;
  let requiredNow = new Set<string>();
  let inFlight: InflightBatch | null = null;
  let completedWorkerBuildMs = 0;
  let completedWorkerTransferBytes = 0;
  let completedStaleDiscards = 0;
  let workerBuildFailures = 0;
  let workerBuildTimeouts = 0;
  let activeRootIds = new Set<string>();
  let latest: StreamingClodRootStats = emptyStats(maxRootLevel);

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

  const removeRoot = (id: string): void => {
    for (let i = deps.roots.length - 1; i >= 0; i--) if (deps.roots[i]?.id === id) deps.roots.splice(i, 1);
    for (let i = deps.allNodes.length - 1; i >= 0; i--) if (deps.allNodes[i]?.id === id) deps.allNodes.splice(i, 1);
  };

  const cacheNode = (node: ClodPageNode, activeEligible: boolean): boolean => {
    const existing = cached.get(node.id);
    const { centerX, centerZ } = pageCenter(node);
    if (existing) {
      existing.node = node;
      existing.centerX = centerX;
      existing.centerZ = centerZ;
      existing.lastTouchFrame = frame;
      existing.activeEligible = existing.activeEligible || activeEligible;
      return false;
    }
    deps.allNodes.push(node);
    cached.set(node.id, { node, centerX, centerZ, lastTouchFrame: frame, activeEligible });
    failed.delete(node.id);
    return true;
  };

  const resolveActiveRootIds = (): Set<string> => {
    const eligibleKeys = [...cached.entries()]
      .filter(([, entry]) => entry.activeEligible)
      .map(([key]) => key);
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

  const syncActiveRoots = (): boolean => {
    const nextActiveRootIds = resolveActiveRootIds();
    const changed = nextActiveRootIds.size !== activeRootIds.size || [...nextActiveRootIds].some((id) => !activeRootIds.has(id));
    if (!changed) return false;
    for (let i = deps.roots.length - 1; i >= 0; i--) {
      const id = deps.roots[i]?.id;
      if (id !== undefined && cached.has(id)) deps.roots.splice(i, 1);
    }
    for (const id of [...nextActiveRootIds].sort()) {
      const node = cached.get(id)?.node;
      if (node) deps.roots.push(node);
    }
    activeRootIds = nextActiveRootIds;
    return true;
  };

  const evict = (center: THREE.Vector3, radiusM: number): number => {
    let evictions = 0;
    const cachedIds = new Set(cached.keys());
    for (const [id, entry] of [...cached.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (cacheHorizonContains(entry.centerX, entry.centerZ, center, radiusM)) continue;
      if (streamingClodPageHasRequiredNotReadyDescendant(id, requiredNow, cachedIds)) continue;
      cached.delete(id);
      cachedIds.delete(id);
      removeRoot(id);
      activeRootIds.delete(id);
      evictions++;
    }
    if (cached.size <= maxCachedPages) return evictions;
    const lru = [...cached.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame || a[0].localeCompare(b[0]));
    while (cached.size > maxCachedPages && lru.length > 0) {
      const [id] = lru.shift()!;
      if (streamingClodPageHasRequiredNotReadyDescendant(id, requiredNow, cachedIds)) continue;
      cached.delete(id);
      cachedIds.delete(id);
      removeRoot(id);
      activeRootIds.delete(id);
      evictions++;
    }
    return evictions;
  };

  const buildStillWanted = (id: string): boolean => active && requiredNow.has(id) && !cached.has(id);
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
    while (ready.length > 0 && appliedNodes.length < applyBudget) {
      const entry = ready.shift()!;
      const node = entry.node;
      if (!buildStillWanted(node.id)) {
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
  };

  const buildStillQueued = (id: string): boolean => ready.some((entry) => entry.node.id === id);

  const handleBuildRejection = (batch: InflightBatch, error: unknown): void => {
    if (inFlight === batch) inFlight = null;
    workerBuildFailures++;
    for (const id of batch.ids) {
      const previous = failed.get(id);
      const attempts = (previous?.attempts ?? 0) + 1;
      failed.set(id, { attempts, retryAfterFrame: frame + retryCooldownFrames(attempts) });
    }
    console.warn(`[clod-stream] worker failed to build ${batch.ids.size} streamed root page(s)`, error);
  };

  const dispatchBuild = (coords: readonly PageCoord[]): number => {
    if (!deps.buildPages || coords.length === 0 || inFlight) return 0;
    const coordsById = new Map(coords.map((coord) => [streamingClodPageKey(coord.px, coord.pz, coordLevel(coord)), coord]));
    const batch: InflightBatch = { ids: new Set(coordsById.keys()), coordsById, startMs: performance.now() };
    inFlight = batch;
    for (const coord of coords) {
      const level = coordLevel(coord);
      console.log(`[clod-stream] Dispatching build for page: L${level}:${coord.px},${coord.pz} (estimated LOD0 subtree size: ${pageBudgetCost(level)})`);
      incrementLevel(requestedPagesByLevel, level);
    }
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
      if (inFlight === batch) inFlight = null;
      const buildMs = Number.isFinite(built.buildMs) ? Math.max(0, built.buildMs) : 0;
      completedWorkerBuildMs += buildMs;
      completedWorkerTransferBytes += Number.isFinite(built.transferBytes) ? Math.max(0, built.transferBytes ?? 0) : 0;
      rememberWorkerBuildSample(built.nodes, buildMs);
      for (const node of built.nodes) {
        if (buildStillWanted(node.id)) ready.push({ node, staleCounted: false });
        else {
          ready.push({ node, staleCounted: true });
          countStaleCompleted(node.id);
        }
      }
    }).catch((error) => handleBuildRejection(batch, error));
    return batch.ids.size;
  };

  const scheduleBuilds = (required: readonly PageCoord[]): { scheduled: number; cost: number } => {
    if (!deps.buildPages || inFlight || buildBudget <= 0) return { scheduled: 0, cost: 0 };
    const batch: PageCoord[] = [];
    let currentCost = 0;
    for (const coord of required) {
      const id = streamingClodPageKey(coord.px, coord.pz, coordLevel(coord));
      if (cached.has(id) || missingRequiredAncestor(id) || failedBuildCoolingDown(id) || buildStillQueued(id)) continue;
      const pageCost = pageBudgetCost(coordLevel(coord));
      if (batch.length > 0 && currentCost + pageCost > buildBudget) break;
      batch.push(coord);
      currentCost += pageCost;
    }
    const scheduled = dispatchBuild(batch);
    return { scheduled, cost: scheduled > 0 ? currentCost : 0 };
  };

  return {
    update(center, radiusM) {
      frame++;
      active = deps.enabled;
      if (!active) {
        requiredNow = new Set();
        ready.length = 0;
        latest = emptyStats(maxRootLevel);
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
          existing.activeEligible = true;
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
      const { scheduled: scheduledPagesThisFrame, cost: scheduledBudgetCost } = scheduleBuilds(required);
      const activeRootsChanged = syncActiveRoots();
      if (evictions > 0 || activeRootsChanged || applied.applied > 0) deps.onRootsChanged?.();
      let inflightMs = 0;
      if (inFlight) {
        inflightMs = performance.now() - inFlight.startMs;
        if (inflightMs > 60000 && !inFlight.timedOut) {
          inFlight.timedOut = true;
          workerBuildTimeouts++;
        }
      }
      const inflightPageLevels = inFlight ? [...inFlight.coordsById.values()].map((coord) => coordLevel(coord)) : [];
      latest = {
        requiredPages: requiredIds.size,
        cachedPages: cached.size,
        builtThisFrame: applied.applied,
        failedPages: [...requiredIds].filter((id) => failed.has(id)).length,
        evictions,
        buildMs: workerBuildMs,
        pendingPages: inFlight?.ids.size ?? 0,
        buildBudget,
        inflightBatches: inFlight ? 1 : 0,
        readyPages: ready.length,
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
        inflightMs,
        inflightPageLevels,
        scheduledBudgetCost,
        workerBuildFailures,
        workerBuildTimeouts,
        maxRootLevel,
        requestedPagesByLevel: [...requestedPagesByLevel],
        appliedPagesByLevel: [...appliedPagesByLevel],
        staleCompletedPagesByLevel: [...staleCompletedPagesByLevel],
        workerBuildMsP95ByLevel: workerP95(workerBuildSamplesByLevel),
      };
      mirrorStreamingProbeCounters(latest);
      return latest;
    },
    stats() { return latest; },
    readyPageKeys() { return [...activeRootIds].sort(); },
    beginMovementProbe,
  };
}

function emptyStats(maxRootLevel = 0): StreamingClodRootStats {
  return {
    requiredPages: 0,
    cachedPages: 0,
    builtThisFrame: 0,
    failedPages: 0,
    evictions: 0,
    buildMs: 0,
    pendingPages: 0,
    buildBudget: DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME,
    inflightBatches: 0,
    readyPages: 0,
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
    inflightMs: 0,
    inflightPageLevels: [],
    scheduledBudgetCost: 0,
    workerBuildFailures: 0,
    workerBuildTimeouts: 0,
    maxRootLevel,
    requestedPagesByLevel: zeroLevelArray(),
    appliedPagesByLevel: zeroLevelArray(),
    staleCompletedPagesByLevel: zeroLevelArray(),
    workerBuildMsP95ByLevel: zeroLevelArray(),
  };
}
