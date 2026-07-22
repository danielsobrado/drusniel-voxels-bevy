import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import {
  analyzeConstructionTerrainSamples,
  constructionTerrainSamplePositions,
  invalidConstructionTerrainPreview,
} from "../../construction/construction_terrain_conform.js";
import type {
  ConstructionTerrainConformCommitResult,
  ConstructionTerrainConformPreview,
  ConstructionTerrainConformReceipt,
  ConstructionTerrainConformRequest,
  ConstructionTerrainConformUndoResult,
} from "../../construction/types.js";
import {
  applyDigEditTransaction,
  canUndoVoxelTransaction,
  hasPaintedTerrainEdits,
  rollbackDigEditTransaction,
  voxelInverseTransaction,
  voxelTransactionFromTerrainConform,
  type DigEdit,
  type VoxelEditTransaction,
} from "../../terrain/terrain.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import {
  canCommitBuild,
  type PlayerEditAuthorityConfig,
} from "../../player/player_edit_authority.js";
import type { TerrainEditCommitStatus } from "./terrain_edit_dig_ops.js";

const TERRAIN_PREVIEW_RAY_MARGIN_M = 8;

interface TerrainReceiptEntry { transaction: VoxelEditTransaction }

export interface TerrainEditConstructionConformDeps {
  terrainRaycast: TerrainRaycastService;
  editAuthority?: PlayerEditAuthorityConfig;
  editReadyAt?: (x: number, z: number) => boolean;
  protectedAt?: (x: number, z: number) => boolean;
  authorityOrigin: () => THREE.Vector3 | null;
  performEditRebuild: (
    edit: DigEdit,
    transaction: VoxelEditTransaction,
    hit: { point: THREE.Vector3 },
    radius: number,
    label: string,
  ) => Promise<TerrainEditCommitStatus>;
  enqueueEditOperation: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  syncPaintedTerrainState: (previous: boolean) => void;
}

export interface TerrainEditConstructionConform {
  previewConstructionTerrainConform(request: ConstructionTerrainConformRequest): ConstructionTerrainConformPreview;
  commitConstructionTerrainConform(request: ConstructionTerrainConformRequest): Promise<ConstructionTerrainConformCommitResult>;
  undoConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): Promise<ConstructionTerrainConformUndoResult>;
  forgetConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): void;
}

