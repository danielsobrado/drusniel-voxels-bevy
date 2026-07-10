import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { meshChunk, getDigEditsSnapshot, voxelEditsRequireCpuDerivedMeshing } from "../../terrain/terrain.js";
import { resolveDigEdits } from "../../gpu/terrain_field_core.js";
import type { ChunkMesh, GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import { toGeometry } from "../geometry/page_geometry.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import type { TerrainMaterialController } from "../material/terrain_material_controller.js";
import type { TerrainMaterialHandle } from "../../rendering/terrain_material.js";
import type { TerrainColliderFootprint, TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { WorldBounds } from "../../terrain/terrain_surface.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_ISLANDS_DEFAULT_BUILD_BUDGET = 1;
/** Per-frame budget for CPU-fallback chunk meshing; one chunk can cost 10–90 ms, so at most one runs once the budget is spent. */
const CPU_CHUNK_MESH_BUDGET_MS = 6;
const DEFAULT_GPU_CHUNK_DISPATCH_BUDGET = 2;
const DEFAULT_GPU_MAX_INFLIGHT_CHUNKS = Number.MAX_SAFE_INTEGER;
const GPU_PAGE_RETRY_LIMIT = 3;
const GPU_PAGE_RETRY_DELAY_FRAMES = 12;

export interface ChunkGroupEntry {
  group: THREE.Group;
  mats: TerrainMaterialHandle[];
  unsubs: Array<() => void>;
  colliderIds: string[];
  ready: boolean;
  failed: boolean;
  validEmpty: boolean;
  centerX: number;
  centerZ: number;
  lastTouchFrame: number;
}

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

interface PageCoord {
  px: number;
  pz: number;
  centerX: number;
  centerZ: number;
}

interface PendingCpuPageBuild {
  px: number;
  pz: number;
  worldBounds: WorldBounds;
  chunks: Array<[number, number]>;
  failures: number;
}

interface PendingGpuPageBuild {
  px: number;
  pz: number;
  worldBounds: WorldBounds;
  edits: ReturnType<typeof resolveDigEdits>;
  chunks: Array<[number, number]>;
  inflight: number;
  failures: number;
  attempts: number;
  nextRetryFrame: number;
  meshChunks: number;
  emptyChunks: number;
  startedAtMs: number;
}

interface PendingGpuWaitPageBuild {
  px: number;
  pz: number;
}

function pageGroupKey(px: number, pz: number): string {
  return `L0:${px},${pz}`;
}

function chunkColliderId(pageKey: string, dx: number, dz: number): string {
  return `${pageKey}:chunk:${dx},${dz}`;
}

export function liveBubbleChunkFootprint(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  chunksPerPage: number,
  chunkSize: number,
): TerrainColliderFootprint {
  const minX = (px * chunksPerPage + dx) * chunkSize;
  const minZ = (pz * chunksPerPage + dz) * chunkSize;
  return { minX, minZ, maxX: minX + chunkSize, maxZ: minZ + chunkSize };
}

function parsePageGroupKey(key: string): { px: number; pz: number } {
  const [, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(px) || !Number.isInteger(pz)) throw new Error(`Invalid page key ${key}`);
  return { px, pz };
}

function pageIntersectsFiniteWorld(px: number, pz: number, pageSize: number, world: WorldBounds): boolean {
  if (world.finite === false) return true;
  const minX = px * pageSize;
  const maxX = minX + pageSize;
  const minZ = pz * pageSize;
  const maxZ = minZ + pageSize;
  return maxX > 0 && minX < world.cellsX && maxZ > 0 && minZ < world.cellsZ;
}

function positiveIntegerParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function positiveNumberParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveLiveBubbleBuildBudget(defaultBudget: number, params: URLSearchParams): number {
  const queryBudget = positiveIntegerParam(params, "liveBubbleBudget")
    ?? positiveIntegerParam(params, "live_bubble_budget");
  if (queryBudget !== null) return Math.max(1, queryBudget);

  if (params.get("scene") === INFINITE_ISLANDS_SCENE) return INFINITE_ISLANDS_DEFAULT_BUILD_BUDGET;

  const fallback = Number.isFinite(defaultBudget) && defaultBudget > 0 ? Math.floor(defaultBudget) : 1;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleGpuChunkBudget(defaultBudget: number, params: URLSearchParams): number {
  const queryBudget = positiveIntegerParam(params, "liveBubbleGpuChunkBudget")
    ?? positiveIntegerParam(params, "live_bubble_gpu_chunk_budget");
  if (queryBudget !== null) return Math.max(1, queryBudget);
  const fallback = Number.isFinite(defaultBudget) && defaultBudget > 0 ? Math.floor(defaultBudget) : DEFAULT_GPU_CHUNK_DISPATCH_BUDGET;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleMaxInflightChunks(defaultMax: number, params: URLSearchParams): number {
  const queryMax = positiveIntegerParam(params, "liveBubbleMaxInflightChunks")
    ?? positiveIntegerParam(params, "live_bubble_max_inflight_chunks");
  if (queryMax !== null) return Math.max(1, queryMax);
  const fallback = Number.isFinite(defaultMax) && defaultMax > 0 ? Math.floor(defaultMax) : DEFAULT_GPU_MAX_INFLIGHT_CHUNKS;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleColliderRadius(params: URLSearchParams): number | null {
  return positiveNumberParam(params, "liveBubbleColliderRadius")
    ?? positiveNumberParam(params, "live_bubble_collider_radius");
}

function liveBubbleBuildBudget(defaultBudget: number): number {
  if (typeof window === "undefined") return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams());
  return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams(window.location.search));
}

function liveBubbleGpuChunkBudget(): number {
  if (typeof window === "undefined") return resolveLiveBubbleGpuChunkBudget(DEFAULT_GPU_CHUNK_DISPATCH_BUDGET, new URLSearchParams());
  return resolveLiveBubbleGpuChunkBudget(DEFAULT_GPU_CHUNK_DISPATCH_BUDGET, new URLSearchParams(window.location.search));
}

function liveBubbleMaxInflightChunks(): number {
  if (typeof window === "undefined") return resolveLiveBubbleMaxInflightChunks(DEFAULT_GPU_MAX_INFLIGHT_CHUNKS, new URLSearchParams());
  return resolveLiveBubbleMaxInflightChunks(DEFAULT_GPU_MAX_INFLIGHT_CHUNKS, new URLSearchParams(window.location.search));
}

function liveBubbleColliderRadiusOverride(): number | null {
  if (typeof window === "undefined") return null;
  return resolveLiveBubbleColliderRadius(new URLSearchParams(window.location.search));
}

export function requiredStreamingPageCoords(
  center: THREE.Vector3,
  bubbleRadius: number,
  pageSize: number,
): PageCoord[] {
  const minPx = Math.floor((center.x - bubbleRadius) / pageSize);
  const maxPx = Math.floor((center.x + bubbleRadius) / pageSize);
  const minPz = Math.floor((center.z - bubbleRadius) / pageSize);
  const maxPz = Math.floor((center.z + bubbleRadius) / pageSize);
  const halfDiag = pageSize * Math.SQRT2 * 0.5;
  const coords: PageCoord[] = [];

  for (let px = minPx; px <= maxPx; px++) {
    for (let pz = minPz; pz <= maxPz; pz++) {
      const centerX = (px + 0.5) * pageSize;
      const centerZ = (pz + 0.5) * pageSize;
      if (Math.hypot(center.x - centerX, center.z - centerZ) <= bubbleRadius + halfDiag) {
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
  return Math.hypot(bubbleCenter.x - centerX, bubbleCenter.z - centerZ) <= bubbleRadius + halfDiag;
}

function footprintIntersectsCircle(
  footprint: TerrainColliderFootprint,
  center: THREE.Vector3,
  radius: number,
): boolean {
  const closestX = THREE.MathUtils.clamp(center.x, footprint.minX, footprint.maxX);
  const closestZ = THREE.MathUtils.clamp(center.z, footprint.minZ, footprint.maxZ);
  return Math.hypot(center.x - closestX, center.z - closestZ) <= radius;
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

  const pageCenter = (node: ClodPageNode): [number, number] => [
    (node.footprint.minX + node.footprint.maxX) / 2,
    (node.footprint.minZ + node.footprint.maxZ) / 2,
  ];

  const buildChunkMaterial = (): TerrainMaterialHandle => {
    const mat = deps.materialController.makeTerrainMaterial(deps.getTintBubble() ? 0xc94b4b : 0xffffff);
    deps.materialController.configureChunkMaterial(mat);
    return mat;
  };

  const buildWorldBoundsForPage = (px: number, pz: number): WorldBounds => {
    if (!liveStreamingEnabled) return deps.worldBounds;
    if (pageIntersectsFiniteWorld(px, pz, pageSize, deps.worldBounds)) return deps.worldBounds;
    return { ...deps.worldBounds, finite: false };
  };

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

  const gpuRetryPages = (): number => {
    let total = 0;
    for (const job of gpuPendingBuilds.values()) {
      if (job.attempts > 0 || currentFrame < job.nextRetryFrame) total++;
    }
    return total;
  };

  const addChunkMesh = (
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    colliderIds: string[],
    cm: PageMesh | ChunkMesh,
    colliderId: string,
    footprint: TerrainColliderFootprint,
    localIndex: number,
  ) => {
    const mat = buildChunkMaterial();
    const geometry = toGeometry(cm);
    const mesh = new THREE.Mesh(geometry, mat.material);
    const unsub = mat.onMaterialChanged((material) => {
      mesh.material = material;
    });
    unsubs.push(unsub);
    mesh.userData["liveChunkIndex"] = localIndex;
    mesh.userData["liveChunkMaterial"] = mat;
    mesh.userData["liveChunkUnsub"] = unsub;
    group.add(mesh);
    mats.push(mat);
    const colliderAllowed = currentColliderRadius === null
      || footprintIntersectsCircle(footprint, currentBubbleCenter, currentColliderRadius);
    if (cm.indices.length > 0 && terrainColliders && colliderAllowed) {
      terrainColliders.upsertPage({ id: colliderId, geometry, footprint });
      if (!colliderIds.includes(colliderId)) colliderIds.push(colliderId);
      colliderRegistrations++;
    }
  };

  const disposeChunkMesh = (nodeId: string, entry: ChunkGroupEntry, mesh: THREE.Mesh, removeCollider: boolean): void => {
    const localIndex = Number(mesh.userData["liveChunkIndex"]);
    const mat = mesh.userData["liveChunkMaterial"] as TerrainMaterialHandle | undefined;
    const unsub = mesh.userData["liveChunkUnsub"] as (() => void) | undefined;
    entry.group.remove(mesh);
    mesh.geometry.dispose();
    if (unsub) {
      unsub();
      const index = entry.unsubs.indexOf(unsub);
      if (index >= 0) entry.unsubs.splice(index, 1);
    }
    if (mat) {
      const index = entry.mats.indexOf(mat);
      if (index >= 0) entry.mats.splice(index, 1);
      if (mat !== deps.materialController.sharedMaterial) {
        deps.materialController.materials.delete(mat);
        mat.material.dispose();
      }
    }
    if (removeCollider && Number.isInteger(localIndex)) {
      const dx = localIndex % P;
      const dz = (localIndex / P) | 0;
      const colliderId = chunkColliderId(nodeId, dx, dz);
      if (terrainColliders?.removePage(colliderId)) colliderRemovals++;
      const colliderIndex = entry.colliderIds.indexOf(colliderId);
      if (colliderIndex >= 0) entry.colliderIds.splice(colliderIndex, 1);
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
    for (const m of entry.mats.splice(0)) {
      if (m === deps.materialController.sharedMaterial) continue;
      deps.materialController.materials.delete(m);
      m.material.dispose();
    }
  };

  const disposeEntry = (nodeId: string, entry: ChunkGroupEntry) => {
    deps.scene.remove(entry.group);
    clearEntryContent(entry);
    chunkGroups.delete(nodeId);
    cpuPendingBuilds.delete(nodeId);
    gpuWaitBuilds.delete(nodeId);
    gpuPendingBuilds.delete(nodeId);
    pageRevisions.delete(nodeId);
  };

  const createDeferredEntry = (
    key: string,
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    colliderIds: string[],
    centerX: number,
    centerZ: number,
  ): ChunkGroupEntry => {
    group.visible = false;
    deps.scene.add(group);
    const entry: ChunkGroupEntry = {
      group,
      mats,
      unsubs,
      colliderIds,
      ready: false,
      failed: false,
      validEmpty: false,
      centerX,
      centerZ,
      lastTouchFrame: 0,
    };
    chunkGroups.set(key, entry);
    return entry;
  };

  const pageChunks = (): Array<[number, number]> => {
    const chunks: Array<[number, number]> = [];
    for (let dz = 0; dz < P; dz++) {
      for (let dx = 0; dx < P; dx++) chunks.push([dx, dz]);
    }
    return chunks;
  };

  const enqueueGpuPageBuild = (
    key: string,
    px: number,
    pz: number,
    worldBounds: WorldBounds,
    attempts = 0,
    nextRetryFrame = 0,
  ): void => {
    const edits = resolveDigEdits(getDigEditsSnapshot());
    gpuPendingBuilds.set(key, {
      px,
      pz,
      worldBounds,
      edits,
      chunks: pageChunks(),
      inflight: 0,
      failures: 0,
      attempts,
      nextRetryFrame,
      meshChunks: 0,
      emptyChunks: 0,
      startedAtMs: performance.now(),
    });
  };

  const enqueueCpuChunkBuild = (key: string, px: number, pz: number, worldBounds: WorldBounds, dx: number, dz: number): void => {
    const existing = cpuPendingBuilds.get(key);
    if (existing) {
      existing.chunks.push([dx, dz]);
      return;
    }
    cpuPendingBuilds.set(key, { px, pz, worldBounds, chunks: [[dx, dz]], failures: 0 });
  };

  const ensureChunkGroupForPage = (key: string, px: number, pz: number, centerX: number, centerZ: number): ChunkGroupEntry => {
    const existing = chunkGroups.get(key);
    if (existing) return existing;
    const group = new THREE.Group();
    const mats: TerrainMaterialHandle[] = [];
    const unsubs: Array<() => void> = [];
    const colliderIds: string[] = [];
    const worldBounds = buildWorldBoundsForPage(px, pz);
    const requiresCpuMeshing = voxelEditsRequireCpuDerivedMeshing();
    const gpuMesher = requiresCpuMeshing ? null : deps.getGpuMesher();

    if (gpuMesher) {
      const entry = createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ);
      enqueueGpuPageBuild(key, px, pz, worldBounds);
      return entry;
    }

    if (liveStreamingEnabled && !requiresCpuMeshing) {
      const entry = createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ);
      gpuWaitBuilds.set(key, { px, pz });
      return entry;
    }

    // CPU fallback: never mesh a whole page synchronously — queue the chunks
    // and drain them in update() under a per-frame budget. The entry follows
    // the same deferred-ready contract as the GPU path.
    const entry = createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ);
    cpuPendingBuilds.set(key, { px, pz, worldBounds, chunks: pageChunks(), failures: 0 });
    return entry;
  };

  const promoteGpuWaitBuilds = () => {
    if (gpuWaitBuilds.size === 0 || !deps.getGpuMesher()) return;
    const jobs = [...gpuWaitBuilds.entries()]
      .sort((a, b) => (chunkGroups.get(b[0])?.lastTouchFrame ?? -1) - (chunkGroups.get(a[0])?.lastTouchFrame ?? -1));
    for (const [key, job] of jobs) {
      const entry = chunkGroups.get(key);
      gpuWaitBuilds.delete(key);
      if (!entry || entry.ready || entry.failed || gpuPendingBuilds.has(key)) continue;
      enqueueGpuPageBuild(key, job.px, job.pz, buildWorldBoundsForPage(job.px, job.pz));
    }
  };

  const retryGpuPageBuild = (key: string, entry: ChunkGroupEntry, job: PendingGpuPageBuild): boolean => {
    if (!liveStreamingEnabled || job.attempts >= GPU_PAGE_RETRY_LIMIT) return false;
    clearEntryContent(entry);
    entry.ready = false;
    entry.failed = false;
    entry.validEmpty = false;
    gpuRetriesTotal++;
    enqueueGpuPageBuild(key, job.px, job.pz, job.worldBounds, job.attempts + 1, currentFrame + GPU_PAGE_RETRY_DELAY_FRAMES);
    return true;
  };

  const completeGpuChunk = (key: string, entry: ChunkGroupEntry, job: PendingGpuPageBuild) => {
    job.inflight--;
    if (chunkGroups.get(key) !== entry || gpuPendingBuilds.get(key) !== job) return;
    if (job.chunks.length > 0 || job.inflight > 0) return;
    gpuPendingBuilds.delete(key);
    if (cpuPendingBuilds.has(key)) return;

    if (job.failures > 0 && retryGpuPageBuild(key, entry, job)) return;
    if (job.failures > 0) gpuTerminalFailuresTotal++;
    entry.failed = job.failures > 0;
    entry.validEmpty = job.failures === 0 && job.meshChunks === 0;
    entry.ready = true;
    slowestPageMs = Math.max(slowestPageMs, performance.now() - job.startedAtMs);
  };

  const countGpuInflightChunks = (): number => {
    let inflightChunks = 0;
    for (const job of gpuPendingBuilds.values()) inflightChunks += job.inflight;
    return inflightChunks;
  };

  const drainGpuPendingBuilds = () => {
    let dispatched = 0;
    let inflightChunks = countGpuInflightChunks();
    const jobs = [...gpuPendingBuilds.entries()]
      .sort((a, b) => (chunkGroups.get(b[0])?.lastTouchFrame ?? -1) - (chunkGroups.get(a[0])?.lastTouchFrame ?? -1));
    for (const [key, job] of jobs) {
      if (inflightChunks >= gpuMaxInflightChunks) return;
      if (currentFrame < job.nextRetryFrame) continue;
      const entry = chunkGroups.get(key);
      const gpuMesher = deps.getGpuMesher();
      if (!entry) {
        gpuPendingBuilds.delete(key);
        continue;
      }
      if (!gpuMesher) {
        if (job.inflight === 0) {
          gpuPendingBuilds.delete(key);
          entry.ready = false;
          entry.failed = false;
          entry.validEmpty = false;
          gpuWaitBuilds.set(key, { px: job.px, pz: job.pz });
        }
        continue;
      }
      while (job.chunks.length > 0 && dispatched < gpuChunkDispatchBudget && inflightChunks < gpuMaxInflightChunks) {
        const [dx, dz] = job.chunks.shift()!;
        job.inflight++;
        dispatched++;
        inflightChunks++;
        const chunkStartedAt = performance.now();
        gpuMesher.meshChunk(job.px * P + dx, job.pz * P + dz, job.worldBounds, job.edits)
          .then((cm) => {
            totalChunkMs += performance.now() - chunkStartedAt;
            completedChunks++;
            if (chunkGroups.get(key) === entry && gpuPendingBuilds.get(key) === job) {
              if (cm.indices.length > 0) {
                job.meshChunks++;
                addChunkMesh(
                  entry.group,
                  entry.mats,
                  entry.unsubs,
                  entry.colliderIds,
                  cm,
                  chunkColliderId(key, dx, dz),
                  liveBubbleChunkFootprint(job.px, job.pz, dx, dz, P, S),
                  dz * P + dx,
                );
              } else {
                job.emptyChunks++;
                if (terrainColliders && !liveStreamingEnabled) {
                  enqueueCpuChunkBuild(key, job.px, job.pz, job.worldBounds, dx, dz);
                }
              }
            }
            completeGpuChunk(key, entry, job);
          })
          .catch(() => {
            totalChunkMs += performance.now() - chunkStartedAt;
            completedChunks++;
            if (chunkGroups.get(key) === entry && gpuPendingBuilds.get(key) === job) job.failures++;
            completeGpuChunk(key, entry, job);
          });
      }
      if (dispatched >= gpuChunkDispatchBudget || inflightChunks >= gpuMaxInflightChunks) return;
    }
  };

  const drainCpuPendingBuilds = (tBubbleStart: number) => {
    while (cpuPendingBuilds.size > 0) {
      const next = cpuPendingBuilds.entries().next().value as [string, PendingCpuPageBuild];
      const [key, job] = next;
      const entry = chunkGroups.get(key);
      if (!entry || job.chunks.length === 0) {
        cpuPendingBuilds.delete(key);
        continue;
      }
      const [dx, dz] = job.chunks.shift()!;
      try {
        addChunkMesh(
          entry.group,
          entry.mats,
          entry.unsubs,
          entry.colliderIds,
          meshChunk(job.px * P + dx, job.pz * P + dz, deps.cfg, job.worldBounds),
          chunkColliderId(key, dx, dz),
          liveBubbleChunkFootprint(job.px, job.pz, dx, dz, P, S),
          dz * P + dx,
        );
      } catch (error) {
        job.failures++;
        console.error(`[bubble] CPU chunk meshing failed for page ${key} chunk (${dx},${dz})`, error);
      }
      if (job.chunks.length === 0) {
        cpuPendingBuilds.delete(key);
        if (!gpuPendingBuilds.has(key)) {
          entry.failed = job.failures > 0;
          entry.validEmpty = job.failures === 0 && entry.group.children.length === 0;
          entry.ready = true;
        }
      }
      if (performance.now() - tBubbleStart >= CPU_CHUNK_MESH_BUDGET_MS) return;
    }
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
      const dist = Math.hypot(bubbleCenter.x - entry.centerX, bubbleCenter.z - entry.centerZ);
      if (dist > bubbleRadius * deps.evictDistanceMultiplier) {
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

  const showReadyGroup = (entry: ChunkGroupEntry, fallbackMesh?: THREE.Mesh): boolean => {
    if (entry.ready && !entry.failed && entry.group.children.length > 0) {
      if (fallbackMesh) fallbackMesh.visible = false;
      entry.group.visible = true;
      return true;
    }
    entry.group.visible = false;
    return false;
  };

  const pageEntryReady = (entry: ChunkGroupEntry): boolean =>
    entry.ready && !entry.failed && (entry.group.children.length > 0 || entry.colliderIds.length > 0 || entry.validEmpty);

  const countGpuChunks = (): { pendingChunks: number; inflightChunks: number } => {
    let pendingChunks = 0;
    let inflightChunks = 0;
    for (const job of gpuPendingBuilds.values()) {
      pendingChunks += job.chunks.length;
      inflightChunks += job.inflight;
    }
    for (const job of cpuPendingBuilds.values()) pendingChunks += job.chunks.length;
    return { pendingChunks, inflightChunks };
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
      currentFrame = input.frameId;
      currentBubbleCenter = input.bubbleCenter;
      currentColliderRadius = colliderRadiusOverride;
      let chunkGroupsBuiltThisFrame = 0;
      let evictions = 0;
      let colliderEvictions = 0;
      let requiredCoords: PageCoord[] = [];
      if (input.enabled) {
        if (liveStreamingEnabled) {
          requiredCoords = requiredStreamingPageCoords(input.bubbleCenter, input.bubbleRadius, pageSize);
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

        promoteGpuWaitBuilds();
        drainGpuPendingBuilds();
        drainCpuPendingBuilds(tBubbleStart);
        const evictStats = evictColliderBearingCache(input.bubbleCenter, input.bubbleRadius);
        evictions = evictStats.evictions;
        colliderEvictions = evictStats.colliderEvictions;
      } else if (chunkGroups.size > 0) {
        for (const [nodeId, { group }] of chunkGroups) {
          group.visible = false;
          const view = input.getView(nodeId);
          if (view) view.mesh.visible = view.fade > 0.001;
        }
      }
      const required = countRequiredPages(requiredCoords, currentColliderRadius);
      const chunkCounts = countGpuChunks();
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
        gpuRetryPages: gpuRetryPages(),
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
          addChunkMesh(
            entry.group,
            entry.mats,
            entry.unsubs,
            entry.colliderIds,
            chunkMesh,
            chunkColliderId(nodeId, dx, dz),
            liveBubbleChunkFootprint(px, pz, dx, dz, P, S),
            localIndex,
          );
          if (oldMesh) disposeChunkMesh(nodeId, entry, oldMesh, false);
        } else if (oldMesh) {
          disposeChunkMesh(nodeId, entry, oldMesh, true);
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
