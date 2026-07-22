import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import type {
  ConstructionTerrainConformCommitResult,
  ConstructionTerrainConformPreview,
  ConstructionTerrainConformReceipt,
  ConstructionTerrainConformRequest,
  ConstructionTerrainConformUndoResult,
} from "../../construction/types.js";
import {
  DIG_INFLUENCE_MARGIN,
  getDigEditRevision,
  hasPaintedTerrainEdits,
  type BrushOp,
  type BrushShape,
  type DigEdit,
  type VoxelEditTransaction,
} from "../../terrain/terrain.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodSelectionController } from "../selection/clod_selection_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import {
  canCommitTerrainEdit,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
} from "../../player/player_edit_authority.js";
import {
  dirtyAabbForBrush,
  type TerrainEditDirtyQueue,
  type TerrainEditDirtyReason,
} from "./terrain_edit_dirty_queue.js";
import { gameplayDiagnostics } from "../../player/gameplay_diagnostics.js";
import type { ModedEditCommand } from "../../player/edit_commands.js";
import { createTerrainEditConstructionConform } from "./terrain_edit_construction_conform.js";
import { createTerrainEditDigOps } from "./terrain_edit_dig_ops.js";
import { createTerrainEditSpellOps } from "./terrain_edit_spell_ops.js";
import { createTerrainEditVegetationNotify } from "./terrain_edit_vegetation_notify.js";

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

export interface TerrainSpellEditRequest {
  spellId: string;
  command: ModedEditCommand;
  edit: DigEdit;
}

export interface TerrainSpellEditResult {
  committed: boolean;
  changed: boolean;
  converged: boolean;
  reason: string | null;
  editRevision: number;
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
  getInteractionMode?: () => string;
  editReadyAt?: (x: number, z: number) => boolean;
  protectedAt?: (x: number, z: number) => boolean;
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

export interface TerrainDigExecution {
  readonly brush?: Readonly<TerrainBrushParams>;
  readonly targetPoint?: THREE.Vector3;
}

export interface TerrainEditService {
  scheduleDig(ray: THREE.Ray): void;
  runDigNow(ray: THREE.Ray, execution?: TerrainDigExecution): Promise<void>;
  commitSpellTerrainEdit(
    request: TerrainSpellEditRequest,
    onAuthoritativeCommit?: () => void,
  ): Promise<TerrainSpellEditResult>;
  scheduleConstructionTerrainConform(request: ConstructionTerrainConformRequest): void;
  previewConstructionTerrainConform(request: ConstructionTerrainConformRequest): ConstructionTerrainConformPreview;
  commitConstructionTerrainConform(request: ConstructionTerrainConformRequest): Promise<ConstructionTerrainConformCommitResult>;
  undoConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): Promise<ConstructionTerrainConformUndoResult>;
  forgetConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): void;
  flushAncestors(): Promise<void>;
  readonly lastDigAt: number;
}

type EditCommitStatus = "committed" | "committed_render_stale" | "rejected";
interface TerrainRebuildHit { point: THREE.Vector3 }

