import * as THREE from "three";
import type { ClodPagesConfig } from "../config.js";
import { meshChunk, getDigEditsSnapshot } from "../terrain.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import type { GpuChunkMesher } from "../gpu/gpu_chunk_mesher.js";
import { toGeometry } from "./page_geometry.js";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { TerrainMaterialController } from "./terrain_material_controller.js";
import type { TerrainMaterialHandle } from "../rendering/terrain_material.js";

export interface ChunkGroupEntry {
  group: THREE.Group;
  mats: TerrainMaterialHandle[];
  unsubs: Array<() => void>;
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
}

export interface NearFieldBubbleControllerDeps {
  scene: THREE.Scene;
  materialController: TerrainMaterialController;
  cfg: ClodPagesConfig;
  worldBounds: { cellsX: number; cellsZ: number };
  getTintBubble: () => boolean;
  getGpuMesher: () => GpuChunkMesher | null;
  chunkGroupBuildBudget: number;
  maxCachedChunkGroups: number;
  evictDistanceMultiplier: number;
}

export interface NearFieldBubbleController {
  update(input: NearFieldBubbleUpdate): NearFieldBubbleStats;
  invalidatePage(nodeId: string): void;
  applyTint(enabled: boolean): void;
  size(): number;
  chunkGroupValues(): Iterable<ChunkGroupEntry>;
  dispose(): void;
}

