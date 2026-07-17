import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
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
  DIG_INFLUENCE_MARGIN,
  getDigEditRevision,
  hasPaintedTerrainEdits,
  rollbackDigEditTransaction,
  voxelInverseTransaction,
  voxelTransactionFromDigEdit,
  voxelTransactionFromTerrainConform,
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
import { gameplayDiagnostics } from "../../player/gameplay_diagnostics.js";
import { DEFAULT_EDIT_COMMAND_EXPIRY_MS } from "../../player/edit_commands.js";

const DIG_REBUILD_DEBOUNCE_MS = 40;
const VEGETATION_REBUILD_DEBOUNCE_MS = 160;
const VEGETATION_REBUILD_RETRY_MS = 1000;
const MAX_PENDING_DIG_SAMPLES = 32;
const TERRAIN_PREVIEW_RAY_MARGIN_M = 8;

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

export interface TerrainEditService {
  scheduleDig(ray: THREE.Ray): void;
  runDigNow(ray: THREE.Ray): Promise<void>;
  scheduleConstructionTerrainConform(request: ConstructionTerrainConformRequest): void;
  previewConstructionTerrainConform(request: ConstructionTerrainConformRequest): ConstructionTerrainConformPreview;
  commitConstructionTerrainConform(request: ConstructionTerrainConformRequest): Promise<ConstructionTerrainConformCommitResult>;
  undoConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): Promise<ConstructionTerrainConformUndoResult>;
  forgetConstructionTerrainConform(receipt: ConstructionTerrainConformReceipt): void;
  flushAncestors(): Promise<void>;
  readonly lastDigAt: number;
}

interface TerrainRebuildHit { point: THREE.Vector3 }
type EditCommitStatus = "committed" | "committed_render_stale" | "rejected";
interface TerrainReceiptEntry { transaction: VoxelEditTransaction }

