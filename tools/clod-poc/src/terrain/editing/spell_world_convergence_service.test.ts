import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import type { ClodPageNode } from "../../types.js";
import {
  clearDigEdits,
  getDigEditRevision,
  voxelEditCount,
} from "../../terrain/terrain.js";
import { createEditCommand } from "../../player/edit_commands.js";
import { TerrainEditDirtyQueue } from "./terrain_edit_dirty_queue.js";
import {
  createTerrainEditService,
  type TerrainSpellEditRequest,
} from "./terrain_edit_service.js";

function changedNode(id: string): ClodPageNode {
  return { id } as ClodPageNode;
}

describe("spell-to-world convergence service", () => {
  beforeEach(() => clearDigEdits());
  afterEach(() => clearDigEdits());

  it("commits one earth cast through every terrain convergence consumer", async () => {
    const changed = changedNode("L0:0,0");
    const counters: Record<string, number> = {};
    const dirtyQueue = new TerrainEditDirtyQueue();
    const rebuildAfterDig = vi.fn(async () => ({
      changed: [changed],
      dirtyCoords: [[0, 0] as [number, number]],
      lod0Pages: 1,
      lod0Ms: 2,
      serializeMs: 0.2,
      serializedBytes: 128,
      chunksRemeshed: 2,
      chunksTotal: 4,
      pendingParents: 1,
      requestCount: 1,
      chunkPatches: [{ nodeId: changed.id, revision: 1, chunks: [] }],
      fullPageFallbacks: 0,
      pageWeldMs: 0.1,
    }));
    const flushParents = vi.fn(async () => undefined);
    const clodWorker = { rebuildAfterDig, flushParents } as unknown as ClodWorkerClient;
    const enqueueApplyNodes = vi.fn();
    const applyNearFieldChunks = vi.fn();
    const invalidateStreamedRoots = vi.fn();
    const markEditedAncestorsStale = vi.fn();
    const patchNodes = vi.fn();
    const invalidateSelection = vi.fn();
    const grassDirty = vi.fn();
    const treeDirty = vi.fn();
    const understoryDirty = vi.fn();
    const refreshGrass = vi.fn();
    const refreshTrees = vi.fn();
    const refreshUnderstory = vi.fn();
    const onAuthoritativeCommit = vi.fn();

    const service = createTerrainEditService({
      clodWorker,
      terrainRaycast: { raycastEditableTerrain: vi.fn() } as never,
      getBrushParams: () => ({
        digRadius: 1,
        brushShape: "sphere",
        brushOp: "remove",
        brushMaterial: 0,
        brushHeight: 1,
        brushStrength: 1,
        brushFalloff: 0,
      }),
      getVegetationState: () => ({ grassEnabled: true, treesEnabled: true, understoryEnabled: true }),
      enqueueApplyNodes,
      applyNearFieldChunks,
      invalidateStreamedRoots,
      recordClodWorkerRebuild: vi.fn(),
      markEditedAncestorsStale,
      selectionController: { patchNodes, invalidate: invalidateSelection },
      applyTerrainTextures: vi.fn(),
      grassSystem: { rebuildNodePatches: vi.fn(), markPatchesDirty: grassDirty },
      treeSystem: { rebuildNodePatches: vi.fn(), markPatchesDirty: treeDirty },
      understorySystem: { rebuildNodePatches: vi.fn(), markPatchesDirty: understoryDirty },
      fallingTrees: [],
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 80,
        buildPreviewRadiusM: 160,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => new THREE.Vector3(0, 80, 0),
      getAuthorityCounters: () => counters,
      getInteractionMode: () => "playing",
      editReadyAt: () => true,
      dirtyQueue,
      refreshGrassStats: refreshGrass,
      refreshTreeStats: refreshTrees,
      refreshUnderstoryStats: refreshUnderstory,
      updateInfo: vi.fn(),
      setLastDigSummary: vi.fn(),
      setPendingParentCount: vi.fn(),
      setPendingParentNodes: vi.fn(),
      setPendingParentMs: vi.fn(),
    });

    const sourceRevision = getDigEditRevision();
    const request: TerrainSpellEditRequest = {
      spellId: "earth",
      command: createEditCommand({
        operation: "spell_cast",
        targetPosition: [0, 80, 0],
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: sourceRevision,
        actor: "player",
        mode: "playing",
        nowMs: performance.now(),
        expiryMs: 3000,
      }),
      edit: {
        x: 0,
        y: 80,
        z: 0,
        r: 1.5,
        shape: "sphere",
        op: "add",
        material: 2,
        height: 1.5,
        strength: 1,
        falloff: 0,
      },
    };

    const result = await service.commitSpellTerrainEdit(request, onAuthoritativeCommit);

    expect(result).toMatchObject({ committed: true, changed: true, converged: true, reason: null });
    expect(result.editRevision).toBeGreaterThan(sourceRevision);
    expect(voxelEditCount()).toBeGreaterThan(0);
    expect(onAuthoritativeCommit).toHaveBeenCalledOnce();
    expect(rebuildAfterDig).toHaveBeenCalledOnce();
    expect(applyNearFieldChunks).toHaveBeenCalledOnce();
    expect(enqueueApplyNodes).toHaveBeenCalledWith([changed]);
    expect(invalidateStreamedRoots).toHaveBeenCalledOnce();
    expect(markEditedAncestorsStale).toHaveBeenCalledWith([changed]);
    expect(patchNodes).toHaveBeenCalledWith([changed]);
    expect(invalidateSelection).toHaveBeenCalled();
    expect(grassDirty).toHaveBeenCalled();
    expect(treeDirty).toHaveBeenCalled();
    expect(understoryDirty).toHaveBeenCalled();
    expect(refreshGrass).toHaveBeenCalled();
    expect(refreshTrees).toHaveBeenCalled();
    expect(refreshUnderstory).toHaveBeenCalled();
    expect(flushParents).toHaveBeenCalledOnce();
    expect(dirtyQueue.peek()).toEqual([
      expect.objectContaining({ reason: "spell", affectsCollision: true, affectsVegetation: true }),
    ]);
    expect(counters["spell_world_casts_accepted"]).toBe(1);
    expect(counters["spell_world_edits_committed"]).toBe(1);
    expect(counters["spell_world_convergence_completed"]).toBe(1);
    expect(counters["spell_world_last_converged_revision"]).toBe(result.editRevision);
  });

  it("denies a stale spell command without replaying or mutating terrain", async () => {
    const rebuildAfterDig = vi.fn();
    const service = createTerrainEditService({
      clodWorker: { rebuildAfterDig, flushParents: vi.fn() } as unknown as ClodWorkerClient,
      terrainRaycast: { raycastEditableTerrain: vi.fn() } as never,
      getBrushParams: () => ({
        digRadius: 1,
        brushShape: "sphere",
        brushOp: "remove",
        brushMaterial: 0,
        brushHeight: 1,
        brushStrength: 1,
        brushFalloff: 0,
      }),
      getVegetationState: () => ({ grassEnabled: false, treesEnabled: false, understoryEnabled: false }),
      enqueueApplyNodes: vi.fn(),
      recordClodWorkerRebuild: vi.fn(),
      markEditedAncestorsStale: vi.fn(),
      selectionController: { patchNodes: vi.fn(), invalidate: vi.fn() },
      applyTerrainTextures: vi.fn(),
      grassSystem: null,
      treeSystem: null,
      understorySystem: null,
      fallingTrees: [],
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 80,
        buildPreviewRadiusM: 160,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => new THREE.Vector3(),
      getAuthorityCounters: () => ({}),
      getInteractionMode: () => "playing",
      editReadyAt: () => true,
      refreshGrassStats: vi.fn(),
      refreshTreeStats: vi.fn(),
      refreshUnderstoryStats: vi.fn(),
      updateInfo: vi.fn(),
      setLastDigSummary: vi.fn(),
      setPendingParentCount: vi.fn(),
      setPendingParentNodes: vi.fn(),
      setPendingParentMs: vi.fn(),
    });
    const onAuthoritativeCommit = vi.fn();
    const request: TerrainSpellEditRequest = {
      spellId: "earth",
      command: createEditCommand({
        operation: "spell_cast",
        targetPosition: [0, 20, 0],
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: getDigEditRevision() - 1,
        actor: "player",
        mode: "playing",
        nowMs: performance.now(),
      }),
      edit: { x: 0, y: 20, z: 0, r: 1, op: "remove" },
    };

    const before = voxelEditCount();
    const result = await service.commitSpellTerrainEdit(request, onAuthoritativeCommit);

    expect(result).toMatchObject({ committed: false, converged: false, reason: "revision_mismatch" });
    expect(voxelEditCount()).toBe(before);
    expect(rebuildAfterDig).not.toHaveBeenCalled();
    expect(onAuthoritativeCommit).not.toHaveBeenCalled();
  });

  it("treats empty-delta spells as non-success without VFX or convergence counters", async () => {
    const counters: Record<string, number> = {};
    const rebuildAfterDig = vi.fn();
    const onAuthoritativeCommit = vi.fn();
    const service = createTerrainEditService({
      clodWorker: { rebuildAfterDig, flushParents: vi.fn() } as unknown as ClodWorkerClient,
      terrainRaycast: { raycastEditableTerrain: vi.fn() } as never,
      getBrushParams: () => ({
        digRadius: 1,
        brushShape: "sphere",
        brushOp: "remove",
        brushMaterial: 0,
        brushHeight: 1,
        brushStrength: 1,
        brushFalloff: 0,
      }),
      getVegetationState: () => ({ grassEnabled: false, treesEnabled: false, understoryEnabled: false }),
      enqueueApplyNodes: vi.fn(),
      recordClodWorkerRebuild: vi.fn(),
      markEditedAncestorsStale: vi.fn(),
      selectionController: { patchNodes: vi.fn(), invalidate: vi.fn() },
      applyTerrainTextures: vi.fn(),
      grassSystem: null,
      treeSystem: null,
      understorySystem: null,
      fallingTrees: [],
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 80,
        buildPreviewRadiusM: 160,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => new THREE.Vector3(0, 80, 0),
      getAuthorityCounters: () => counters,
      getInteractionMode: () => "playing",
      editReadyAt: () => true,
      refreshGrassStats: vi.fn(),
      refreshTreeStats: vi.fn(),
      refreshUnderstoryStats: vi.fn(),
      updateInfo: vi.fn(),
      setLastDigSummary: vi.fn(),
      setPendingParentCount: vi.fn(),
      setPendingParentNodes: vi.fn(),
      setPendingParentMs: vi.fn(),
    });

    const result = await service.commitSpellTerrainEdit({
      spellId: "earth",
      command: createEditCommand({
        operation: "spell_cast",
        targetPosition: [0, 80, 0],
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: getDigEditRevision(),
        actor: "player",
        mode: "playing",
        nowMs: performance.now(),
        expiryMs: 3000,
      }),
      // Tiny strength at empty air typically yields no voxel deltas for remove.
      edit: { x: 0, y: 80, z: 0, r: 0.01, op: "remove", strength: 0, falloff: 0 },
    }, onAuthoritativeCommit);

    expect(result).toMatchObject({
      committed: false,
      changed: false,
      converged: false,
      reason: "no_change",
    });
    expect(onAuthoritativeCommit).not.toHaveBeenCalled();
    expect(rebuildAfterDig).not.toHaveBeenCalled();
    expect(counters["spell_world_casts_accepted"]).toBeUndefined();
    expect(counters["spell_world_convergence_completed"]).toBeUndefined();
  });

  it("does not fire VFX when rebuild rejects and rolls voxels back", async () => {
    const counters: Record<string, number> = {};
    const onAuthoritativeCommit = vi.fn();
    const rebuildAfterDig = vi.fn(async () => {
      throw new Error("rebuild unavailable");
    });
    const service = createTerrainEditService({
      clodWorker: { rebuildAfterDig, flushParents: vi.fn() } as unknown as ClodWorkerClient,
      terrainRaycast: { raycastEditableTerrain: vi.fn() } as never,
      getBrushParams: () => ({
        digRadius: 1,
        brushShape: "sphere",
        brushOp: "remove",
        brushMaterial: 0,
        brushHeight: 1,
        brushStrength: 1,
        brushFalloff: 0,
      }),
      getVegetationState: () => ({ grassEnabled: false, treesEnabled: false, understoryEnabled: false }),
      enqueueApplyNodes: vi.fn(),
      recordClodWorkerRebuild: vi.fn(),
      markEditedAncestorsStale: vi.fn(),
      selectionController: { patchNodes: vi.fn(), invalidate: vi.fn() },
      applyTerrainTextures: vi.fn(),
      grassSystem: null,
      treeSystem: null,
      understorySystem: null,
      fallingTrees: [],
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 80,
        buildPreviewRadiusM: 160,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => new THREE.Vector3(0, 80, 0),
      getAuthorityCounters: () => counters,
      getInteractionMode: () => "playing",
      editReadyAt: () => true,
      refreshGrassStats: vi.fn(),
      refreshTreeStats: vi.fn(),
      refreshUnderstoryStats: vi.fn(),
      updateInfo: vi.fn(),
      setLastDigSummary: vi.fn(),
      setPendingParentCount: vi.fn(),
      setPendingParentNodes: vi.fn(),
      setPendingParentMs: vi.fn(),
    });

    const before = voxelEditCount();
    const result = await service.commitSpellTerrainEdit({
      spellId: "earth",
      command: createEditCommand({
        operation: "spell_cast",
        targetPosition: [0, 80, 0],
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: getDigEditRevision(),
        actor: "player",
        mode: "playing",
        nowMs: performance.now(),
        expiryMs: 3000,
      }),
      edit: {
        x: 0, y: 80, z: 0, r: 1.5, shape: "sphere", op: "add", material: 2,
        height: 1.5, strength: 1, falloff: 0,
      },
    }, onAuthoritativeCommit);

    expect(result).toMatchObject({
      committed: false,
      changed: false,
      converged: false,
      reason: "terrain_rebuild_rejected",
    });
    expect(onAuthoritativeCommit).not.toHaveBeenCalled();
    expect(voxelEditCount()).toBe(before);
    expect(counters["spell_world_casts_accepted"]).toBeUndefined();
    expect(counters["spell_world_convergence_failed"]).toBe(1);
  });

  it("fails closed when spell authority deps are missing", async () => {
    const service = createTerrainEditService({
      clodWorker: { rebuildAfterDig: vi.fn(), flushParents: vi.fn() } as unknown as ClodWorkerClient,
      terrainRaycast: { raycastEditableTerrain: vi.fn() } as never,
      getBrushParams: () => ({
        digRadius: 1,
        brushShape: "sphere",
        brushOp: "remove",
        brushMaterial: 0,
        brushHeight: 1,
        brushStrength: 1,
        brushFalloff: 0,
      }),
      getVegetationState: () => ({ grassEnabled: false, treesEnabled: false, understoryEnabled: false }),
      enqueueApplyNodes: vi.fn(),
      recordClodWorkerRebuild: vi.fn(),
      markEditedAncestorsStale: vi.fn(),
      selectionController: { patchNodes: vi.fn(), invalidate: vi.fn() },
      applyTerrainTextures: vi.fn(),
      grassSystem: null,
      treeSystem: null,
      understorySystem: null,
      fallingTrees: [],
      getAuthorityOrigin: () => null,
      getAuthorityCounters: () => ({}),
      refreshGrassStats: vi.fn(),
      refreshTreeStats: vi.fn(),
      refreshUnderstoryStats: vi.fn(),
      updateInfo: vi.fn(),
      setLastDigSummary: vi.fn(),
      setPendingParentCount: vi.fn(),
      setPendingParentNodes: vi.fn(),
      setPendingParentMs: vi.fn(),
    });

    const result = await service.commitSpellTerrainEdit({
      spellId: "earth",
      command: createEditCommand({
        operation: "spell_cast",
        targetPosition: [0, 80, 0],
        targetNormal: [0, 1, 0],
        sourceTerrainRevision: getDigEditRevision(),
        actor: "player",
        mode: "playing",
        nowMs: performance.now(),
      }),
      edit: { x: 0, y: 80, z: 0, r: 1, op: "add", material: 2 },
    });

    expect(result).toMatchObject({ committed: false, converged: false, reason: "not_ready" });
  });
});
