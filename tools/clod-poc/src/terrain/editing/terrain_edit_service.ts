import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import type { ConstructionTerrainConformRequest } from "../../construction/types.js";
import {
  applyDigEditTransaction,
  DIG_INFLUENCE_MARGIN,
  getDigEditRevision,
  hasPaintedTerrainEdits,
  rollbackDigEditTransaction,
  voxelTransactionFromDigEdit,
  type BrushOp,
  type BrushShape,
  type DigEdit,
  type VoxelEditTransaction,
} from "../../terrain/terrain.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodSelectionController } from "../selection/clod_selection_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import {
  canCommitBuild,
  canCommitTerrainEdit,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
} from "../../player/player_edit_authority.js";
import {
  dirtyAabbForBrush,
  type TerrainEditDirtyQueue,
  type TerrainEditDirtyReason,
} from "./terrain_edit_dirty_queue.js";

const DIG_REBUILD_DEBOUNCE_MS = 40;
const CONSTRUCTION_CONFORM_DEBOUNCE_MS = 20;
const VEGETATION_REBUILD_DEBOUNCE_MS = 160;
const VEGETATION_REBUILD_RETRY_MS = 1000;
const MAX_PENDING_DIG_SAMPLES = 32;

export interface TerrainBrushParams {
  digRadius: number;
  brushShape: BrushShape;
  brushOp: BrushOp;
  brushMaterial: number;
  brushHeight: number;
  brushStrength: number;
  brushFalloff: number;
}

export interface TerrainEditVegetationState {
  grassEnabled: boolean;
  treesEnabled: boolean;
  understoryEnabled: boolean;
}

export interface TerrainEditServiceDeps {
  clodWorker: ClodWorkerClient;
  terrainRaycast: TerrainRaycastService;
  getBrushParams: () => TerrainBrushParams;
  getVegetationState: () => TerrainEditVegetationState;
  enqueueApplyNodes: (nodes: readonly ClodPageNode[]) => void;
  applyNearFieldChunks?: (patches: Awaited<ReturnType<ClodWorkerClient["rebuildAfterDig"]>>["chunkPatches"]) => void;
  invalidateStreamedRoots?: (bounds: VoxelEditTransaction["dirtyBounds"]) => void;
  recordClodWorkerRebuild: (ms: number) => void;
  markEditedAncestorsStale: (lod0Nodes: readonly ClodPageNode[]) => void;
  selectionController: Pick<ClodSelectionController, "patchNodes" | "invalidate">;
  applyTerrainTextures: () => void;
  grassSystem: { rebuildNodePatches(ids: string[]): void; markPatchesDirty?(): void } | null;
  treeSystem: { rebuildNodePatches(ids: string[]): void; markPatchesDirty?(): void } | null;
  understorySystem: { rebuildNodePatches(ids: string[]): void; markPatchesDirty?(): void } | null;
  fallingTrees: unknown[];
  editAuthority?: PlayerEditAuthorityConfig;
  getAuthorityOrigin?: () => THREE.Vector3 | null;
  getAuthorityCounters?: () => Record<string, number> | null;
  dirtyQueue?: TerrainEditDirtyQueue;
  refreshGrassStats: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  updateInfo: () => void;
  setLastDigSummary: (summary: string) => void;
  setPendingParentCount: (count: number) => void;
  setPendingParentNodes: (nodes: number) => void;
  setPendingParentMs: (ms: number) => void;
}

export interface TerrainEditService {
  scheduleDig(ray: THREE.Ray): void;
  scheduleConstructionTerrainConform(request: ConstructionTerrainConformRequest): void;
  flushAncestors(): Promise<void>;
  readonly lastDigAt: number;
}

interface TerrainRebuildHit {
  point: THREE.Vector3;
}

type EditCommitStatus = "committed" | "committed_render_stale" | "rejected";