export function createTerrainEditConstructionConform(
  deps: TerrainEditConstructionConformDeps,
): TerrainEditConstructionConform {
  const terrainReceipts = new Map<string, TerrainReceiptEntry>();

  const previewConstructionTerrainConform = (
    request: ConstructionTerrainConformRequest,
  ): ConstructionTerrainConformPreview => {
    if (deps.editAuthority) {
      const decision = canCommitBuild(deps.editAuthority, deps.authorityOrigin(), request.position);
      if (!decision.allowed) {
        return invalidConstructionTerrainPreview(request, decision.reason ?? "build authority rejected the terrain footprint");
      }
    }
    const samples: Array<{ x: number; z: number; surfaceY: number }> = [];
    for (const position of constructionTerrainSamplePositions(request)) {
      if (deps.protectedAt?.(position.x, position.z)) {
        return invalidConstructionTerrainPreview(request, "terrain footprint intersects a protected region");
      }
      if (deps.editReadyAt && !deps.editReadyAt(position.x, position.z)) {
        return invalidConstructionTerrainPreview(request, "terrain footprint is not ready for editing");
      }
      const originY = request.footprint.targetY + request.trimHeightM + TERRAIN_PREVIEW_RAY_MARGIN_M;
      const ray = new THREE.Ray(
        new THREE.Vector3(position.x, originY, position.z),
        new THREE.Vector3(0, -1, 0),
      );
      const hit = deps.terrainRaycast.raycastEditableTerrain(ray);
      if (!hit) return invalidConstructionTerrainPreview(request, "terrain footprint is not fully authoritative");
      samples.push({ x: position.x, z: position.z, surfaceY: hit.point.y });
    }
    return analyzeConstructionTerrainSamples(request, samples);
  };

  const terrainEditForRequest = (request: ConstructionTerrainConformRequest) => ({
    minX: request.footprint.minX,
    maxX: request.footprint.maxX,
    minZ: request.footprint.minZ,
    maxZ: request.footprint.maxZ,
    targetY: request.footprint.targetY,
    fillDepthM: request.fillDepthM,
    trimHeightM: request.trimHeightM,
    falloffM: request.falloffM,
    materialSlot: request.materialSlot,
  });

  const rebuildMetadataForRequest = (request: ConstructionTerrainConformRequest): {
    edit: DigEdit;
    hit: { point: THREE.Vector3 };
    radius: number;
  } => {
    const radius = Math.max(
      request.footprint.maxX - request.footprint.minX,
      request.footprint.maxZ - request.footprint.minZ,
    ) * 0.5;
    return {
      radius,
      hit: { point: new THREE.Vector3(request.position[0], request.footprint.targetY, request.position[2]) },
      edit: {
        x: request.position[0], y: request.footprint.targetY, z: request.position[2], r: radius,
        shape: "cube", op: "add", material: request.materialSlot,
        height: Math.max(request.fillDepthM, request.trimHeightM), strength: 1, falloff: request.falloffM,
      },
    };
  };

  const commitConstructionTerrainConform = async (
    request: ConstructionTerrainConformRequest,
  ): Promise<ConstructionTerrainConformCommitResult> => deps.enqueueEditOperation("construction terrain conform", async () => {
    const preview = previewConstructionTerrainConform(request);
    if (!preview.valid) return { committed: false, reason: preview.reason, changed: false, receipt: null };
    if (!preview.changed) return { committed: true, reason: null, changed: false, receipt: null };
    const transaction = voxelTransactionFromTerrainConform(terrainEditForRequest(request));
    if (transaction.deltas.length === 0) return { committed: true, reason: null, changed: false, receipt: null };
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction);
    const metadata = rebuildMetadataForRequest(request);
    const status = await deps.performEditRebuild(metadata.edit, transaction, metadata.hit, metadata.radius, "construction terrain conform");
    if (status === "rejected") {
      rollbackDigEditTransaction(transaction);
      deps.syncPaintedTerrainState(hadPaintedTerrain);
      return { committed: false, reason: "terrain rebuild rejected", changed: false, receipt: null };
    }
    deps.syncPaintedTerrainState(hadPaintedTerrain);
    emitAudio("terrain.raise");
    const receipt = { id: `construction-terrain-${transaction.id}` };
    terrainReceipts.set(receipt.id, { transaction });
    return { committed: true, reason: null, changed: true, receipt };
  });

  const undoConstructionTerrainConform = async (
    receipt: ConstructionTerrainConformReceipt,
  ): Promise<ConstructionTerrainConformUndoResult> => deps.enqueueEditOperation("construction terrain undo", async () => {
    const entry = terrainReceipts.get(receipt.id);
    if (!entry) return { undone: false, reason: "terrain transaction receipt is no longer available" };
    if (!canUndoVoxelTransaction(entry.transaction)) {
      return { undone: false, reason: "terrain changed after construction placement" };
    }
    let inverse: VoxelEditTransaction;
    try { inverse = voxelInverseTransaction(entry.transaction); }
    catch (error) { return { undone: false, reason: error instanceof Error ? error.message : String(error) }; }
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(inverse);
    const bounds = inverse.dirtyBounds;
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
    const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5;
    const edit: DigEdit = {
      x: centerX, y: (bounds.minY + bounds.maxY) * 0.5, z: centerZ, r: radius,
      shape: "cube", op: "remove", height: Math.max(1, (bounds.maxY - bounds.minY) * 0.5), strength: 1, falloff: 0,
    };
    const status = await deps.performEditRebuild(
      edit,
      inverse,
      { point: new THREE.Vector3(centerX, edit.y, centerZ) },
      radius,
      "construction terrain undo",
    );
    if (status === "rejected") {
      rollbackDigEditTransaction(inverse);
      deps.syncPaintedTerrainState(hadPaintedTerrain);
      return { undone: false, reason: "terrain undo rebuild rejected" };
    }
    terrainReceipts.delete(receipt.id);
    deps.syncPaintedTerrainState(hadPaintedTerrain);
    return { undone: true, reason: null };
  });

  return {
    previewConstructionTerrainConform,
    commitConstructionTerrainConform,
    undoConstructionTerrainConform,
    forgetConstructionTerrainConform: (receipt) => { terrainReceipts.delete(receipt.id); },
  };
}