export function createTerrainEditService(deps: TerrainEditServiceDeps): TerrainEditService {
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let vegetationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDigAt = -Infinity;
  let digInFlight = false;
  let editOperationTail: Promise<void> = Promise.resolve();
  const queuedDigRays: Array<{ ray: THREE.Ray; enqueuedAtMs: number }> = [];
  let scheduledDigRay: THREE.Ray | null = null;
  const pendingGrassNodeIds = new Set<string>();
  const pendingTreeNodeIds = new Set<string>();
  const pendingUnderstoryNodeIds = new Set<string>();
  const terrainReceipts = new Map<string, TerrainReceiptEntry>();

  const authorityOrigin = (): THREE.Vector3 | null => deps.getAuthorityOrigin?.() ?? null;
  const authorityCounters = (): Record<string, number> | null => deps.getAuthorityCounters?.() ?? null;

  const flushVegetationRebuilds = () => {
    vegetationFlushTimer = null;
    const veg = deps.getVegetationState();
    const rebuild = (
      enabled: boolean,
      pending: Set<string>,
      system: { rebuildNodePatches(ids: string[]): void; markPatchesDirty?(): void } | null,
      refresh: () => void,
      label: string,
    ) => {
      if (!enabled || pending.size === 0) return;
      const ids = [...pending];
      try {
        if (system?.markPatchesDirty) system.markPatchesDirty();
        else system?.rebuildNodePatches(ids);
        refresh();
        for (const id of ids) pending.delete(id);
      } catch (error) {
        console.error(`${label} rebuild after terrain edit failed:`, error);
      }
    };
    rebuild(veg.grassEnabled, pendingGrassNodeIds, deps.grassSystem, deps.refreshGrassStats, "grass");
    rebuild(veg.treesEnabled, pendingTreeNodeIds, deps.treeSystem, deps.refreshTreeStats, "tree");
    rebuild(veg.understoryEnabled, pendingUnderstoryNodeIds, deps.understorySystem, deps.refreshUnderstoryStats, "understory");
    const stillPending = (veg.grassEnabled && pendingGrassNodeIds.size > 0)
      || (veg.treesEnabled && pendingTreeNodeIds.size > 0)
      || (veg.understoryEnabled && pendingUnderstoryNodeIds.size > 0);
    if (stillPending) vegetationFlushTimer = setTimeout(flushVegetationRebuilds, VEGETATION_REBUILD_RETRY_MS);
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

  const performDig = async (ray: THREE.Ray) => {
    const hit = deps.terrainRaycast.raycastEditableTerrain(ray);
    if (!hit) { deps.setLastDigSummary("no terrain under brush"); deps.updateInfo(); return; }
    if (!terrainCommitAllowed(hit.point)) return;
    const brush = deps.getBrushParams();
    const edit: DigEdit = {
      x: hit.point.x, y: hit.point.y, z: hit.point.z, r: brush.digRadius,
      shape: brush.brushShape, op: brush.brushOp,
      material: brush.brushOp === "add" ? brush.brushMaterial : undefined,
      height: brush.brushHeight, strength: brush.brushStrength, falloff: brush.brushFalloff,
    };
    const transaction = voxelTransactionFromDigEdit(edit);
    if (transaction.deltas.length === 0) { deps.setLastDigSummary("no terrain changed"); deps.updateInfo(); return; }
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction, edit);
    emitAudio(brush.brushOp === "add" ? "terrain.raise" : "terrain.dig.tick");
    const status = await performEditRebuild(edit, transaction, hit, brush.digRadius, `${brush.brushOp} ${brush.brushShape}`);
    if (status === "rejected") rollbackDigEditTransaction(transaction);
    syncPaintedTerrainState(hadPaintedTerrain);
    deps.updateInfo();
  };

  const runDigExclusive = async (ray: THREE.Ray): Promise<void> => {
    if (digInFlight) {
      const previous = queuedDigRays[queuedDigRays.length - 1];
      if (!previous || previous.ray.origin.distanceTo(ray.origin) > 0.25 || previous.ray.direction.distanceTo(ray.direction) > 0.01) {
        queuedDigRays.push({ ray: ray.clone(), enqueuedAtMs: performance.now() });
        if (queuedDigRays.length > MAX_PENDING_DIG_SAMPLES) queuedDigRays.shift();
      }
      return;
    }
    digInFlight = true;
    try { await enqueueEditOperation("terrain brush", () => performDig(ray)); }
    finally {
      digInFlight = false;
      let next = queuedDigRays.shift() ?? null;
      while (next && performance.now() - next.enqueuedAtMs > DEFAULT_EDIT_COMMAND_EXPIRY_MS) {
        gameplayDiagnostics.add("edit_commands_expired");
        next = queuedDigRays.shift() ?? null;
      }
      if (next) void runDigExclusive(next.ray);
    }
  };

  const previewConstructionTerrainConform = (
    request: ConstructionTerrainConformRequest,
  ): ConstructionTerrainConformPreview => {
    if (deps.editAuthority) {
      const decision = canCommitBuild(deps.editAuthority, authorityOrigin(), request.position);
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

  const rebuildMetadataForRequest = (request: ConstructionTerrainConformRequest): { edit: DigEdit; hit: TerrainRebuildHit; radius: number } => {
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
  ): Promise<ConstructionTerrainConformCommitResult> => enqueueEditOperation("construction terrain conform", async () => {
    const preview = previewConstructionTerrainConform(request);
    if (!preview.valid) return { committed: false, reason: preview.reason, changed: false, receipt: null };
    if (!preview.changed) return { committed: true, reason: null, changed: false, receipt: null };
    const transaction = voxelTransactionFromTerrainConform(terrainEditForRequest(request));
    if (transaction.deltas.length === 0) return { committed: true, reason: null, changed: false, receipt: null };
    const hadPaintedTerrain = hasPaintedTerrainEdits();
    applyDigEditTransaction(transaction);
    const metadata = rebuildMetadataForRequest(request);
    const status = await performEditRebuild(metadata.edit, transaction, metadata.hit, metadata.radius, "construction terrain conform");
    if (status === "rejected") {
      rollbackDigEditTransaction(transaction);
      syncPaintedTerrainState(hadPaintedTerrain);
      return { committed: false, reason: "terrain rebuild rejected", changed: false, receipt: null };
    }
    syncPaintedTerrainState(hadPaintedTerrain);
    emitAudio("terrain.raise");
    const receipt = { id: `construction-terrain-${transaction.id}` };
    terrainReceipts.set(receipt.id, { transaction });
    return { committed: true, reason: null, changed: true, receipt };
  });

  const undoConstructionTerrainConform = async (
    receipt: ConstructionTerrainConformReceipt,
  ): Promise<ConstructionTerrainConformUndoResult> => enqueueEditOperation("construction terrain undo", async () => {
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
    const status = await performEditRebuild(
      edit,
      inverse,
      { point: new THREE.Vector3(centerX, edit.y, centerZ) },
      radius,
      "construction terrain undo",
    );
    if (status === "rejected") {
      rollbackDigEditTransaction(inverse);
      syncPaintedTerrainState(hadPaintedTerrain);
      return { undone: false, reason: "terrain undo rebuild rejected" };
    }
    terrainReceipts.delete(receipt.id);
    syncPaintedTerrainState(hadPaintedTerrain);
    return { undone: true, reason: null };
  });

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

  return {
    scheduleDig,
    runDigNow: (ray) => runDigExclusive(ray),
    scheduleConstructionTerrainConform: (request) => { void commitConstructionTerrainConform(request); },
    previewConstructionTerrainConform,
    commitConstructionTerrainConform,
    undoConstructionTerrainConform,
    forgetConstructionTerrainConform: (receipt) => { terrainReceipts.delete(receipt.id); },
    flushAncestors: async () => { await editOperationTail; await deps.clodWorker.flushParents(); },
    get lastDigAt() { return lastDigAt; },
  };
}