export function createTerrainEditService(deps: TerrainEditServiceDeps): TerrainEditService {
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let conformDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let vegetationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDigAt = -Infinity;
  let digInFlight = false;
  let editOperationTail: Promise<void> = Promise.resolve();
  const queuedDigRays: THREE.Ray[] = [];
  let scheduledDigRay: THREE.Ray | null = null;
  const pendingGrassNodeIds = new Set<string>();
  const pendingTreeNodeIds = new Set<string>();
  const pendingUnderstoryNodeIds = new Set<string>();

  const authorityOrigin = (): THREE.Vector3 | null => deps.getAuthorityOrigin?.() ?? null;
  const authorityCounters = (): Record<string, number> | null => deps.getAuthorityCounters?.() ?? null;

  const clearIds = (pending: Set<string>, ids: readonly string[]): void => {
    for (const id of ids) pending.delete(id);
  };

  const hasEnabledPendingVegetation = (veg: TerrainEditVegetationState): boolean => (
    (veg.grassEnabled && pendingGrassNodeIds.size > 0) ||
    (veg.treesEnabled && pendingTreeNodeIds.size > 0) ||
    (veg.understoryEnabled && pendingUnderstoryNodeIds.size > 0)
  );

  const flushVegetationRebuilds = () => {
    vegetationFlushTimer = null;
    const veg = deps.getVegetationState();

    if (veg.grassEnabled && pendingGrassNodeIds.size > 0) {
      const ids = [...pendingGrassNodeIds];
      try {
        const grass = deps.grassSystem;
        if (grass?.markPatchesDirty) grass.markPatchesDirty();
        else grass?.rebuildNodePatches(ids);
        deps.refreshGrassStats();
        clearIds(pendingGrassNodeIds, ids);
      } catch (error) {
        console.error("grass rebuild after terrain edit failed:", error);
      }
    }
    if (veg.treesEnabled && pendingTreeNodeIds.size > 0) {
      const ids = [...pendingTreeNodeIds];
      try {
        const trees = deps.treeSystem;
        if (trees?.markPatchesDirty) trees.markPatchesDirty();
        else trees?.rebuildNodePatches(ids);
        deps.refreshTreeStats();
        clearIds(pendingTreeNodeIds, ids);
      } catch (error) {
        console.error("tree rebuild after terrain edit failed:", error);
      }
    }
    if (veg.understoryEnabled && pendingUnderstoryNodeIds.size > 0) {
      const ids = [...pendingUnderstoryNodeIds];
      try {
        const understory = deps.understorySystem;
        if (understory?.markPatchesDirty) understory.markPatchesDirty();
        else understory?.rebuildNodePatches(ids);
        deps.refreshUnderstoryStats();
        clearIds(pendingUnderstoryNodeIds, ids);
      } catch (error) {
        console.error("understory rebuild after terrain edit failed:", error);
      }
    }

    if (vegetationFlushTimer === null && hasEnabledPendingVegetation(deps.getVegetationState())) {
      vegetationFlushTimer = setTimeout(flushVegetationRebuilds, VEGETATION_REBUILD_RETRY_MS);
    }
  };

  const queueVegetationRebuild = (changed: readonly ClodPageNode[]) => {
    const veg = deps.getVegetationState();
    for (const node of changed) {
      if (veg.grassEnabled) pendingGrassNodeIds.add(node.id);
      if (veg.treesEnabled) pendingTreeNodeIds.add(node.id);
      if (veg.understoryEnabled) pendingUnderstoryNodeIds.add(node.id);
    }
    if (vegetationFlushTimer !== null) clearTimeout(vegetationFlushTimer);
    vegetationFlushTimer = setTimeout(flushVegetationRebuilds, VEGETATION_REBUILD_DEBOUNCE_MS);
  };

  const flushAncestors = async () => {
    await editOperationTail;
    await deps.clodWorker.flushParents();
  };

  const applyLod0Result = (
    changed: readonly ClodPageNode[],
    pendingParents: number,
    chunkPatches: Awaited<ReturnType<ClodWorkerClient["rebuildAfterDig"]>>["chunkPatches"],
  ): void => {
    deps.applyNearFieldChunks?.(chunkPatches);
    deps.enqueueApplyNodes(changed);
    if (pendingParents > 0) deps.markEditedAncestorsStale(changed);
    deps.selectionController.patchNodes(changed);
    if (changed.length > 0) queueVegetationRebuild(changed);
    deps.setPendingParentCount(pendingParents);
    deps.selectionController.invalidate();
    deps.updateInfo();
  };

  const reportRebuildFailure = (label: string, error: unknown): void => {
    emitAudio("clod.rebuild.error");
    if (error instanceof Error && error.name === "ClodBuildError") {
      emitAudio("clod.validation.error");
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.setLastDigSummary(`${label} rebuild failed: ${message}`);
    deps.updateInfo();
    console.error(`${label} rebuild failed:`, error);
  };

  const reportApplyFailure = (label: string, error: unknown): void => {
    emitAudio("clod.rebuild.error");
    const message = error instanceof Error ? error.message : String(error);
    deps.setLastDigSummary(`apply failed: ${message}`);
    deps.updateInfo();
    console.error(`${label} apply failed after worker rebuild:`, error);
  };

  const dirtyReasonFor = (edit: DigEdit, label: string): TerrainEditDirtyReason => {
    if (label.startsWith("construction")) return "build";
    return edit.op === "add" ? "raise" : "dig";
  };

  const publishDirtyEdit = (edit: DigEdit, label: string): void => {
    if (!deps.dirtyQueue) return;
    const height = edit.height ?? edit.r;
    deps.dirtyQueue.enqueue({
      editRevision: getDigEditRevision(),
      worldAabb: dirtyAabbForBrush(edit.x, edit.y, edit.z, edit.r, height, DIG_INFLUENCE_MARGIN),
      reason: dirtyReasonFor(edit, label),
      affectsHeight: true,
      affectsCollision: true,
      affectsVegetation: true,
    });
    const snapshot = deps.dirtyQueue.snapshot();
    const counters = authorityCounters();
    if (counters) {
      counters["terrain_edit_dirty_queue_size"] = snapshot.queued;
      counters["terrain_edit_dirty_revision"] = snapshot.latestRevision;
    }
  };

  const reportNoOp = (summary: string): void => {
    lastDigAt = performance.now();
    deps.setLastDigSummary(summary);
    deps.updateInfo();
  };

  const enqueueEditOperation = (label: string, operation: () => Promise<void>): Promise<void> => {
    const queued = editOperationTail.then(operation);
    const safe = queued.catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      deps.setLastDigSummary(`${label} failed: ${message}`);
      deps.updateInfo();
      console.error(`[terrain-edit] ${label} failed`, error);
    });
    editOperationTail = safe;
    return safe;
  };

  const performEditRebuild = async (
    edit: DigEdit,
    transaction: VoxelEditTransaction,
    hit: TerrainRebuildHit,
    radius: number,
    label: string,
  ): Promise<EditCommitStatus> => {
    const t0 = performance.now();
    lastDigAt = t0;
    const margin = radius + DIG_INFLUENCE_MARGIN;
    let lod0: Awaited<ReturnType<ClodWorkerClient["rebuildAfterDig"]>>;
    try {
      const workerStartedAt = performance.now();
      lod0 = await deps.clodWorker.rebuildAfterDig(transaction, {
        minX: hit.point.x - margin,
        maxX: hit.point.x + margin,
        minZ: hit.point.z - margin,
        maxZ: hit.point.z + margin,
      });
      deps.recordClodWorkerRebuild(performance.now() - workerStartedAt);
      const counters = authorityCounters();
      if (counters) {
        counters["terrain_edit_partial_chunk_count"] = lod0.chunksRemeshed;
        counters["terrain_edit_full_page_fallback_count"] = lod0.fullPageFallbacks;
        counters["terrain_edit_validation_failure_count"] = lod0.fullPageFallbacks;
        counters["terrain_edit_page_weld_ms"] = lod0.pageWeldMs;
      }
    } catch (error) {
      reportRebuildFailure(label, error);
      return "rejected";
    }

    deps.invalidateStreamedRoots?.(transaction.dirtyBounds);
    publishDirtyEdit(edit, label);
    try {
      applyLod0Result(lod0.changed, lod0.pendingParents, lod0.chunkPatches);
      deps.setPendingParentNodes(0);
      deps.setPendingParentMs(0);
    } catch (error) {
      reportApplyFailure(label, error);
      setTimeout(() => {
        try {
          applyLod0Result(lod0.changed, lod0.pendingParents, lod0.chunkPatches);
        } catch (retryError) {
          reportApplyFailure(`${label} retry`, retryError);
        }
      }, 0);
      return "committed_render_stale";
    }

    const totalMs = performance.now() - t0;
    const batchSuffix = lod0.requestCount > 1 ? ` · batch ${lod0.requestCount}` : "";
    const summary =
      `${totalMs.toFixed(0)}ms worker LOD0 (build ${lod0.lod0Ms.toFixed(0)}ms · ${lod0.lod0Pages}p · ` +
      `${lod0.chunksRemeshed}/${lod0.chunksTotal} chunks · serialize ${lod0.serializeMs.toFixed(0)}ms${batchSuffix})`;
    deps.setLastDigSummary(summary);
    console.log(
      `[${label} ${edit.op ?? "edit"} ${edit.shape ?? "sphere"} r=${radius}] at (${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}) — ${summary} — ${lod0.pendingParents} ancestors queued in worker`,
    );
    return "committed";
  };

  const terrainCommitAllowed = (point: THREE.Vector3): boolean => {
    if (!deps.editAuthority) return true;
    const decision = canCommitTerrainEdit(deps.editAuthority, authorityOrigin(), point);
    publishPlayerEditAuthorityDecision(authorityCounters(), decision);
    if (decision.allowed) return true;
    deps.setLastDigSummary(`terrain edit rejected: ${decision.reason}`);
    deps.updateInfo();
    return false;
  };

  const buildTerrainConformAllowed = (position: readonly [number, number, number]): boolean => {
    if (!deps.editAuthority) return true;
    const decision = canCommitBuild(deps.editAuthority, authorityOrigin(), position);
    publishPlayerEditAuthorityDecision(authorityCounters(), decision);
    if (decision.allowed) return true;
    deps.setLastDigSummary(`construction terrain conform rejected: ${decision.reason}`);
    deps.updateInfo();
    return false;
  };

  const performDig = async (ray: THREE.Ray) => {
    const hit = deps.terrainRaycast.raycastEditableTerrain(ray);
    if (!hit) {
      deps.setLastDigSummary("no terrain under brush");
      deps.updateInfo();
      return;
    }
    if (!terrainCommitAllowed(hit.point)) return;
    const brushParams = deps.getBrushParams();
    const radius = brushParams.digRadius;
    const edit = {
      x: hit.point.x, y: hit.point.y, z: hit.point.z, r: radius,
      shape: brushParams.brushShape, op: brushParams.brushOp,
      material: brushParams.brushOp === "add" ? brushParams.brushMaterial : undefined,
      height: brushParams.brushHeight, strength: brushParams.brushStrength, falloff: brushParams.brushFalloff,
    };
    const transaction = voxelTransactionFromDigEdit(edit);
    if (transaction.deltas.length === 0) {
      reportNoOp("no terrain changed");
      return;
    }
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction, edit);

    emitAudio(brushParams.brushOp === "add" ? "terrain.raise" : "terrain.dig.tick");

    const status = await performEditRebuild(edit, transaction, hit, radius, `${brushParams.brushOp} ${brushParams.brushShape}`);
    if (status === "rejected") {
      rollbackDigEditTransaction(transaction);
      if (!hadPaintedTerrain && edit.op === "add") deps.applyTerrainTextures();
      deps.updateInfo();
      return;
    }
    if (!hadPaintedTerrain && edit.op === "add") deps.applyTerrainTextures();
  };

  const runDigExclusive = async (ray: THREE.Ray): Promise<void> => {
    if (digInFlight) {
      const previous = queuedDigRays[queuedDigRays.length - 1];
      if (!previous || previous.origin.distanceTo(ray.origin) > 0.25 || previous.direction.distanceTo(ray.direction) > 0.01) {
        queuedDigRays.push(ray.clone());
        if (queuedDigRays.length > MAX_PENDING_DIG_SAMPLES) queuedDigRays.shift();
      }
      return;
    }
    digInFlight = true;
    try {
      await enqueueEditOperation("terrain brush", () => performDig(ray));
    } finally {
      digInFlight = false;
      const next = queuedDigRays.shift() ?? null;
      if (next) void runDigExclusive(next);
    }
  };

  const performConstructionTerrainConform = async (request: ConstructionTerrainConformRequest) => {
    if (!buildTerrainConformAllowed(request.position)) return;
    const radius = Math.max(request.dimensionsM[0], request.dimensionsM[2]) * 0.5 + request.padMarginM;
    const topY = request.position[1] - request.dimensionsM[1] * 0.5;
    const hit = { point: new THREE.Vector3(request.position[0], topY, request.position[2]) };
    const fillEdit: DigEdit = {
      x: request.position[0],
      y: topY - request.fillDepthM * 0.5,
      z: request.position[2],
      r: radius,
      shape: "cube",
      op: "add",
      material: request.materialSlot,
      height: request.fillDepthM * 0.5,
      strength: 1,
      falloff: request.falloffM,
    };
    const trimEdit: DigEdit = {
      x: request.position[0],
      y: topY + request.trimHeightM * 0.5,
      z: request.position[2],
      r: radius,
      shape: "cube",
      op: "remove",
      height: request.trimHeightM * 0.5,
      strength: 1,
      falloff: request.falloffM,
    };

    let changed = false;
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    const fillTransaction = voxelTransactionFromDigEdit(fillEdit);
    if (fillTransaction.deltas.length > 0) {
      applyDigEditTransaction(fillTransaction, fillEdit);
      emitAudio("terrain.raise");
      const fillStatus = await performEditRebuild(fillEdit, fillTransaction, hit, radius, "construction terrain fill");
      if (fillStatus === "rejected") {
        rollbackDigEditTransaction(fillTransaction);
        if (!hadPaintedTerrain) deps.applyTerrainTextures();
        deps.updateInfo();
        return;
      }
      changed = true;
      if (!hadPaintedTerrain) deps.applyTerrainTextures();
    }

    if (request.trimHeightM > 0) {
      const trimTransaction = voxelTransactionFromDigEdit(trimEdit);
      if (trimTransaction.deltas.length > 0) {
        applyDigEditTransaction(trimTransaction, trimEdit);
        const trimStatus = await performEditRebuild(trimEdit, trimTransaction, hit, radius, "construction terrain trim");
        if (trimStatus === "rejected") {
          rollbackDigEditTransaction(trimTransaction);
          deps.updateInfo();
          return;
        }
        changed = true;
      }
    }

    if (!changed) reportNoOp("construction terrain already conformed");
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    scheduledDigRay = ray.clone();
    if (digDebounceTimer !== null) return;
    digDebounceTimer = setTimeout(() => {
      digDebounceTimer = null;
      const next = scheduledDigRay;
      scheduledDigRay = null;
      if (next) void runDigExclusive(next);
    }, DIG_REBUILD_DEBOUNCE_MS);
  };

  const scheduleConstructionTerrainConform = (request: ConstructionTerrainConformRequest): void => {
    if (conformDebounceTimer !== null) clearTimeout(conformDebounceTimer);
    conformDebounceTimer = setTimeout(() => {
      conformDebounceTimer = null;
      void enqueueEditOperation("construction terrain conform", () => performConstructionTerrainConform(request));
    }, CONSTRUCTION_CONFORM_DEBOUNCE_MS);
  };

  return {
    scheduleDig,
    scheduleConstructionTerrainConform,
    flushAncestors,
    get lastDigAt() {
      return lastDigAt;
    },
  };
}
