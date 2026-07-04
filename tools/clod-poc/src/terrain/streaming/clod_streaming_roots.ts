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
}

export interface StreamingClodRootController {
  update(center: THREE.Vector3, radiusM: number): StreamingClodRootStats;
  stats(): StreamingClodRootStats;
  beginMovementProbe(): void;
}

export interface PageCoord {
  px: number;
  pz: number;
  centerX: number;
  centerZ: number;
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
  buildPages: ((coords: readonly PageCoord[]) => Promise<StreamingClodRootBuildResult>) | null;
  onNodesBuilt?: (nodes: readonly ClodPageNode[]) => void;
  onRootsChanged?: () => void;
}

interface CachedPage {
  node: ClodPageNode;
  centerX: number;
  centerZ: number;
  lastTouchFrame: number;
}

interface InflightBatch {
  ids: Set<string>;
  coordsById: Map<string, PageCoord>;
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

const DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME = 1;
const DEFAULT_MAX_CACHED_PAGES = 128;
const DEFAULT_EVICT_DISTANCE_MULTIPLIER = 2.5;
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

export function streamingClodPageKey(px: number, pz: number): string {
  return `L0:${px},${pz}`;
}

export function streamingClodRequiredPageCoords(center: THREE.Vector3, radiusM: number, pageSizeM: number): PageCoord[] {
  const radius = Math.max(0, Number.isFinite(radiusM) ? radiusM : 0);
  const pageSize = Math.max(1, Number.isFinite(pageSizeM) ? pageSizeM : 1);
  const minPx = Math.floor((center.x - radius) / pageSize);
  const maxPx = Math.floor((center.x + radius) / pageSize);
  const minPz = Math.floor((center.z - radius) / pageSize);
  const maxPz = Math.floor((center.z + radius) / pageSize);
  const halfDiag = pageSize * Math.SQRT2 * 0.5;
  const coords: PageCoord[] = [];

  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      const centerX = (px + 0.5) * pageSize;
      const centerZ = (pz + 0.5) * pageSize;
      if (Math.hypot(center.x - centerX, center.z - centerZ) <= radius + halfDiag) {
        coords.push({ px, pz, centerX, centerZ });
      }
    }
  }

  return coords.sort((a, b) => {
    const da = Math.hypot(center.x - a.centerX, center.z - a.centerZ);
    const db = Math.hypot(center.x - b.centerX, center.z - b.centerZ);
    return da - db || a.px - b.px || a.pz - b.pz;
  });
}

export function pageInsideFiniteStartupWorld(px: number, pz: number, worldPagesX: number, worldPagesZ: number): boolean {
  return px >= 0 && pz >= 0 && px < worldPagesX && pz < worldPagesZ;
}