export function createNearFieldBubbleController(deps: NearFieldBubbleControllerDeps): NearFieldBubbleController {
  const P = deps.cfg.page.chunks_per_page;
  const chunkGroups = new Map<string, ChunkGroupEntry>();

  const pageCenter = (node: ClodPageNode): [number, number] => [
    (node.footprint.minX + node.footprint.maxX) / 2,
    (node.footprint.minZ + node.footprint.maxZ) / 2,
  ];

  const buildChunkMaterial = (): TerrainMaterialHandle => {
    const mat = deps.materialController.makeTerrainMaterial(deps.getTintBubble() ? 0xc94b4b : 0xffffff);
    deps.materialController.configureChunkMaterial(mat);
    return mat;
  };

  const addChunkMesh = (
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    cm: PageMesh,
  ) => {
    const mat = buildChunkMaterial();
    const mesh = new THREE.Mesh(toGeometry(cm), mat.material);
    unsubs.push(mat.onMaterialChanged((material) => {
      mesh.material = material;
    }));
    group.add(mesh);
    mats.push(mat);
  };

  const disposeEntry = (nodeId: string, entry: ChunkGroupEntry) => {
    deps.scene.remove(entry.group);
    for (const child of entry.group.children) (child as THREE.Mesh).geometry.dispose();
    for (const unsub of entry.unsubs) unsub();
    for (const m of entry.mats) {
      if (m === deps.materialController.sharedMaterial) continue;
      deps.materialController.materials.delete(m);
      m.material.dispose();
    }
    chunkGroups.delete(nodeId);
  };

  const cpuFallbackChunks = (
    node: ClodPageNode,
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    failedCoords: Array<[number, number]>,
  ): number => {
    const [px, pz] = node.id.slice(3).split(",").map(Number);
    let recovered = 0;
    for (const [dx, dz] of failedCoords) {
      try {
        addChunkMesh(group, mats, unsubs, meshChunk(px * P + dx, pz * P + dz, deps.cfg, deps.worldBounds));
        recovered++;
      } catch (error) {
        console.error(`[bubble] CPU fallback failed for page ${node.id} chunk (${dx},${dz})`, error);
      }
    }
    return recovered;
  };

  const ensureChunkGroup = (node: ClodPageNode): ChunkGroupEntry => {
    const existing = chunkGroups.get(node.id);
    if (existing) return existing;
    const [px, pz] = node.id.slice(3).split(",").map(Number);
    const [centerX, centerZ] = pageCenter(node);
    const group = new THREE.Group();
    const mats: TerrainMaterialHandle[] = [];
    const unsubs: Array<() => void> = [];
    const gpuMesher = deps.getGpuMesher();

    if (gpuMesher) {
      const entry: ChunkGroupEntry = {
        group,
        mats,
        unsubs,
        ready: false,
        failed: false,
        centerX,
        centerZ,
        lastTouchFrame: 0,
      };
      group.visible = false;
      deps.scene.add(group);
      chunkGroups.set(node.id, entry);
      const edits = resolveDigEdits(getDigEditsSnapshot());
      let pending = P * P;
      const failedCoords: Array<[number, number]> = [];
      const settle = () => {
        if (--pending !== 0) return;
        if (failedCoords.length > 0) {
          console.error(
            `[bubble] GPU chunk meshing failed for page ${node.id}: ${failedCoords.length}/${P * P} chunks`,
          );
          const recovered = cpuFallbackChunks(node, group, mats, unsubs, failedCoords);
          const expectedMeshes = P * P;
          entry.failed = group.children.length < expectedMeshes;
          if (recovered > 0 && entry.failed) {
            console.warn(
              `[bubble] partial CPU fallback for page ${node.id}: ${group.children.length}/${expectedMeshes} chunks`,
            );
          }
        }
        entry.ready = true;
      };
      for (let dz = 0; dz < P; dz++) {
        for (let dx = 0; dx < P; dx++) {
          gpuMesher.meshChunk(px * P + dx, pz * P + dz, deps.worldBounds, edits)
            .then((cm) => {
              if (chunkGroups.get(node.id) !== entry) return;
              if (cm.indices.length > 0) addChunkMesh(group, mats, unsubs, cm);
              settle();
            })
            .catch(() => {
              if (chunkGroups.get(node.id) !== entry) return;
              failedCoords.push([dx, dz]);
              settle();
            });
        }
      }
      return entry;
    }

    for (let dz = 0; dz < P; dz++) {
      for (let dx = 0; dx < P; dx++) {
        addChunkMesh(group, mats, unsubs, meshChunk(px * P + dx, pz * P + dz, deps.cfg, deps.worldBounds));
      }
    }
    deps.scene.add(group);
    const entry: ChunkGroupEntry = {
      group,
      mats,
      unsubs,
      ready: true,
      failed: false,
      centerX,
      centerZ,
      lastTouchFrame: 0,
    };
    chunkGroups.set(node.id, entry);
    return entry;
  };

  const evictCache = (bubbleCenter: THREE.Vector3, bubbleRadius: number) => {
    for (const [nodeId, entry] of [...chunkGroups.entries()]) {
      const dist = Math.hypot(bubbleCenter.x - entry.centerX, bubbleCenter.z - entry.centerZ);
      if (dist > bubbleRadius * deps.evictDistanceMultiplier) {
        disposeEntry(nodeId, entry);
      }
    }
    if (chunkGroups.size <= deps.maxCachedChunkGroups) return;
    const lru = [...chunkGroups.entries()].sort((a, b) => a[1].lastTouchFrame - b[1].lastTouchFrame);
    while (chunkGroups.size > deps.maxCachedChunkGroups && lru.length > 0) {
      const [nodeId, entry] = lru.shift()!;
      disposeEntry(nodeId, entry);
    }
  };

  return {
    update(input) {
      const tBubbleStart = performance.now();
      let chunkGroupsBuiltThisFrame = 0;
      if (input.enabled) {
        for (const v of input.bubbleViews) {
          const owned =
            v.node.level === 0 &&
            v.target > 0.5 &&
            Math.hypot(
              input.bubbleCenter.x - (v.node.footprint.minX + v.node.footprint.maxX) / 2,
              input.bubbleCenter.z - (v.node.footprint.minZ + v.node.footprint.maxZ) / 2,
            ) < input.bubbleRadius;
          if (owned) {
            let grp = chunkGroups.get(v.node.id);
            if (!grp) {
              if (chunkGroupsBuiltThisFrame >= deps.chunkGroupBuildBudget) {
                v.mesh.visible = true;
                continue;
              }
              grp = ensureChunkGroup(v.node);
              chunkGroupsBuiltThisFrame++;
            }
            grp.lastTouchFrame = input.frameId;
            if (grp.ready && !grp.failed) {
              v.mesh.visible = false;
              grp.group.visible = true;
            } else {
              v.mesh.visible = true;
              grp.group.visible = false;
            }
          } else {
            const grp = chunkGroups.get(v.node.id);
            if (grp) grp.group.visible = false;
            v.mesh.visible = v.fade > 0.001;
          }
        }
        evictCache(input.bubbleCenter, input.bubbleRadius);
      } else if (chunkGroups.size > 0) {
        for (const [nodeId, { group }] of chunkGroups) {
          group.visible = false;
          const view = input.getView(nodeId);
          if (view) view.mesh.visible = view.fade > 0.001;
        }
      }
      return {
        chunkGroupsBuiltThisFrame,
        bubbleMs: performance.now() - tBubbleStart,
        chunkGroupCount: chunkGroups.size,
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
