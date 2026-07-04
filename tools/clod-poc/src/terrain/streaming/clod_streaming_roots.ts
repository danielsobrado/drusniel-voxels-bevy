import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { buildLod0PageSource } from "../../clod/source_mesh.js";
import { boundsOf, INITIAL_NODE_REVISION } from "../../clod/quadtree_support.js";
import type { ClodPageNode } from "../../types.js";
import type { WorldBounds } from "../terrain_surface.js";

export interface StreamingClodRootStats {
  requiredPages: number;
  cachedPages: number;
  builtThisFrame: number;
  failedPages: number;
  evictions: number;
  buildMs: number;
}

export interface StreamingClodRootController {
  update(center: THREE.Vector3, radiusM: number): StreamingClodRootStats;
  stats(): StreamingClodRootStats;
}

export type StreamingClodRootBuildScheduler = (task: () => void) => void;

export interface StreamingClodRootControllerDeps {
  roots: ClodPageNode[];
  allNodes: ClodPageNode[];
  cfg: ClodPagesConfig;
  worldCells: number;
  enabled: boolean;
  buildBudgetPagesPerFrame?: number;
  maxCachedPages?: number;
  evictDistanceMultiplier?: number;
  scheduleBuild?: StreamingClodRootBuildScheduler;
  onNodesBuilt?: (nodes: readonly ClodPageNode[]) => void;
  onRootsChanged?: () => void;
}

interface PageCoord {
  px: number;
  pz: number;
  centerX: number;
  centerZ: number;
}

// TODO: replace this opt-in synchronous builder with a worker/off-frame queue before enabling it by default.
const DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME = 0;
const DEFAULT_MAX_CACHED_PAGES = 128;
const DEFAULT_EVICT_DISTANCE_MULTIPLIER = 2.5;

function defaultBuildScheduler(task: () => void): void {
  globalThis.setTimeout(task, 0);
}

function resolveBuildBudget(value: number | undefined): number {
  const raw = value ?? DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME;
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
  const buildBudget = resolveBuildBudget(deps.buildBudgetPagesPerFrame);
  const maxCachedPages = Math.max(1, Math.floor(deps.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES));
  const evictDistanceMultiplier = Math.max(1, deps.evictDistanceMultiplier ?? DEFAULT_EVICT_DISTANCE_MULTIPLIER);
  const scheduleBuild = deps.scheduleBuild ?? defaultBuildScheduler;
  const cached = new Map<string, { node: ClodPageNode; centerX: number; centerZ: number; lastTouchFrame: number }>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  let frame = 0;
  let active = deps.enabled;
  let requiredNow = new Set<string>();
  let completedBuilds = 0;
  let completedBuildMs = 0;
  let latest: StreamingClodRootStats = emptyStats();

  const removeRoot = (id: string): void => {
    const rootIndex = deps.roots.findIndex((node) => node.id === id);
    if (rootIndex >= 0) deps.roots.splice(rootIndex, 1);
    const allIndex = deps.allNodes.findIndex((node) => node.id === id);
    if (allIndex >= 0) deps.allNodes.splice(allIndex, 1);
  };

  const evict = (center: THREE.Vector3, radiusM: number): number => {
    let evictions = 0;
    for (const [id, entry] of [...cached.entries()]) {
      const distance = Math.hypot(center.x - entry.centerX, center.z - entry.centerZ);
      if (distance <= radiusM * evictDistanceMultiplier) continue;
      cached.delete(id);
      removeRoot(id);
      evictions++;
    }
    if (cached.size <= maxCachedPages) return evictions;
    const lru = [...cached.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame);
    while (cached.size > maxCachedPages && lru.length > 0) {
      const [id] = lru.shift()!;
      cached.delete(id);
      removeRoot(id);
      evictions++;
    }
    return evictions;
  };

  const buildNode = (coord: PageCoord): ClodPageNode => {
    const world: WorldBounds = { cellsX: deps.worldCells, cellsZ: deps.worldCells, finite: false };
    const src = buildLod0PageSource(coord.px, coord.pz, deps.cfg, world);
    return {
      id: streamingClodPageKey(coord.px, coord.pz),
      revision: INITIAL_NODE_REVISION,
      level: 0,
      children: [],
      mesh: src.mesh,
      footprint: src.footprint,
      bounds: boundsOf(src.mesh),
      errorWorld: 0,
      lowBenefit: false,
      chunkMeshes: src.chunks,
    };
  };

  const buildStillWanted = (id: string): boolean => active && requiredNow.has(id) && !cached.has(id);

  const scheduleNodeBuild = (coord: PageCoord, frameId: number): void => {
    const id = streamingClodPageKey(coord.px, coord.pz);
    pending.add(id);
    scheduleBuild(() => {
      const startedAt = performance.now();
      try {
        if (!buildStillWanted(id)) return;
        const node = buildNode(coord);
        if (!buildStillWanted(id)) return;
        deps.roots.push(node);
        deps.allNodes.push(node);
        cached.set(id, { node, centerX: coord.centerX, centerZ: coord.centerZ, lastTouchFrame: frameId });
        completedBuilds++;
        deps.onNodesBuilt?.([node]);
        deps.onRootsChanged?.();
      } catch (error) {
        if (active && requiredNow.has(id)) {
          console.warn(`[clod-stream] failed to build ${id}`, error);
          failed.add(id);
        }
      } finally {
        pending.delete(id);
        completedBuildMs += performance.now() - startedAt;
      }
    });
  };

  return {
    update(center, radiusM) {
      frame++;
      const finishedBuilds = completedBuilds;
      const finishedBuildMs = completedBuildMs;
      completedBuilds = 0;
      completedBuildMs = 0;
      active = deps.enabled;
      if (!active) {
        requiredNow = new Set();
        latest = emptyStats();
        return latest;
      }
      const required = streamingClodRequiredPageCoords(center, radiusM, pageSize)
        .filter((coord) => !pageInsideFiniteStartupWorld(coord.px, coord.pz, worldPagesX, worldPagesZ));
      let scheduledThisFrame = 0;
      const requiredIds = new Set(required.map((coord) => streamingClodPageKey(coord.px, coord.pz)));
      requiredNow = requiredIds;

      for (const coord of required) {
        const id = streamingClodPageKey(coord.px, coord.pz);
        const existing = cached.get(id);
        if (existing) {
          existing.lastTouchFrame = frame;
          continue;
        }
        if (buildBudget <= 0 || pending.has(id) || failed.has(id) || scheduledThisFrame >= buildBudget) continue;
        scheduleNodeBuild(coord, frame);
        scheduledThisFrame++;
      }

      const evictions = evict(center, radiusM);
      if (evictions > 0) deps.onRootsChanged?.();
      latest = {
        requiredPages: requiredIds.size,
        cachedPages: cached.size,
        builtThisFrame: finishedBuilds,
        failedPages: [...requiredIds].filter((id) => failed.has(id)).length,
        evictions,
        buildMs: finishedBuildMs,
      };
      return latest;
    },
    stats() {
      return latest;
    },
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
  };
}
