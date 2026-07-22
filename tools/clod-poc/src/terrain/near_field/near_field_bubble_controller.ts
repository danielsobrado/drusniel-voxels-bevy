import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { voxelEditsRequireCpuDerivedMeshing } from "../../terrain/terrain.js";
import {
  getVoxelOverlaySource,
  setVoxelOverlayResidentBounds,
  voxelOverlayIntersectsBounds,
} from "../voxel_overlay/voxel_overlay.js";
import type { ChunkMesh, GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import type { TerrainMaterialController } from "../material/terrain_material_controller.js";
import type { TerrainColliderFootprint, TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { WorldBounds } from "../../terrain/terrain_surface.js";
import {
  liveBubbleBuildBudget,
  liveBubbleColliderRadiusOverride,
  liveBubbleGpuChunkBudget,
  liveBubbleMaxInflightChunks,
} from "./near_field_bubble_budgets.js";
import { createNearFieldCpuPageQueue, type PendingCpuPageBuild } from "./near_field_cpu_page_queue.js";
import {
  createNearFieldGpuPageQueue,
  pageChunks,
  type PendingGpuPageBuild,
  type PendingGpuWaitPageBuild,
} from "./near_field_gpu_page_queue.js";
import {
  chunkColliderId,
  createNearFieldBubbleSceneApply,
  footprintIntersectsCircle,
  liveBubbleChunkFootprint,
  pageEntryReady,
  pageGroupKey,
  parsePageGroupKey,
  showReadyGroup,
  type ChunkGroupEntry,
} from "./near_field_bubble_scene_apply.js";

export {
  resolveLiveBubbleBuildBudget,
  resolveLiveBubbleColliderRadius,
  resolveLiveBubbleGpuChunkBudget,
  resolveLiveBubbleMaxInflightChunks,
} from "./near_field_bubble_budgets.js";

export {
  liveBubbleChunkFootprint,
  pageEntryReady,
  pageGroupKey,
  type ChunkGroupEntry,
} from "./near_field_bubble_scene_apply.js";

export interface NearFieldBubbleView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  fade: number;
  target: number;
}

export interface NearFieldBubbleUpdate {
  enabled: boolean;
  bubbleRadius: number;
  bubbleCenter: THREE.Vector3;
  bubbleViews: Iterable<NearFieldBubbleView>;
  getView: (nodeId: string) => NearFieldBubbleView | undefined;
  frameId: number;
}

export interface NearFieldBubbleStats {
  chunkGroupsBuiltThisFrame: number;
  bubbleMs: number;
  chunkGroupCount: number;
  requiredPages: number;
  readyPages: number;
  buildingPages: number;
  failedPages: number;
  evictions: number;
  colliderEvictions: number;
  streamedColliderPages: number;
  validEmptyPages: number;
  gpuRetryPages: number;
  gpuRetriesTotal: number;
  gpuTerminalFailuresTotal: number;
  colliderRegistrations: number;
  colliderRemovals: number;
  gpuDispatchBudget: number;
  gpuMaxInflightChunks: number;
  pendingChunks: number;
  inflightChunks: number;
  readyVisualPages: number;
  avgChunkMs: number;
  slowestPageMs: number;
  visualRequiredPages: number;
  visualReadyPages: number;
  colliderRequiredPages: number;
  colliderReadyPages: number;
  colliderSkippedPages: number;
  cpuWorkUnitMaxMs: number;
  gpuApplyMaxMs: number;
}

export interface NearFieldBubbleControllerDeps {
  scene: THREE.Scene;
  materialController: TerrainMaterialController;
  cfg: ClodPagesConfig;
  worldBounds: WorldBounds;
  getTintBubble: () => boolean;
  getGpuMesher: () => GpuChunkMesher | null;
  chunkGroupBuildBudget: number;
  maxCachedChunkGroups: number;
  evictDistanceMultiplier: number;
  streamingLiveTerrain?: boolean;
  terrainColliders?: TerrainColliderSet | null;
}

export interface NearFieldBubbleController {
  update(input: NearFieldBubbleUpdate): NearFieldBubbleStats;
  invalidatePage(nodeId: string): void;
  replaceChunks(nodeId: string, chunks: readonly { localIndex: number; mesh: PageMesh }[], revision: number): void;
  applyTint(enabled: boolean): void;
  size(): number;
  chunkGroupValues(): Iterable<ChunkGroupEntry>;
  readyPageKeys(): readonly string[];
  dispose(): void;
}

export interface PageCoord {
  px: number;
  pz: number;
  centerX: number;
  centerZ: number;
}

export function nearFieldPageIntersectsVoxelOverlay(
  px: number,
  pz: number,
  pageSize: number,
  source = getVoxelOverlaySource(),
): boolean {
  return voxelOverlayIntersectsBounds(source, {
    minX: px * pageSize,
    minZ: pz * pageSize,
    maxX: (px + 1) * pageSize,
    maxZ: (pz + 1) * pageSize,
  });
}

export interface RequiredStreamingPageCoordCache {
  get(center: THREE.Vector3, bubbleRadius: number, pageSize: number): readonly PageCoord[];
}

export function createRequiredStreamingPageCoordCache(): RequiredStreamingPageCoordCache {
  let key = "";
  let coords: readonly PageCoord[] = [];
  return {
    get(center, bubbleRadius, pageSize) {
      const centerPx = Math.floor(center.x / pageSize);
      const centerPz = Math.floor(center.z / pageSize);
      const nextKey = `${centerPx},${centerPz}:${bubbleRadius}:${pageSize}`;
      if (nextKey !== key) {
        key = nextKey;
        coords = requiredStreamingPageCoords(center, bubbleRadius, pageSize);
      }
      return coords;
    },
  };
}

function pageIntersectsFiniteWorld(px: number, pz: number, pageSize: number, world: WorldBounds): boolean {
  if (world.finite === false) return true;
  const minX = px * pageSize;
  const maxX = minX + pageSize;
  const minZ = pz * pageSize;
  const maxZ = minZ + pageSize;
  return maxX > 0 && minX < world.cellsX && maxZ > 0 && minZ < world.cellsZ;
}

export function requiredStreamingPageCoords(
  center: THREE.Vector3,
  bubbleRadius: number,
  pageSize: number,
): PageCoord[] {
  const centerPx = Math.floor(center.x / pageSize);
  const centerPz = Math.floor(center.z / pageSize);
  const centerX = (centerPx + 0.5) * pageSize;
  const centerZ = (centerPz + 0.5) * pageSize;
  const residencyRadius = bubbleRadius + pageSize * Math.SQRT2 * 0.5;
  const residencyRadiusSq = residencyRadius * residencyRadius;
  const radiusPages = Math.ceil(residencyRadius / pageSize);
  const coords: PageCoord[] = [];

  for (let px = centerPx - radiusPages; px <= centerPx + radiusPages; px++) {
    for (let pz = centerPz - radiusPages; pz <= centerPz + radiusPages; pz++) {
      const pageCenterX = (px + 0.5) * pageSize;
      const pageCenterZ = (pz + 0.5) * pageSize;
      const dx = centerX - pageCenterX;
      const dz = centerZ - pageCenterZ;
      if (dx * dx + dz * dz <= residencyRadiusSq) {
        coords.push({ px, pz, centerX: pageCenterX, centerZ: pageCenterZ });
      }
    }
  }

  return coords.sort((a, b) => {
    const dax = centerPx - a.px;
    const daz = centerPz - a.pz;
    const dbx = centerPx - b.px;
    const dbz = centerPz - b.pz;
    const da = dax * dax + daz * daz;
    const db = dbx * dbx + dbz * dbz;
    return da - db || a.px - b.px || a.pz - b.pz;
  });
}

export function liveBubbleOwnsPageView(
  node: ClodPageNode,
  bubbleCenter: THREE.Vector3,
  bubbleRadius: number,
  pageSize: number,
  target: number,
): boolean {
  if (node.level !== 0 || target <= 0.5) return false;
  const centerX = (node.footprint.minX + node.footprint.maxX) / 2;
  const centerZ = (node.footprint.minZ + node.footprint.maxZ) / 2;
  const halfDiag = pageSize * Math.SQRT2 * 0.5;
  const dx = bubbleCenter.x - centerX;
  const dz = bubbleCenter.z - centerZ;
  const radius = bubbleRadius + halfDiag;
  return dx * dx + dz * dz <= radius * radius;
}

export function createNearFieldBubbleController(deps: NearFieldBubbleControllerDeps): NearFieldBubbleController {
  const P = deps.cfg.page.chunks_per_page;
  const S = deps.cfg.page.chunk_size;
  const pageSize = P * S;
  const liveStreamingEnabled = deps.streamingLiveTerrain ?? true;
  const chunkGroupBuildBudget = liveBubbleBuildBudget(deps.chunkGroupBuildBudget);
  const gpuChunkDispatchBudget = liveBubbleGpuChunkBudget();
  const gpuMaxInflightChunks = liveBubbleMaxInflightChunks();
  const colliderRadiusOverride = liveBubbleColliderRadiusOverride();
  const chunkGroups = new Map<string, ChunkGroupEntry>();
  const cpuPendingBuilds = new Map<string, PendingCpuPageBuild>();
  const gpuWaitBuilds = new Map<string, PendingGpuWaitPageBuild>();
  const gpuPendingBuilds = new Map<string, PendingGpuPageBuild>();
  const gpuApplyQueue: Array<{
    key: string;
    entry: ChunkGroupEntry;
    job: PendingGpuPageBuild;
    dx: number;
    dz: number;
    cm: ChunkMesh;
  }> = [];
  const requiredCoordCache = createRequiredStreamingPageCoordCache();
  const terrainColliders = deps.terrainColliders ?? null;
  const pageRevisions = new Map<string, number>();
  let colliderRegistrations = 0;
  let colliderRemovals = 0;
  let gpuRetriesTotal = 0;
  let gpuTerminalFailuresTotal = 0;
  let totalChunkMs = 0;
  let completedChunks = 0;
  let slowestPageMs = 0;
  let currentFrame = 0;
  let currentBubbleCenter = new THREE.Vector3();
  let currentColliderRadius: number | null = null;
  let lastEvictionCenterPage = "";
  let cpuWorkUnitMaxMsThisFrame = 0;
  let gpuApplyMaxMsThisFrame = 0;

  const sceneApply = createNearFieldBubbleSceneApply({
    scene: deps.scene,
    materialController: deps.materialController,
    getTintBubble: deps.getTintBubble,
    terrainColliders,
    chunksPerPage: P,
    chunkGroups,
    getBubbleCenter: () => currentBubbleCenter,
    getColliderRadius: () => currentColliderRadius,
    onColliderRegistered: () => {
      colliderRegistrations++;
    },
    onColliderRemoved: () => {
      colliderRemovals++;
    },
  });

  const cpuQueue = createNearFieldCpuPageQueue({
    pending: cpuPendingBuilds,
    gpuPendingHas: (key) => gpuPendingBuilds.has(key),
    getEntry: (key) => chunkGroups.get(key),
    chunksPerPage: P,
    chunkSize: S,
    cfg: deps.cfg,
    sceneApply,
    onWorkUnitMs: (ms) => {
      cpuWorkUnitMaxMsThisFrame = Math.max(cpuWorkUnitMaxMsThisFrame, ms);
    },
  });

  const buildWorldBoundsForPage = (px: number, pz: number): WorldBounds => {
    if (!liveStreamingEnabled) return deps.worldBounds;
    if (pageIntersectsFiniteWorld(px, pz, pageSize, deps.worldBounds)) return deps.worldBounds;
    return { ...deps.worldBounds, finite: false };
  };

  const gpuQueue = createNearFieldGpuPageQueue({
    pending: gpuPendingBuilds,
    wait: gpuWaitBuilds,
    applyQueue: gpuApplyQueue,
    cpuPendingHas: (key) => cpuPendingBuilds.has(key),
    enqueueCpuChunk: cpuQueue.enqueueChunk,
    getEntry: (key) => chunkGroups.get(key),
    getGpuMesher: deps.getGpuMesher,
    buildWorldBoundsForPage,
    getFrame: () => currentFrame,
    liveStreamingEnabled,
    terrainColliders,
    chunksPerPage: P,
    chunkSize: S,
    dispatchBudget: gpuChunkDispatchBudget,
    maxInflightChunks: gpuMaxInflightChunks,
    sceneApply,
    onGpuRetry: () => {
      gpuRetriesTotal++;
    },
    onGpuTerminalFailure: () => {
      gpuTerminalFailuresTotal++;
    },
    onChunkMs: (ms) => {
      totalChunkMs += ms;
      completedChunks++;
    },
    onSlowestPageMs: (ms) => {
      slowestPageMs = Math.max(slowestPageMs, ms);
    },
    onApplyMs: (ms) => {
      gpuApplyMaxMsThisFrame = Math.max(gpuApplyMaxMsThisFrame, ms);
    },
  });

  const pageCenter = (node: ClodPageNode): [number, number] => [
    (node.footprint.minX + node.footprint.maxX) / 2,
    (node.footprint.minZ + node.footprint.maxZ) / 2,
  ];

  const activeColliderPages = (): number => {
    let total = 0;
    for (const entry of chunkGroups.values()) {
      if (entry.colliderIds.length > 0) total++;
    }
    return total;
  };

  const validEmptyPages = (): number => {
    let total = 0;
    for (const entry of chunkGroups.values()) {
      if (entry.ready && !entry.failed && entry.validEmpty) total++;
    }
    return total;
  };

  const disposeEntry = (nodeId: string, entry: ChunkGroupEntry) => {
    setVoxelOverlayResidentBounds(nodeId, null);
    deps.scene.remove(entry.group);
    sceneApply.clearEntryContent(entry);
    chunkGroups.delete(nodeId);
    cpuQueue.delete(nodeId);
    gpuQueue.delete(nodeId);
    pageRevisions.delete(nodeId);
  };

  const ensureChunkGroupForPage = (key: string, px: number, pz: number, centerX: number, centerZ: number): ChunkGroupEntry => {
    const existing = chunkGroups.get(key);
    if (existing) return existing;
    const group = new THREE.Group();
    const mats: ChunkGroupEntry["mats"] = [];
    const unsubs: Array<() => void> = [];
    const colliderIds: string[] = [];
    const worldBounds = buildWorldBoundsForPage(px, pz);
    const pageBounds = {
      minX: px * pageSize,
      minZ: pz * pageSize,
      maxX: (px + 1) * pageSize,
      maxZ: (pz + 1) * pageSize,
    };
    const complexOverlay = nearFieldPageIntersectsVoxelOverlay(px, pz, pageSize);
    const requiresCpuMeshing = voxelEditsRequireCpuDerivedMeshing() || complexOverlay;
    const gpuMesher = requiresCpuMeshing ? null : deps.getGpuMesher();

    if (gpuMesher) {
      const entry = sceneApply.createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ, complexOverlay ? pageBounds : null);
      gpuQueue.enqueuePageBuild(key, px, pz, worldBounds);
      return entry;
    }

    if (liveStreamingEnabled && !requiresCpuMeshing) {
      const entry = sceneApply.createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ, complexOverlay ? pageBounds : null);
      gpuQueue.enqueueWait(key, px, pz);
      return entry;
    }

    // CPU fallback: never mesh a whole page synchronously — queue the chunks
    // and drain them in update() under a per-frame budget. The entry follows
    // the same deferred-ready contract as the GPU path.
    const entry = sceneApply.createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ, complexOverlay ? pageBounds : null);
    cpuQueue.enqueuePage(key, px, pz, worldBounds, pageChunks(P));
    return entry;
  };

  const ensureChunkGroup = (node: ClodPageNode): ChunkGroupEntry => {
    const { px, pz } = parsePageGroupKey(node.id);
    const [centerX, centerZ] = pageCenter(node);
    return ensureChunkGroupForPage(node.id, px, pz, centerX, centerZ);
  };

  const evictColliderBearingCache = (bubbleCenter: THREE.Vector3, bubbleRadius: number): { evictions: number; colliderEvictions: number } => {
    let evictions = 0;
    let colliderEvictions = 0;
    const disposeAndCount = (nodeId: string, entry: ChunkGroupEntry) => {
      if (entry.colliderIds.length > 0) colliderEvictions++;
      disposeEntry(nodeId, entry);
      evictions++;
    };
    for (const [nodeId, entry] of [...chunkGroups.entries()]) {
      const dx = bubbleCenter.x - entry.centerX;
      const dz = bubbleCenter.z - entry.centerZ;
      const evictRadius = bubbleRadius * deps.evictDistanceMultiplier;
      if (dx * dx + dz * dz > evictRadius * evictRadius) {
        disposeAndCount(nodeId, entry);
      }
    }
    if (chunkGroups.size <= deps.maxCachedChunkGroups) return { evictions, colliderEvictions };
    const lru = [...chunkGroups.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame);
    while (chunkGroups.size > deps.maxCachedChunkGroups && lru.length > 0) {
      const [nodeId, entry] = lru.shift()!;
      disposeAndCount(nodeId, entry);
    }
    return { evictions, colliderEvictions };
  };

  const countPendingChunks = (): { pendingChunks: number; inflightChunks: number } => {
    const gpu = gpuQueue.countChunks();
    let pendingChunks = gpu.pendingChunks;
    for (const job of cpuPendingBuilds.values()) pendingChunks += job.chunks.length + (job.active ? 1 : 0);
    return { pendingChunks, inflightChunks: gpu.inflightChunks };
  };

  const countRequiredPages = (requiredCoords: PageCoord[], colliderRadius: number | null) => {
    let readyPages = 0;
    let buildingPages = 0;
    let failedPages = 0;
    let colliderRequiredPages = 0;
    let colliderReadyPages = 0;
    let colliderSkippedPages = 0;
    for (const coord of requiredCoords) {
      const key = pageGroupKey(coord.px, coord.pz);
      const entry = chunkGroups.get(key);
      const pageFootprint: TerrainColliderFootprint = {
        minX: coord.px * pageSize,
        minZ: coord.pz * pageSize,
        maxX: coord.px * pageSize + pageSize,
        maxZ: coord.pz * pageSize + pageSize,
      };
      const needsCollider = colliderRadius === null || footprintIntersectsCircle(pageFootprint, currentBubbleCenter, colliderRadius);
      if (needsCollider) colliderRequiredPages++;
      if (!entry) {
        buildingPages++;
        continue;
      }
      if (entry.failed) failedPages++;
      else if (!entry.ready) buildingPages++;
      else if (pageEntryReady(entry)) {
        readyPages++;
        if (needsCollider && (entry.colliderIds.length > 0 || entry.validEmpty || !terrainColliders)) colliderReadyPages++;
        if (!needsCollider && entry.colliderIds.length === 0) colliderSkippedPages++;
      }
      else buildingPages++;
    }
    return { readyPages, buildingPages, failedPages, colliderRequiredPages, colliderReadyPages, colliderSkippedPages };
  };

  return {
    update(input) {
      const tBubbleStart = performance.now();
      cpuWorkUnitMaxMsThisFrame = 0;
      gpuApplyMaxMsThisFrame = 0;
      currentFrame = input.frameId;
      currentBubbleCenter = input.bubbleCenter;
      currentColliderRadius = colliderRadiusOverride;
      let chunkGroupsBuiltThisFrame = 0;
      let evictions = 0;
      let colliderEvictions = 0;
      let requiredCoords: PageCoord[] = [];
      if (input.enabled) {
        if (liveStreamingEnabled) {
          requiredCoords = requiredCoordCache.get(input.bubbleCenter, input.bubbleRadius, pageSize) as PageCoord[];
          for (const coord of requiredCoords) {
            const key = pageGroupKey(coord.px, coord.pz);
            let grp = chunkGroups.get(key);
            if (!grp) {
              if (chunkGroupsBuiltThisFrame >= chunkGroupBuildBudget) continue;
              grp = ensureChunkGroupForPage(key, coord.px, coord.pz, coord.centerX, coord.centerZ);
              chunkGroupsBuiltThisFrame++;
            }
            grp.lastTouchFrame = input.frameId;
            showReadyGroup(grp);
          }
        }

        for (const v of input.bubbleViews) {
          const owned = liveBubbleOwnsPageView(
            v.node,
            input.bubbleCenter,
            input.bubbleRadius,
            pageSize,
            v.target,
          );
          if (owned) {
            let grp = chunkGroups.get(v.node.id);
            if (!grp) {
              if (chunkGroupsBuiltThisFrame >= chunkGroupBuildBudget) {
                v.mesh.visible = true;
                continue;
              }
              grp = ensureChunkGroup(v.node);
              chunkGroupsBuiltThisFrame++;
            }
            grp.lastTouchFrame = input.frameId;
            if (!showReadyGroup(grp, v.mesh)) {
              v.mesh.visible = v.fade > 0.001;
            }
          } else {
            const grp = chunkGroups.get(v.node.id);
            if (grp) grp.group.visible = false;
            v.mesh.visible = v.fade > 0.001;
          }
        }

        gpuQueue.promoteWaitBuilds();
        gpuQueue.drainApplyQueue();
        gpuQueue.drainPendingBuilds();
        cpuQueue.drain(tBubbleStart);
        const centerPage = `${Math.floor(input.bubbleCenter.x / pageSize)},${Math.floor(input.bubbleCenter.z / pageSize)}:${input.bubbleRadius}`;
        if (centerPage !== lastEvictionCenterPage || chunkGroups.size > deps.maxCachedChunkGroups) {
          lastEvictionCenterPage = centerPage;
          const evictStats = evictColliderBearingCache(input.bubbleCenter, input.bubbleRadius);
          evictions = evictStats.evictions;
          colliderEvictions = evictStats.colliderEvictions;
        }
      } else if (chunkGroups.size > 0) {
        for (const [nodeId, { group }] of chunkGroups) {
          group.visible = false;
          const view = input.getView(nodeId);
          if (view) view.mesh.visible = view.fade > 0.001;
        }
      }
      const required = countRequiredPages(requiredCoords, currentColliderRadius);
      const chunkCounts = countPendingChunks();
      return {
        chunkGroupsBuiltThisFrame,
        bubbleMs: performance.now() - tBubbleStart,
        chunkGroupCount: chunkGroups.size,
        requiredPages: requiredCoords.length,
        readyPages: required.readyPages,
        buildingPages: required.buildingPages,
        failedPages: required.failedPages,
        evictions,
        colliderEvictions,
        streamedColliderPages: activeColliderPages(),
        validEmptyPages: validEmptyPages(),
        gpuRetryPages: gpuQueue.retryPages(),
        gpuRetriesTotal,
        gpuTerminalFailuresTotal,
        colliderRegistrations,
        colliderRemovals,
        gpuDispatchBudget: gpuChunkDispatchBudget,
        gpuMaxInflightChunks,
        pendingChunks: chunkCounts.pendingChunks,
        inflightChunks: chunkCounts.inflightChunks,
        readyVisualPages: required.readyPages,
        avgChunkMs: completedChunks > 0 ? totalChunkMs / completedChunks : 0,
        slowestPageMs,
        visualRequiredPages: requiredCoords.length,
        visualReadyPages: required.readyPages,
        colliderRequiredPages: required.colliderRequiredPages,
        colliderReadyPages: required.colliderReadyPages,
        colliderSkippedPages: required.colliderSkippedPages,
        cpuWorkUnitMaxMs: cpuWorkUnitMaxMsThisFrame,
        gpuApplyMaxMs: gpuApplyMaxMsThisFrame,
      };
    },
    invalidatePage(nodeId) {
      const entry = chunkGroups.get(nodeId);
      if (!entry) return;
      disposeEntry(nodeId, entry);
    },
    replaceChunks(nodeId, chunks, revision) {
      const previousRevision = pageRevisions.get(nodeId) ?? -1;
      if (revision < previousRevision) return;
      pageRevisions.set(nodeId, revision);
      const entry = chunkGroups.get(nodeId);
      if (!entry || !entry.ready || entry.failed) return;
      const { px, pz } = parsePageGroupKey(nodeId);
      for (const { localIndex, mesh: chunkMesh } of chunks) {
        const dx = localIndex % P;
        const dz = (localIndex / P) | 0;
        const oldMesh = entry.group.children.find(
          (child) => Number(child.userData["liveChunkIndex"]) === localIndex,
        ) as THREE.Mesh | undefined;
        if (chunkMesh.indices.length > 0) {
          sceneApply.addChunkMesh(
            entry.group,
            entry.mats,
            entry.unsubs,
            entry.colliderIds,
            chunkMesh,
            chunkColliderId(nodeId, dx, dz),
            liveBubbleChunkFootprint(px, pz, dx, dz, P, S),
            localIndex,
          );
          if (oldMesh) sceneApply.disposeChunkMesh(nodeId, entry, oldMesh, false);
        } else if (oldMesh) {
          sceneApply.disposeChunkMesh(nodeId, entry, oldMesh, true);
        }
      }
      entry.validEmpty = entry.group.children.length === 0;
    },
    applyTint(enabled) {
      const color = enabled ? 0xc94b4b : 0xffffff;
      for (const entry of chunkGroups.values()) {
        for (const m of entry.mats) m.setBaseColor(color);
      }
    },
    size() {
      return chunkGroups.size;
    },
    chunkGroupValues() {
      return chunkGroups.values();
    },
    readyPageKeys() {
      const ready: string[] = [];
      for (const [key, entry] of chunkGroups) {
        if (pageEntryReady(entry)) ready.push(key);
      }
      return ready.sort();
    },
    dispose() {
      for (const [nodeId, entry] of [...chunkGroups.entries()]) {
        disposeEntry(nodeId, entry);
      }
    },
  };
}