export function createStreamingClodRootController(deps: StreamingClodRootControllerDeps): StreamingClodRootController {
  const pageSize = deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size;
  const worldPagesX = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  const worldPagesZ = Math.max(1, Math.ceil(deps.worldCells / pageSize));
  const buildBudget = resolveBudget(deps.buildBudgetPagesPerFrame, DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME);
  const applyBudget = resolveBudget(deps.applyBudgetPagesPerFrame, DEFAULT_APPLY_BUDGET_PAGES_PER_FRAME);
  const maxCachedPages = Math.max(1, Math.floor(deps.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES));
  const evictDistanceMultiplier = Math.max(1, deps.evictDistanceMultiplier ?? DEFAULT_EVICT_DISTANCE_MULTIPLIER);
  const cached = new Map<string, CachedPage>();
  const failed = new Map<string, FailedBuildState>();
  const ready: ClodPageNode[] = [];
  const probe: MovementProbeState = {
    active: false,
    requestedIds: new Set<string>(),
    requestedPagesTotal: 0,
    applyPagesTotal: 0,
    evictionsTotal: 0,
    staleDiscardsTotal: 0,
  };
  let frame = 0;
  let active = deps.enabled;
  let requiredNow = new Set<string>();
  let inFlight: InflightBatch | null = null;
  let completedWorkerBuildMs = 0;
  let completedWorkerTransferBytes = 0;
  let completedStaleDiscards = 0;
  let latest: StreamingClodRootStats = emptyStats();

  const beginMovementProbe = (): void => {
    probe.active = true;
    probe.requestedIds.clear();
    probe.requestedPagesTotal = 0;
    probe.applyPagesTotal = 0;
    probe.evictionsTotal = 0;
    probe.staleDiscardsTotal = 0;
  };
  registerGlobalStreamProbe(beginMovementProbe);

  const removeRoot = (id: string): void => {
    for (let i = deps.roots.length - 1; i >= 0; i--) {
      if (deps.roots[i]?.id === id) deps.roots.splice(i, 1);
    }
    for (let i = deps.allNodes.length - 1; i >= 0; i--) {
      if (deps.allNodes[i]?.id === id) deps.allNodes.splice(i, 1);
    }
  };

  const evict = (center: THREE.Vector3, radiusM: number): number => {
    let evictions = 0;
    for (const [id, entry] of [...cached.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const distance = Math.hypot(center.x - entry.centerX, center.z - entry.centerZ);
      if (distance <= radiusM * evictDistanceMultiplier) continue;
      cached.delete(id);
      removeRoot(id);
      evictions++;
    }
    if (cached.size <= maxCachedPages) return evictions;
    const lru = [...cached.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame || a[0].localeCompare(b[0]));
    while (cached.size > maxCachedPages && lru.length > 0) {
      const [id] = lru.shift()!;
      cached.delete(id);
      removeRoot(id);
      evictions++;
    }
    return evictions;
  };

  const buildStillWanted = (id: string): boolean => active && requiredNow.has(id) && !cached.has(id);

  const failedBuildCoolingDown = (id: string): boolean => {
    const failure = failed.get(id);
    return failure !== undefined && frame < failure.retryAfterFrame;
  };

  const discardStaleReadyPages = (): number => {
    let stale = 0;
    for (let i = ready.length - 1; i >= 0; i--) {
      const node = ready[i]!;
      if (buildStillWanted(node.id)) continue;
      ready.splice(i, 1);
      stale++;
      if (probe.active && probe.requestedIds.has(node.id)) probe.staleDiscardsTotal++;
    }
    return stale;
  };

  const applyReadyPages = (): { applied: number; applyMs: number; staleDiscards: number } => {
    const staleDiscards = discardStaleReadyPages();
    if (applyBudget <= 0 || ready.length === 0) return { applied: 0, applyMs: 0, staleDiscards };
    const appliedNodes: ClodPageNode[] = [];
    const startedAt = performance.now();
    while (ready.length > 0 && appliedNodes.length < applyBudget) {
      const node = ready.shift()!;
      if (!buildStillWanted(node.id)) continue;
      const centerX = (node.footprint.minX + node.footprint.maxX) / 2;
      const centerZ = (node.footprint.minZ + node.footprint.maxZ) / 2;
      deps.roots.push(node);
      deps.allNodes.push(node);
      cached.set(node.id, { node, centerX, centerZ, lastTouchFrame: frame });
      failed.delete(node.id);
      appliedNodes.push(node);
      if (probe.active && probe.requestedIds.has(node.id)) probe.applyPagesTotal++;
    }
    if (appliedNodes.length > 0) {
      deps.onNodesBuilt?.(appliedNodes);
      deps.onRootsChanged?.();
    }
    return {
      applied: appliedNodes.length,
      applyMs: performance.now() - startedAt,
      staleDiscards,
    };
  };

  const dispatchBuild = (coords: readonly PageCoord[]): number => {
    if (!deps.buildPages || coords.length === 0 || inFlight) return 0;
    const coordsById = new Map(coords.map((coord) => [streamingClodPageKey(coord.px, coord.pz), coord]));
    const batch: InflightBatch = { ids: new Set(coordsById.keys()), coordsById };
    inFlight = batch;
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
      completedWorkerBuildMs += Number.isFinite(built.buildMs) ? Math.max(0, built.buildMs) : 0;
      completedWorkerTransferBytes += Number.isFinite(built.transferBytes) ? Math.max(0, built.transferBytes ?? 0) : 0;
      for (const node of built.nodes) {
        if (buildStillWanted(node.id)) ready.push(node);
        else {
          completedStaleDiscards++;
          if (probe.active && probe.requestedIds.has(node.id)) probe.staleDiscardsTotal++;
        }
      }
    }).catch((error) => handleBuildRejection(batch, error));
    return batch.ids.size;
  };

  const scheduleBuilds = (required: readonly PageCoord[]): number => {
    if (!deps.buildPages || inFlight || buildBudget <= 0) return 0;
    const batch: PageCoord[] = [];
    for (const coord of required) {
      const id = streamingClodPageKey(coord.px, coord.pz);
      if (cached.has(id) || failedBuildCoolingDown(id) || buildStillQueued(id)) continue;
      batch.push(coord);
      if (batch.length >= buildBudget) break;
    }
    return dispatchBuild(batch);
  };

  const buildStillQueued = (id: string): boolean => ready.some((node) => node.id === id);

  const handleBuildRejection = (batch: InflightBatch, error: unknown): void => {
    if (inFlight === batch) inFlight = null;
    for (const id of batch.ids) {
      const previous = failed.get(id);
      const attempts = (previous?.attempts ?? 0) + 1;
      failed.set(id, { attempts, retryAfterFrame: frame + retryCooldownFrames(attempts) });
    }
    console.warn(`[clod-stream] worker failed to build ${batch.ids.size} streamed root page(s)`, error);
  };

  return {
    update(center, radiusM) {
      frame++;
      active = deps.enabled;
      if (!active) {
        requiredNow = new Set();
        ready.length = 0;
        latest = emptyStats();
        return latest;
      }

      const required = streamingClodRequiredPageCoords(center, radiusM, pageSize)
        .filter((coord) => !pageInsideFiniteStartupWorld(coord.px, coord.pz, worldPagesX, worldPagesZ));
      const requiredIds = new Set(required.map((coord) => streamingClodPageKey(coord.px, coord.pz)));
      requiredNow = requiredIds;

      for (const coord of required) {
        const existing = cached.get(streamingClodPageKey(coord.px, coord.pz));
        if (existing) existing.lastTouchFrame = frame;
      }

      const evictions = evict(center, radiusM);
      if (probe.active) probe.evictionsTotal += evictions;
      const workerBuildMs = completedWorkerBuildMs;
      const workerTransferBytes = completedWorkerTransferBytes;
      let staleDiscards = completedStaleDiscards;
      completedWorkerBuildMs = 0;
      completedWorkerTransferBytes = 0;
      completedStaleDiscards = 0;
      const applied = applyReadyPages();
      staleDiscards += applied.staleDiscards;
      const scheduledPagesThisFrame = scheduleBuilds(required);
      if (evictions > 0) deps.onRootsChanged?.();

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
      };
      return latest;
    },
    stats() {
      return latest;
    },
    beginMovementProbe,
  };
}

function emptyStats(): StreamingClodRootStats {
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
  };
}