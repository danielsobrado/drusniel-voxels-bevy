import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import type { TerrainColliderFootprint, TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { TerrainMaterialController } from "../material/terrain_material_controller.js";
import type { TerrainMaterialHandle } from "../../rendering/terrain_material.js";
import { toGeometry } from "../geometry/page_geometry.js";
import {
  liveBubbleChunkFootprint,
  liveBubbleOwnsPageView,
  createRequiredStreamingPageCoordCache,
  resolveLiveBubbleBuildBudget,
  resolveLiveBubbleColliderRadius,
  type ChunkGroupEntry,
  type NearFieldBubbleController,
  type NearFieldBubbleStats,
  type NearFieldBubbleUpdate,
  type PageCoord,
} from "./near_field_bubble_controller.js";
import type { LiveBubbleStreamPageBuilder } from "./live_bubble_stream_page_builder.js";

interface StreamedNearFieldBubbleControllerDeps {
  scene: THREE.Scene;
  materialController: TerrainMaterialController;
  cfg: ClodPagesConfig;
  getTintBubble: () => boolean;
  buildStreamPages: LiveBubbleStreamPageBuilder;
  chunkGroupBuildBudget: number;
  maxCachedChunkGroups: number;
  evictDistanceMultiplier: number;
  terrainColliders?: TerrainColliderSet | null;
}

interface PendingPageBuild {
  px: number;
  pz: number;
  centerX: number;
  centerZ: number;
  startedAtMs: number;
}

const STREAM_INFLIGHT_BATCHES = 1;
const STREAM_PAGE_LEVEL = 0;
const DEFAULT_GPU_CHUNK_DISPATCH_BUDGET = 0;
const DEFAULT_GPU_MAX_INFLIGHT_CHUNKS = 0;

function currentParams(): URLSearchParams {
  return typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function pageGroupKey(px: number, pz: number): string {
  return `L0:${px},${pz}`;
}

function parsePageGroupKey(key: string): { px: number; pz: number } {
  const [, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(px) || !Number.isInteger(pz)) throw new Error(`Invalid page key ${key}`);
  return { px, pz };
}

function pageFootprint(px: number, pz: number, pageSize: number): TerrainColliderFootprint {
  const minX = px * pageSize;
  const minZ = pz * pageSize;
  return { minX, minZ, maxX: minX + pageSize, maxZ: minZ + pageSize };
}

function chunkColliderId(pageKey: string, dx: number, dz: number): string {
  return `${pageKey}:chunk:${dx},${dz}`;
}

function pageColliderId(pageKey: string): string {
  return `${pageKey}:page`;
}

function footprintIntersectsCircle(footprint: TerrainColliderFootprint, center: THREE.Vector3, radius: number): boolean {
  const closestX = THREE.MathUtils.clamp(center.x, footprint.minX, footprint.maxX);
  const closestZ = THREE.MathUtils.clamp(center.z, footprint.minZ, footprint.maxZ);
  const dx = center.x - closestX;
  const dz = center.z - closestZ;
  return dx * dx + dz * dz <= radius * radius;
}

export function createStreamedNearFieldBubbleController(deps: StreamedNearFieldBubbleControllerDeps): NearFieldBubbleController {
  const chunksPerPage = deps.cfg.page.chunks_per_page;
  const chunkSize = deps.cfg.page.chunk_size;
  const pageSize = chunksPerPage * chunkSize;
  const chunkGroupBuildBudget = resolveLiveBubbleBuildBudget(deps.chunkGroupBuildBudget, currentParams());
  const colliderRadiusOverride = resolveLiveBubbleColliderRadius(currentParams());
  const terrainColliders = deps.terrainColliders ?? null;
  const entries = new Map<string, ChunkGroupEntry>();
  const pending = new Map<string, PendingPageBuild>();
  const requiredCoordCache = createRequiredStreamingPageCoordCache();
  let inflight = new Set<string>();
  let currentFrame = 0;
  let currentCenter = new THREE.Vector3();
  let colliderRegistrations = 0;
  let colliderRemovals = 0;
  let slowestPageMs = 0;
  let lastEvictionCenterPage = "";

  const pageEntryReady = (entry: ChunkGroupEntry): boolean => (
    entry.ready && !entry.failed && (entry.group.children.length > 0 || entry.colliderIds.length > 0 || entry.validEmpty)
  );

  const buildMaterial = (): TerrainMaterialHandle => {
    const mat = deps.materialController.makeTerrainMaterial(deps.getTintBubble() ? 0xc94b4b : 0xffffff);
    deps.materialController.configureChunkMaterial(mat);
    return mat;
  };

  const addMesh = (entry: ChunkGroupEntry, meshData: PageMesh, colliderId: string, footprint: TerrainColliderFootprint): void => {
    const material = buildMaterial();
    const geometry = toGeometry(meshData);
    const mesh = new THREE.Mesh(geometry, material.material);
    entry.unsubs.push(material.onMaterialChanged((next) => { mesh.material = next; }));
    entry.mats.push(material);
    entry.group.add(mesh);
    const colliderAllowed = colliderRadiusOverride === null || footprintIntersectsCircle(footprint, currentCenter, colliderRadiusOverride);
    if (meshData.indices.length > 0 && terrainColliders && colliderAllowed) {
      terrainColliders.upsertPage({ id: colliderId, geometry, footprint });
      entry.colliderIds.push(colliderId);
      colliderRegistrations++;
    }
  };

  const clearEntryContent = (entry: ChunkGroupEntry): void => {
    for (const colliderId of entry.colliderIds.splice(0)) {
      if (terrainColliders?.removePage(colliderId)) colliderRemovals++;
    }
    for (const child of [...entry.group.children]) {
      entry.group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const unsub of entry.unsubs.splice(0)) unsub();
    for (const material of entry.mats.splice(0)) {
      if (material === deps.materialController.sharedMaterial) continue;
      deps.materialController.materials.delete(material);
      material.material.dispose();
    }
  };

  const disposeEntry = (key: string, entry: ChunkGroupEntry): void => {
    deps.scene.remove(entry.group);
    clearEntryContent(entry);
    entries.delete(key);
    pending.delete(key);
    inflight.delete(key);
  };

  const ensureEntry = (key: string, job: Omit<PendingPageBuild, "startedAtMs">): ChunkGroupEntry => {
    const existing = entries.get(key);
    if (existing) return existing;
    const group = new THREE.Group();
    group.visible = false;
    deps.scene.add(group);
    const entry: ChunkGroupEntry = {
      group,
      mats: [],
      unsubs: [],
      colliderIds: [],
      ready: false,
      failed: false,
      validEmpty: false,
      centerX: job.centerX,
      centerZ: job.centerZ,
      lastTouchFrame: 0,
      voxelOverlayBounds: null,
    };
    entries.set(key, entry);
    pending.set(key, { ...job, startedAtMs: performance.now() });
    return entry;
  };

  const applyBuiltNode = (node: ClodPageNode, startedAtMs: number): void => {
    const entry = entries.get(node.id);
    if (!entry) return;
    const { px, pz } = parsePageGroupKey(node.id);
    clearEntryContent(entry);
    let meshCount = 0;
    if (node.chunkMeshes?.length === chunksPerPage * chunksPerPage) {
      node.chunkMeshes.forEach((chunkMesh, index) => {
        if (chunkMesh.indices.length === 0) return;
        const dx = index % chunksPerPage;
        const dz = Math.floor(index / chunksPerPage);
        meshCount++;
        addMesh(entry, chunkMesh, chunkColliderId(node.id, dx, dz), liveBubbleChunkFootprint(px, pz, dx, dz, chunksPerPage, chunkSize));
      });
    } else if (node.mesh.indices.length > 0) {
      meshCount++;
      addMesh(entry, node.mesh, pageColliderId(node.id), pageFootprint(px, pz, pageSize));
    }
    entry.ready = true;
    entry.failed = false;
    entry.validEmpty = meshCount === 0;
    slowestPageMs = Math.max(slowestPageMs, performance.now() - startedAtMs);
  };

  const drainPending = (): void => {
    if (inflight.size >= STREAM_INFLIGHT_BATCHES || pending.size === 0) return;
    const jobs = [...pending.entries()]
      .sort((a, b) => (entries.get(b[0])?.lastTouchFrame ?? -1) - (entries.get(a[0])?.lastTouchFrame ?? -1))
      .slice(0, chunkGroupBuildBudget);
    if (jobs.length === 0) return;
    inflight = new Set(jobs.map(([key]) => key));
    for (const [key] of jobs) pending.delete(key);
    void deps.buildStreamPages(jobs.map(([, job]) => ({ px: job.px, pz: job.pz, level: STREAM_PAGE_LEVEL }))).then((result) => {
      const nodesById = new Map(result.nodes.map((node) => [node.id, node]));
      for (const [key, job] of jobs) {
        const node = nodesById.get(key);
        const entry = entries.get(key);
        if (!entry) continue;
        if (node) applyBuiltNode(node, job.startedAtMs);
        else {
          entry.ready = true;
          entry.failed = true;
          entry.validEmpty = false;
        }
      }
    }).catch((error) => {
      console.warn(`[bubble] streamed live page build failed for ${jobs.length} page(s)`, error);
      for (const [key] of jobs) {
        const entry = entries.get(key);
        if (!entry) continue;
        entry.ready = true;
        entry.failed = true;
        entry.validEmpty = false;
      }
    }).finally(() => { inflight.clear(); });
  };

  const showReadyGroup = (entry: ChunkGroupEntry, fallbackMesh?: THREE.Mesh): boolean => {
    if (entry.ready && !entry.failed && entry.group.children.length > 0) {
      if (fallbackMesh) fallbackMesh.visible = false;
      entry.group.visible = true;
      return true;
    }
    entry.group.visible = false;
    return false;
  };

  const evictCache = (center: THREE.Vector3, radius: number): { evictions: number; colliderEvictions: number } => {
    let evictions = 0;
    let colliderEvictions = 0;
    const disposeAndCount = (key: string, entry: ChunkGroupEntry): void => {
      if (entry.colliderIds.length > 0) colliderEvictions++;
      disposeEntry(key, entry);
      evictions++;
    };
    for (const [key, entry] of [...entries.entries()]) {
      const dx = center.x - entry.centerX;
      const dz = center.z - entry.centerZ;
      const evictRadius = radius * deps.evictDistanceMultiplier;
      if (dx * dx + dz * dz > evictRadius * evictRadius) {
        disposeAndCount(key, entry);
      }
    }
    if (entries.size > deps.maxCachedChunkGroups) {
      const lru = [...entries.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame);
      while (entries.size > deps.maxCachedChunkGroups && lru.length > 0) {
        const [key, entry] = lru.shift()!;
        disposeAndCount(key, entry);
      }
    }
    return { evictions, colliderEvictions };
  };

  const countRequired = (coords: readonly { px: number; pz: number }[]) => {
    let readyPages = 0;
    let buildingPages = 0;
    let failedPages = 0;
    let colliderRequiredPages = 0;
    let colliderReadyPages = 0;
    let colliderSkippedPages = 0;
    for (const coord of coords) {
      const key = pageGroupKey(coord.px, coord.pz);
      const entry = entries.get(key);
      const needsCollider = colliderRadiusOverride === null || footprintIntersectsCircle(pageFootprint(coord.px, coord.pz, pageSize), currentCenter, colliderRadiusOverride);
      if (needsCollider) colliderRequiredPages++;
      if (!entry || !entry.ready) buildingPages++;
      else if (entry.failed) failedPages++;
      else if (pageEntryReady(entry)) {
        readyPages++;
        if (needsCollider && (entry.colliderIds.length > 0 || entry.validEmpty || !terrainColliders)) colliderReadyPages++;
        if (!needsCollider && entry.colliderIds.length === 0) colliderSkippedPages++;
      } else buildingPages++;
    }
    return { readyPages, buildingPages, failedPages, colliderRequiredPages, colliderReadyPages, colliderSkippedPages };
  };

  return {
    update(input: NearFieldBubbleUpdate): NearFieldBubbleStats {
      const startedAt = performance.now();
      currentFrame = input.frameId;
      currentCenter = input.bubbleCenter;
      let chunkGroupsBuiltThisFrame = 0;
      let evictions = 0;
      let colliderEvictions = 0;
      let requiredCoords: readonly PageCoord[] = [];

      if (input.enabled) {
        requiredCoords = requiredCoordCache.get(input.bubbleCenter, input.bubbleRadius, pageSize);
        for (const coord of requiredCoords) {
          const key = pageGroupKey(coord.px, coord.pz);
          let entry = entries.get(key);
          if (!entry) {
            if (chunkGroupsBuiltThisFrame >= chunkGroupBuildBudget) continue;
            entry = ensureEntry(key, coord);
            chunkGroupsBuiltThisFrame++;
          }
          entry.lastTouchFrame = currentFrame;
          showReadyGroup(entry);
        }

        for (const view of input.bubbleViews) {
          const owned = liveBubbleOwnsPageView(view.node, input.bubbleCenter, input.bubbleRadius, pageSize, view.target);
          const entry = entries.get(view.node.id);
          if (owned && entry) {
            entry.lastTouchFrame = currentFrame;
            if (!showReadyGroup(entry, view.mesh)) view.mesh.visible = view.fade > 0.001;
          } else {
            if (entry) entry.group.visible = false;
            view.mesh.visible = view.fade > 0.001;
          }
        }

        drainPending();
        const centerPage = `${Math.floor(input.bubbleCenter.x / pageSize)},${Math.floor(input.bubbleCenter.z / pageSize)}:${input.bubbleRadius}`;
        if (centerPage !== lastEvictionCenterPage || entries.size > deps.maxCachedChunkGroups) {
          lastEvictionCenterPage = centerPage;
          const evictStats = evictCache(input.bubbleCenter, input.bubbleRadius);
          evictions = evictStats.evictions;
          colliderEvictions = evictStats.colliderEvictions;
        }
      } else {
        for (const [key, entry] of entries) {
          entry.group.visible = false;
          const view = input.getView(key);
          if (view) view.mesh.visible = view.fade > 0.001;
        }
      }

      const required = countRequired(requiredCoords);
      let streamedColliderPages = 0;
      let validEmptyPages = 0;
      for (const entry of entries.values()) {
        if (entry.colliderIds.length > 0) streamedColliderPages++;
        if (entry.ready && !entry.failed && entry.validEmpty) validEmptyPages++;
      }
      return {
        chunkGroupsBuiltThisFrame,
        bubbleMs: performance.now() - startedAt,
        chunkGroupCount: entries.size,
        requiredPages: requiredCoords.length,
        readyPages: required.readyPages,
        buildingPages: required.buildingPages,
        failedPages: required.failedPages,
        evictions,
        colliderEvictions,
        streamedColliderPages,
        validEmptyPages,
        gpuRetryPages: 0,
        gpuRetriesTotal: 0,
        gpuTerminalFailuresTotal: 0,
        colliderRegistrations,
        colliderRemovals,
        gpuDispatchBudget: DEFAULT_GPU_CHUNK_DISPATCH_BUDGET,
        gpuMaxInflightChunks: DEFAULT_GPU_MAX_INFLIGHT_CHUNKS,
        pendingChunks: pending.size * chunksPerPage * chunksPerPage,
        inflightChunks: inflight.size * chunksPerPage * chunksPerPage,
        readyVisualPages: required.readyPages,
        avgChunkMs: 0,
        slowestPageMs,
        visualRequiredPages: requiredCoords.length,
        visualReadyPages: required.readyPages,
        colliderRequiredPages: required.colliderRequiredPages,
        colliderReadyPages: required.colliderReadyPages,
        colliderSkippedPages: required.colliderSkippedPages,
        cpuWorkUnitMaxMs: 0,
        gpuApplyMaxMs: 0,
      };
    },
    invalidatePage(nodeId: string): void {
      const entry = entries.get(nodeId);
      if (entry) disposeEntry(nodeId, entry);
    },
    replaceChunks(nodeId): void {
      const entry = entries.get(nodeId);
      if (entry) disposeEntry(nodeId, entry);
    },
    applyTint(enabled: boolean): void {
      const color = enabled ? 0xc94b4b : 0xffffff;
      for (const entry of entries.values()) for (const mat of entry.mats) mat.setBaseColor(color);
    },
    size: () => entries.size,
    chunkGroupValues: () => entries.values(),
    readyPageKeys: () => [...entries.entries()].filter(([, entry]) => pageEntryReady(entry)).map(([key]) => key).sort(),
    dispose(): void {
      for (const [key, entry] of [...entries.entries()]) disposeEntry(key, entry);
    },
  };
}