export function createTerrainEditService(deps: TerrainEditServiceDeps): TerrainEditService {
  let lastDigAt = -Infinity;
  let editOperationTail: Promise<void> = Promise.resolve();

  const authorityOrigin = (): THREE.Vector3 | null => deps.getAuthorityOrigin?.() ?? null;
  const authorityCounters = (): Record<string, number> | null => deps.getAuthorityCounters?.() ?? null;

  const addCounter = (key: string, amount = 1): void => {
    const counters = authorityCounters();
    if (counters) counters[key] = (counters[key] ?? 0) + amount;
  };

  const vegetation = createTerrainEditVegetationNotify({
    getVegetationState: deps.getVegetationState,
    grassSystem: deps.grassSystem,
    treeSystem: deps.treeSystem,
    understorySystem: deps.understorySystem,
    refreshGrassStats: deps.refreshGrassStats,
    refreshTreeStats: deps.refreshTreeStats,
    refreshUnderstoryStats: deps.refreshUnderstoryStats,
  });

  const applyLod0Result = (
    changed: readonly ClodPageNode[],
    pendingParents: number,
    chunkPatches: Awaited<ReturnType<ClodWorkerClient["rebuildAfterDig"]>>["chunkPatches"],
  ): void => {
    deps.applyNearFieldChunks?.(chunkPatches);
    deps.enqueueApplyNodes(changed);
    if (pendingParents > 0) deps.markEditedAncestorsStale(changed);
    deps.selectionController.patchNodes(changed);
    if (changed.length > 0) vegetation.queueVegetationRebuild(changed);
    deps.setPendingParentCount(pendingParents);
    deps.selectionController.invalidate();
    deps.updateInfo();
  };

  const reportRebuildFailure = (label: string, error: unknown): void => {
    emitAudio("clod.rebuild.error");
    if (error instanceof Error && error.name === "ClodBuildError") emitAudio("clod.validation.error");
    const message = error instanceof Error ? error.message : String(error);
    deps.setLastDigSummary(`${label} rebuild failed: ${message}`);
    deps.updateInfo();
    console.error(`${label} rebuild failed:`, error);
  };

  const runDerivedUpdate = (label: string, update: () => void): void => {
    try { update(); }
    catch (error) { console.error(`[terrain-edit] ${label} failed after authoritative commit`, error); }
  };

  const dirtyReasonFor = (edit: DigEdit, label: string): TerrainEditDirtyReason => {
    if (label.startsWith("construction")) return "build";
    if (label.startsWith("spell:")) return "spell";
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

  const syncPaintedTerrainState = (previous: boolean): void => {
    if (hasPaintedTerrainEdits() !== previous) runDerivedUpdate("terrain texture state sync", deps.applyTerrainTextures);
  };

  const enqueueEditOperation = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
    const queued = editOperationTail.then(operation, operation);
    editOperationTail = queued.then(() => undefined, (error) => {
      const message = error instanceof Error ? error.message : String(error);
      deps.setLastDigSummary(`${label} failed: ${message}`);
      deps.updateInfo();
      console.error(`[terrain-edit] ${label} failed`, error);
    });
    return queued;
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
    const workerStartedAt = performance.now();
    try {
      lod0 = await deps.clodWorker.rebuildAfterDig(transaction, {
        minX: hit.point.x - margin,
        maxX: hit.point.x + margin,
        minZ: hit.point.z - margin,
        maxZ: hit.point.z + margin,
      });
    } catch (error) {
      reportRebuildFailure(label, error);
      return "rejected";
    }
    runDerivedUpdate("worker rebuild metrics", () => {
      deps.recordClodWorkerRebuild(performance.now() - workerStartedAt);
      const counters = authorityCounters();
      if (!counters) return;
      counters["terrain_edit_partial_chunk_count"] = lod0.chunksRemeshed;
      counters["terrain_edit_full_page_fallback_count"] = lod0.fullPageFallbacks;
      counters["terrain_edit_validation_failure_count"] = lod0.fullPageFallbacks;
      counters["terrain_edit_page_weld_ms"] = lod0.pageWeldMs;
    });
    runDerivedUpdate("streamed-root invalidation", () => deps.invalidateStreamedRoots?.(transaction.dirtyBounds));
    runDerivedUpdate("dirty edit publication", () => publishDirtyEdit(edit, label));
    try {
      applyLod0Result(lod0.changed, lod0.pendingParents, lod0.chunkPatches);
      deps.setPendingParentNodes(0);
      deps.setPendingParentMs(0);
    } catch (error) {
      console.error(`${label} apply failed after worker rebuild:`, error);
      setTimeout(() => {
        try { applyLod0Result(lod0.changed, lod0.pendingParents, lod0.chunkPatches); }
        catch (retryError) { console.error(`${label} retry apply failed:`, retryError); }
      }, 0);
      return "committed_render_stale";
    }
    const totalMs = performance.now() - t0;
    deps.setLastDigSummary(`${totalMs.toFixed(0)}ms worker LOD0 · ${lod0.chunksRemeshed}/${lod0.chunksTotal} chunks`);
    return "committed";
  };

  const terrainCommitAllowed = (point: THREE.Vector3): boolean => {
    if (deps.editReadyAt && !deps.editReadyAt(point.x, point.z)) {
      gameplayDiagnostics.add("edits_denied_not_ready");
      deps.setLastDigSummary("terrain edit rejected: target not ready (streaming)");
      deps.updateInfo();
      return false;
    }
    if (!deps.editAuthority) return true;
    const decision = canCommitTerrainEdit(deps.editAuthority, authorityOrigin(), point);
    publishPlayerEditAuthorityDecision(authorityCounters(), decision);
    if (decision.allowed) return true;
    deps.setLastDigSummary(`terrain edit rejected: ${decision.reason}`);
    deps.updateInfo();
    return false;
  };

  const sharedOps = {
    performEditRebuild,
    enqueueEditOperation,
    syncPaintedTerrainState,
    terrainCommitAllowed,
  };

  const digOps = createTerrainEditDigOps({
    terrainRaycast: deps.terrainRaycast,
    getBrushParams: deps.getBrushParams,
    setLastDigSummary: deps.setLastDigSummary,
    updateInfo: deps.updateInfo,
    ...sharedOps,
  });

  const spellOps = createTerrainEditSpellOps({
    editAuthority: deps.editAuthority,
    getInteractionMode: deps.getInteractionMode,
    editReadyAt: deps.editReadyAt,
    protectedAt: deps.protectedAt,
    clodWorker: deps.clodWorker,
    authorityOrigin,
    addCounter,
    setLastDigSummary: deps.setLastDigSummary,
    updateInfo: deps.updateInfo,
    runDerivedUpdate,
    flushVegetationRebuilds: vegetation.flushVegetationRebuilds,
    getAuthorityCounters: authorityCounters,
    ...sharedOps,
  });

  const construction = createTerrainEditConstructionConform({
    terrainRaycast: deps.terrainRaycast,
    editAuthority: deps.editAuthority,
    editReadyAt: deps.editReadyAt,
    protectedAt: deps.protectedAt,
    authorityOrigin,
    ...sharedOps,
  });

  return {
    scheduleDig: digOps.scheduleDig,
    runDigNow: (ray, execution) => digOps.runDigExclusive(ray, execution),
    commitSpellTerrainEdit: spellOps.commitSpellTerrainEdit,
    scheduleConstructionTerrainConform: (request) => { void construction.commitConstructionTerrainConform(request); },
    previewConstructionTerrainConform: construction.previewConstructionTerrainConform,
    commitConstructionTerrainConform: construction.commitConstructionTerrainConform,
    undoConstructionTerrainConform: construction.undoConstructionTerrainConform,
    forgetConstructionTerrainConform: construction.forgetConstructionTerrainConform,
    flushAncestors: async () => { await editOperationTail; await deps.clodWorker.flushParents(); },
    get lastDigAt() { return lastDigAt; },
  };
}
