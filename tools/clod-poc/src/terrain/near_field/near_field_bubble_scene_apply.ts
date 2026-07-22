import * as THREE from "three";
import { toGeometry } from "../geometry/page_geometry.js";
import type { TerrainMaterialController } from "../material/terrain_material_controller.js";
import type { TerrainMaterialHandle } from "../../rendering/terrain_material.js";
import type { TerrainColliderFootprint, TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { ChunkMesh } from "../../gpu/gpu_chunk_mesher.js";
import type { PageMesh } from "../../types.js";
import type { VoxelOverlayBounds } from "../voxel_overlay/voxel_overlay.js";

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
  voxelOverlayBounds: Pick<VoxelOverlayBounds, "minX" | "minZ" | "maxX" | "maxZ"> | null;
}

export function pageGroupKey(px: number, pz: number): string {
  return `L0:${px},${pz}`;
}

export function chunkColliderId(pageKey: string, dx: number, dz: number): string {
  return `${pageKey}:chunk:${dx},${dz}`;
}

export function parsePageGroupKey(key: string): { px: number; pz: number } {
  const [, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(px) || !Number.isInteger(pz)) throw new Error(`Invalid page key ${key}`);
  return { px, pz };
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

export function footprintIntersectsCircle(
  footprint: TerrainColliderFootprint,
  center: THREE.Vector3,
  radius: number,
): boolean {
  const closestX = THREE.MathUtils.clamp(center.x, footprint.minX, footprint.maxX);
  const closestZ = THREE.MathUtils.clamp(center.z, footprint.minZ, footprint.maxZ);
  const dx = center.x - closestX;
  const dz = center.z - closestZ;
  return dx * dx + dz * dz <= radius * radius;
}

export function pageEntryReady(entry: ChunkGroupEntry): boolean {
  return entry.ready && !entry.failed && (entry.group.children.length > 0 || entry.colliderIds.length > 0 || entry.validEmpty);
}

export function showReadyGroup(entry: ChunkGroupEntry, fallbackMesh?: THREE.Mesh): boolean {
  if (entry.ready && !entry.failed && entry.group.children.length > 0) {
    if (fallbackMesh) fallbackMesh.visible = false;
    entry.group.visible = true;
    return true;
  }
  entry.group.visible = false;
  return false;
}

export interface NearFieldBubbleSceneApplyDeps {
  scene: THREE.Scene;
  materialController: TerrainMaterialController;
  getTintBubble: () => boolean;
  terrainColliders: TerrainColliderSet | null;
  chunksPerPage: number;
  chunkGroups: Map<string, ChunkGroupEntry>;
  getBubbleCenter: () => THREE.Vector3;
  getColliderRadius: () => number | null;
  onColliderRegistered: () => void;
  onColliderRemoved: () => void;
}

export interface NearFieldBubbleSceneApply {
  addChunkMesh: (
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    colliderIds: string[],
    cm: PageMesh | ChunkMesh,
    colliderId: string,
    footprint: TerrainColliderFootprint,
    localIndex: number,
  ) => void;
  disposeChunkMesh: (nodeId: string, entry: ChunkGroupEntry, mesh: THREE.Mesh, removeCollider: boolean) => void;
  clearEntryContent: (entry: ChunkGroupEntry) => void;
  createDeferredEntry: (
    key: string,
    group: THREE.Group,
    mats: TerrainMaterialHandle[],
    unsubs: Array<() => void>,
    colliderIds: string[],
    centerX: number,
    centerZ: number,
    voxelOverlayBounds: ChunkGroupEntry["voxelOverlayBounds"],
  ) => ChunkGroupEntry;
}

export function createNearFieldBubbleSceneApply(deps: NearFieldBubbleSceneApplyDeps): NearFieldBubbleSceneApply {
  const { chunksPerPage: P } = deps;

  const buildChunkMaterial = (): TerrainMaterialHandle => {
    const mat = deps.materialController.makeTerrainMaterial(deps.getTintBubble() ? 0xc94b4b : 0xffffff);
    deps.materialController.configureChunkMaterial(mat);
    return mat;
  };

  const addChunkMesh: NearFieldBubbleSceneApply["addChunkMesh"] = (
    group,
    mats,
    unsubs,
    colliderIds,
    cm,
    colliderId,
    footprint,
    localIndex,
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
    const colliderAllowed = deps.getColliderRadius() === null
      || footprintIntersectsCircle(footprint, deps.getBubbleCenter(), deps.getColliderRadius()!);
    if (cm.indices.length > 0 && deps.terrainColliders && colliderAllowed) {
      deps.terrainColliders.upsertPage({ id: colliderId, geometry, footprint });
      if (!colliderIds.includes(colliderId)) colliderIds.push(colliderId);
      deps.onColliderRegistered();
    }
  };

  const disposeChunkMesh: NearFieldBubbleSceneApply["disposeChunkMesh"] = (nodeId, entry, mesh, removeCollider) => {
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
      if (deps.terrainColliders?.removePage(colliderId)) deps.onColliderRemoved();
      const colliderIndex = entry.colliderIds.indexOf(colliderId);
      if (colliderIndex >= 0) entry.colliderIds.splice(colliderIndex, 1);
    }
  };

  const clearEntryContent: NearFieldBubbleSceneApply["clearEntryContent"] = (entry) => {
    for (const colliderId of entry.colliderIds.splice(0)) {
      if (deps.terrainColliders?.removePage(colliderId)) deps.onColliderRemoved();
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

  const createDeferredEntry: NearFieldBubbleSceneApply["createDeferredEntry"] = (
    key,
    group,
    mats,
    unsubs,
    colliderIds,
    centerX,
    centerZ,
    voxelOverlayBounds,
  ) => {
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
      voxelOverlayBounds,
    };
    deps.chunkGroups.set(key, entry);
    return entry;
  };

  return { addChunkMesh, disposeChunkMesh, clearEntryContent, createDeferredEntry };
}
