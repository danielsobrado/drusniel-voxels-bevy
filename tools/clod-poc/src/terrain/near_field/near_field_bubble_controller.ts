import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { meshChunk, getDigEditsSnapshot } from "../../terrain/terrain.js";
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
const GPU_CHUNK_DISPATCH_BUDGET = 2;

export interface ChunkGroupEntry {
  group: THREE.Group;
  mats: TerrainMaterialHandle[];
  unsubs: Array<() => void>;
  colliderIds: string[];
  ready: boolean;
  failed: boolean;
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
  colliderRegistrations: number;
  colliderRemovals: number;
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
  applyTint(enabled: boolean): void;
  size(): number;
  chunkGroupValues(): Iterable<ChunkGroupEntry>;
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

export function resolveLiveBubbleBuildBudget(defaultBudget: number, params: URLSearchParams): number {
  const queryBudget = positiveIntegerParam(params, "liveBubbleBudget")
    ?? positiveIntegerParam(params, "live_bubble_budget");
  if (queryBudget !== null) return Math.max(1, queryBudget);

  if (params.get("scene") === INFINITE_ISLANDS_SCENE) return INFINITE_ISLANDS_DEFAULT_BUILD_BUDGET;

  const fallback = Number.isFinite(defaultBudget) && defaultBudget > 0 ? Math.floor(defaultBudget) : 1;
  return Math.max(1, fallback);
}

function liveBubbleBuildBudget(defaultBudget: number): number {
  if (typeof window === "undefined") return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams());
  return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams(window.location.search));
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

export function createNearFieldBubbleController(deps: NearFieldBubbleControllerDeps): NearFieldBubbleController {
  const P = deps.cfg.page.chunks_per_page;
  const S = deps.cfg.page.chunk_size;
  const pageSize = P * S;
  const liveStreamingEnabled = deps.streamingLiveTerrain ?? true;
  const chunkGroupBuildBudget = liveBubbleBuildBudget(deps.chunkGroupBuildBudget);
  const chunkGroups = new Map<string, ChunkGroupEntry>();
  const cpuPendingBuilds = new Map<string, PendingCpuPageBuild>();
  const gpuWaitBuilds = new Map<string, PendingGpuWaitPageBuild>();
  const gpuPendingBuilds = new Map<string, PendingGpuPageBuild>();
  const terrainColliders = deps.terrainColliders ?? null;
  let colliderRegistrations = 0;
  let colliderRemovals = 0;

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

  const addChunkMesh = (
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    colliderIds: string[],
    cm: PageMesh | ChunkMesh,
    colliderId: string,
    footprint: TerrainColliderFootprint,
  ) => {
    const mat = buildChunkMaterial();
    const geometry = toGeometry(cm);
    const mesh = new THREE.Mesh(geometry, mat.material);
    unsubs.push(mat.onMaterialChanged((material) => {
      mesh.material = material;
    }));
    group.add(mesh);
    mats.push(mat);
    if (cm.indices.length > 0 && terrainColliders) {
      terrainColliders.upsertPage({ id: colliderId, geometry, footprint });
      colliderIds.push(colliderId);
      colliderRegistrations++;
    }
  };

  const disposeEntry = (nodeId: string, entry: ChunkGroupEntry) => {
    deps.scene.remove(entry.group);
    for (const colliderId of entry.colliderIds) {
      if (terrainColliders?.removePage(colliderId)) colliderRemovals++;
    }
    for (const child of entry.group.children) (child as THREE.Mesh).geometry.dispose();
    for (const unsub of entry.unsubs) unsub();
    for (const m of entry.mats) {
      if (m === deps.materialController.sharedMaterial) continue;
      deps.materialController.materials.delete(m);
      m.material.dispose();
    }
    chunkGroups.delete(nodeId);
    cpuPendingBuilds.delete(nodeId);
    gpuWaitBuilds.delete(nodeId);
    gpuPendingBuilds.delete(nodeId);
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

  const enqueueGpuPageBuild = (key: string, px: number, pz: number, worldBounds: WorldBounds): void => {
    const edits = resolveDigEdits(getDigEditsSnapshot());
    gpuPendingBuilds.set(key, { px, pz, worldBounds, edits, chunks: pageChunks(), inflight: 0, failures: 0 });
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
    const gpuMesher = deps.getGpuMesher();

    if (gpuMesher) {
      const entry = createDeferredEntry(key, group, mats, unsubs, colliderIds, centerX, centerZ);
      enqueueGpuPageBuild(key, px, pz, worldBounds);
      return entry;
    }

    if (liveStreamingEnabled) {
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

  const completeGpuChunk = (key: string, entry: ChunkGroupEntry, job: PendingGpuPageBuild) => {
    job.inflight--;
    if (chunkGroups.get(key) !== entry || gpuPendingBuilds.get(key) !== job) return;
    if (job.chunks.length > 0 || job.inflight > 0) return;
    gpuPendingBuilds.delete(key);
    if (cpuPendingBuilds.has(key)) return;
    entry.failed = job.failures > 0;
    entry.ready = true;
  };

  const drainGpuPendingBuilds = () => {
    let dispatched = 0;
    const jobs = [...gpuPendingBuilds.entries()]
      .sort((a, b) => (chunkGroups.get(b[0])?.lastTouchFrame ?? -1) - (chunkGroups.get(a[0])?.lastTouchFrame ?? -1));
    for (const [key, job] of jobs) {
      const entry = chunkGroups.get(key);
      const gpuMesher = deps.getGpuMesher();
      if (!entry || !gpuMesher) {
        gpuPendingBuilds.delete(key);
        continue;
      }
      while (job.chunks.length > 0 && dispatched < GPU_CHUNK_DISPATCH_BUDGET) {
        const [dx, dz] = job.chunks.shift()!;
        job.inflight++;
        dispatched++;
        gpuMesher.meshChunk(job.px * P + dx, job.pz * P + dz, job.worldBounds, job.edits)
          .then((cm) => {
            if (chunkGroups.get(key) === entry && gpuPendingBuilds.get(key) === job) {
              if (cm.indices.length > 0) {
                addChunkMesh(
                  entry.group,
                  entry.mats,
                  entry.unsubs,
                  entry.colliderIds,
                  cm,
                  chunkColliderId(key, dx, dz),
                  liveBubbleChunkFootprint(job.px, job.pz, dx, dz, P, S),
                );
              } else if (terrainColliders) {
                enqueueCpuChunkBuild(key, job.px, job.pz, job.worldBounds, dx, dz);
              }
            }
            completeGpuChunk(key, entry, job);
          })
          .catch(() => {
            if (chunkGroups.get(key) === entry && gpuPendingBuilds.get(key) === job) job.failures++;
            completeGpuChunk(key, entry, job);
          });
      }
      if (dispatched >= GPU_CHUNK_DISPATCH_BUDGET) return;
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
        );
      } catch (error) {
        job.failures++;
        console.error(`[bubble] CPU chunk meshing failed for page ${key} chunk (${dx},${dz})`, error);
      }
      if (job.chunks.length === 0) {
        cpuPendingBuilds.delete(key);
        if (!gpuPendingBuilds.has(key)) {
          entry.failed = job.failures > 0;
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

  const countRequiredPages = (requiredCoords: PageCoord[]) => {
    let readyPages = 0;
    let buildingPages = 0;
    let failedPages = 0;
    for (const coord of requiredCoords) {
      const entry = chunkGroups.get(pageGroupKey(coord.px, coord.pz));
      if (!entry) {
        buildingPages++;
        continue;
      }
      if (entry.failed) failedPages++;
      else if (!entry.ready) buildingPages++;
      else readyPages++;
    }
    return { readyPages, buildingPages, failedPages };
  };

  return {
    update(input) {
      const tBubbleStart = performance.now();
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
      const required = countRequiredPages(requiredCoords);
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
        colliderRegistrations,
        colliderRemovals,
      };
    },
    invalidatePage(nodeId) {
      const entry = chunkGroups.get(nodeId);
      if (!entry) return;
      disposeEntry(nodeId, entry);
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
    dispose() {
      for (const [nodeId, entry] of [...chunkGroups.entries()]) {
        disposeEntry(nodeId, entry);
      }
    },
  };
}
