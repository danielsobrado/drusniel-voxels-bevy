import * as THREE from "three";
import playerEditingConfigText from "../../../../config/player/player_editing.yaml?raw";
import { setActiveConstructionTerrainConformHandler } from "../../../construction/construction_terrain_registry.js";
import type { ConstructionTerrainConformRequest } from "../../../construction/types.js";
import { createPlayableSliceSnapshot } from "../../../qa/playable_slice_snapshot.js";
import {
  destroyEnvironmentalPropCandidate,
  flushSaveRuntimeOnce,
  getSaveRuntimePropExclusions,
  getSaveRuntimeWorldId,
  hasActiveSaveRuntime,
  markSaveRegionsDirtyForBounds,
} from "../../../save/save_runtime.js";
import { getDigEditRevision, voxelEditCount } from "../../../terrain/terrain.js";
import { createCommandGuardedTerrainEditService } from "../../../terrain/editing/terrain_edit_command_service.js";
import { createTerrainEditService } from "../../../terrain/editing/terrain_edit_service.js";
import { TerrainEditDirtyQueue, type TerrainEditDirtyEvent } from "../../../terrain/editing/terrain_edit_dirty_queue.js";
import {
  canCommitBuild,
  publishPlayerEditAuthorityDecision,
  resolvePlayerEditAuthorityConfig,
} from "../../../player/player_edit_authority.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";
import { createAppCellReadinessFeeds, editTargetAcceptable } from "../../../player/cell_readiness.js";
import { heightfieldTileResidentKeys } from "../../../world/heightfield_tiles/heightfield_tile_client_runtime.js";
import type { FarSummaryIntegration } from "../../../far-summary/integration.js";
import { lookupEnvironmentalPropHit } from "../../../world/prop_interaction_lookup.js";
import { treeInstanceToFallingInstance } from "../../../trees/tree_system_patch_removal.js";
import type { TreeSpeciesId } from "../../../trees/tree_config_types.js";
import { treeResidencyClusterKeys } from "../../../trees/tree_residency_keys.js";

export interface TerrainEditStartupResult {
  terrainEditService: ReturnType<typeof createTerrainEditService>;
  flushAncestors: () => Promise<void>;
  scheduleDig: (ray: THREE.Ray) => void;
  scheduleConstructionTerrainConform: (request: ConstructionTerrainConformRequest) => void;
  playerTerraformEditActive: () => boolean;
  setTerrainEditDirtyListener: (listener: ((event: TerrainEditDirtyEvent) => void) | null) => void;
}

class SaveTrackingDirtyQueue extends TerrainEditDirtyQueue {
  onEnqueue: ((event: TerrainEditDirtyEvent) => void) | null = null;

  enqueue(event: TerrainEditDirtyEvent): void {
    super.enqueue(event);
    markSaveRegionsDirtyForBounds({
      minX: event.worldAabb.minX,
      minZ: event.worldAabb.minZ,
      maxX: event.worldAabb.maxX,
      maxZ: event.worldAabb.maxZ,
    });
    this.onEnqueue?.(event);
  }
}

export function runTerrainEditStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
): TerrainEditStartupResult {
  const { input, session } = ctx;
  const { clodWorker, terrainRaycast, state, bindings, markEditedAncestorsStale } = input;
  const { clodApplyQueue, selectionController, updateSelection, applyTerrainTextures } = input.terrainView;
  const { grassSystem, treeSystem, understorySystem, fallingTrees } = input.runtime;
  const { updateInfo } = infoPanel;
  const editAuthority = resolvePlayerEditAuthorityConfig(playerEditingConfigText, input.searchParams);
  const readinessFeeds = createAppCellReadinessFeeds({ terrainColliders: input.terrainColliders });
  const dirtyQueue = new SaveTrackingDirtyQueue();
  const authorityOrigin = () => input.interaction.mode === "playing" ? input.player.position : null;
  const authorityCounters = () => input.longView.hooks?.stats?.counters ?? null;
  const getInteractionMode = () => input.interaction.mode;
  const editReadyAt = (x: number, z: number) => editTargetAcceptable(readinessFeeds, x, z);
  const getBrushParams = () => ({
    digRadius: state.digRadius,
    brushShape: state.brushShape,
    brushOp: state.brushOp,
    brushMaterial: state.brushMaterial,
    brushHeight: state.brushHeight,
    brushStrength: state.brushStrength,
    brushFalloff: state.brushFalloff,
  });
  const setLastDigSummary = (summary: string) => { session.lastDigSummary = summary; };

  clodWorker.onParentRebuilt = (batch) => {
    clodApplyQueue.recordWorkerRebuild(batch.parentMs);
    clodApplyQueue.enqueueNodes(batch.changed);
    selectionController.patchNodes(batch.changed);
    session.pendingParentNodes = batch.parentNodes;
    session.pendingParentMs = batch.parentMs;
    session.pendingParentCount = batch.pendingParents;
    selectionController.invalidate();
    updateInfo();
  };
  clodWorker.onParentsComplete = (_requestId, parentNodes, parentMs) => {
    session.pendingParentNodes = parentNodes;
    session.pendingParentMs = parentMs;
    session.pendingParentCount = 0;
    if (parentNodes > 0) {
      session.lastDigSummary = `${session.lastDigSummary} + ancestors ${parentNodes}n ${parentMs.toFixed(0)}ms`;
    }
    updateSelection();
    updateInfo();
  };

  const playerTerraformEditActive = () => {
    if (session.constructionBuildActive) return false;
    return session.terraformEditCheckbox?.checked ?? session.terraformEditActive;
  };

  const baseTerrainEditService = createTerrainEditService({
    clodWorker,
    terrainRaycast,
    getBrushParams,
    getVegetationState: () => ({
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
    }),
    enqueueApplyNodes: (nodes) => clodApplyQueue.enqueueNodes(nodes),
    applyNearFieldChunks: (patches) => {
      for (const patch of patches) input.terrainView.nearFieldBubbleController.invalidatePage(patch.nodeId);
    },
    invalidateStreamedRoots: (bounds) => session.streamingClodRootController?.invalidateBounds(bounds),
    recordClodWorkerRebuild: (ms) => clodApplyQueue.recordWorkerRebuild(ms),
    markEditedAncestorsStale,
    selectionController,
    applyTerrainTextures,
    grassSystem,
    treeSystem,
    understorySystem,
    fallingTrees,
    editAuthority,
    getAuthorityOrigin: authorityOrigin,
    getAuthorityCounters: authorityCounters,
    getInteractionMode,
    editReadyAt,
    dirtyQueue,
    refreshGrassStats: () => bindings.refreshGrassStats(),
    refreshTreeStats: () => bindings.refreshTreeStats(),
    refreshUnderstoryStats: () => bindings.refreshUnderstoryStats(),
    updateInfo,
    setLastDigSummary,
    setPendingParentCount: (count) => { session.pendingParentCount = count; },
    setPendingParentNodes: (nodes) => { session.pendingParentNodes = nodes; },
    setPendingParentMs: (ms) => { session.pendingParentMs = ms; },
  });
  const terrainEditService = createCommandGuardedTerrainEditService(baseTerrainEditService, {
    terrainRaycast,
    getBrushParams,
    editAuthority,
    getAuthorityOrigin: authorityOrigin,
    getInteractionMode,
    getTerrainRevision: getDigEditRevision,
    editReadyAt,
    setLastDigSummary,
    updateInfo,
  });

  setActiveConstructionTerrainConformHandler({
    preview: (request) => terrainEditService.previewConstructionTerrainConform(request),
    commit: (request) => terrainEditService.commitConstructionTerrainConform(request),
    undo: (receipt) => terrainEditService.undoConstructionTerrainConform(receipt),
    forget: (receipt) => terrainEditService.forgetConstructionTerrainConform(receipt),
  });

  if (input.longView.hooks) {
    input.longView.hooks.getPlayableSliceSnapshot = () => createPlayableSliceSnapshot({
      player: input.player,
      constructionController: input.runtime.constructionController,
      stats: input.longView.hooks?.stats ?? null,
      terrainRevision: getDigEditRevision(),
      voxelDeltaCount: voxelEditCount(),
      pageSizeM: input.cfg.page.chunk_size * input.cfg.page.chunks_per_page,
    });
    input.longView.hooks.getStreamingRootReadyPageKeys = () =>
      session.streamingClodRootController?.readyPageKeys() ?? [];
    input.longView.hooks.getStreamingResidencySnapshot = () => {
      const farSummary = (window as typeof window & {
        __drusnielFarSummary?: Partial<FarSummaryIntegration>;
      }).__drusnielFarSummary;
      return {
        clodCachedKeys: session.streamingClodRootController?.cachedPageKeys() ?? [],
        farSummaryResidentKeys: farSummary?.cache?.residentTileKeys() ?? [],
        heightfieldResidentKeys: heightfieldTileResidentKeys(),
        vegetationClusterKeys: treeSystem.settings.enabled ? treeResidencyClusterKeys({
          cpuPatchKeys: treeSystem.patches.map((patch) => patch.nodeId),
          centerX: treeSystem.lastCenter.x,
          centerZ: treeSystem.lastCenter.z,
          radiusM: treeSystem.settings.distanceM,
        }) : [],
        waterHydrologyKeys: input.runtime.hydrologySystem?.residentTileKeys() ?? null,
      };
    };
    input.longView.hooks.runTerrainEditProbe = async (ray) => {
      await terrainEditService.runDigNow(new THREE.Ray(
        new THREE.Vector3(...ray.origin),
        new THREE.Vector3(...ray.direction).normalize(),
      ));
      await terrainEditService.flushAncestors();
      await flushSaveRuntimeOnce(Number.MAX_SAFE_INTEGER);
      const counters = authorityCounters() ?? {};
      return {
        editRevision: getDigEditRevision(),
        voxelDeltaCount: voxelEditCount(),
        dirtyRevision: counters["terrain_edit_dirty_revision"] ?? 0,
        streamInvalidations: counters["live_clod_stream_invalidations_total"] ?? 0,
        streamRebuilds: counters["live_clod_stream_rebuilt_after_invalidation_total"] ?? 0,
      };
    };
    input.longView.hooks.scheduleDig = (ray) => {
      terrainEditService.scheduleDig(new THREE.Ray(
        new THREE.Vector3(...ray.origin),
        new THREE.Vector3(...ray.direction).normalize(),
      ));
    };
    input.longView.hooks.flushSaveRuntime = async () => {
      await flushSaveRuntimeOnce(Number.MAX_SAFE_INTEGER);
    };
    input.longView.hooks.queryEnvironmentalPropExclusion = (query) => {
      const worldId = getSaveRuntimeWorldId() ?? window.__drusnielWorldManifest?.worldId;
      if (!worldId) return null;
      const layer = query.layer ?? "tree";
      const spacing = Math.max(0.5, query.candidateSpacingM ?? treeSystem.settings.placement.spacingM);
      const hit = lookupEnvironmentalPropHit(worldId, layer, query.position, spacing);
      return {
        propId: hit.propId,
        excluded: getSaveRuntimePropExclusions().isExcluded(hit.address),
        address: hit.address,
      };
    };
    input.longView.hooks.destroyEnvironmentalProp = async (destroyInput) => {
      if (!hasActiveSaveRuntime()) {
        return { ok: false, propId: null, dirtyRegions: [], reason: "save runtime inactive (pass ?save=...)" };
      }
      const worldId = getSaveRuntimeWorldId() ?? window.__drusnielWorldManifest?.worldId;
      if (!worldId) {
        return { ok: false, propId: null, dirtyRegions: [], reason: "world manifest missing" };
      }
      const layer = destroyInput.layer ?? "stone";
      const spacing = Math.max(0.5, destroyInput.candidateSpacingM ?? (layer === "tree" ? treeSystem.settings.placement.spacingM : 8));
      const hit = lookupEnvironmentalPropHit(worldId, layer, destroyInput.position, spacing);
      const prefabId = destroyInput.prefabId
        ?? (layer === "tree" ? "environment/tree" : layer === "grass" ? "environment/grass" : "environment/stone");
      const dirtyRegions = destroyEnvironmentalPropCandidate(hit.address, hit.worldPosition, prefabId);
      if (destroyInput.flush !== false) await flushSaveRuntimeOnce(Number.MAX_SAFE_INTEGER);
      return { ok: true, propId: hit.propId, dirtyRegions, reason: null };
    };
    input.longView.hooks.fellTree = async (fellInput) => {
      if (!hasActiveSaveRuntime()) {
        return { ok: false, propId: null, falling: false, dirtyRegions: [], reason: "save runtime inactive (pass ?save=...)" };
      }
      const worldId = getSaveRuntimeWorldId() ?? window.__drusnielWorldManifest?.worldId;
      if (!worldId) {
        return { ok: false, propId: null, falling: false, dirtyRegions: [], reason: "world manifest missing" };
      }
      const spacing = Math.max(0.5, fellInput.candidateSpacingM ?? treeSystem.settings.placement.spacingM);
      const hit = lookupEnvironmentalPropHit(worldId, "tree", fellInput.position, spacing);
      const dirtyRegions = destroyEnvironmentalPropCandidate(hit.address, hit.worldPosition, "environment/tree");
      const maxDist = Math.max(spacing, fellInput.maxDistanceM ?? spacing * 1.5);
      const maxDist2 = maxDist * maxDist;
      let nearest: { patchIndex: number; instanceIndex: number } | null = null;
      let bestDist2 = maxDist2;
      for (let patchIndex = 0; patchIndex < treeSystem.patches.length; patchIndex += 1) {
        const patch = treeSystem.patches[patchIndex]!;
        for (let instanceIndex = 0; instanceIndex < patch.instances.length; instanceIndex += 1) {
          const instance = patch.instances[instanceIndex]!;
          const dx = instance.position[0] - fellInput.position[0];
          const dz = instance.position[2] - fellInput.position[2];
          const dist2 = dx * dx + dz * dz;
          if (dist2 <= bestDist2) {
            bestDist2 = dist2;
            nearest = { patchIndex, instanceIndex };
          }
        }
      }
      let falling = false;
      if (nearest) {
        const patch = treeSystem.patches[nearest.patchIndex]!;
        const instance = patch.instances[nearest.instanceIndex]!;
        fallingTrees.push(treeInstanceToFallingInstance(instance));
        patch.instances.splice(nearest.instanceIndex, 1);
        treeSystem.markPatchesDirty();
        falling = true;
      } else {
        const species = "oak" as TreeSpeciesId;
        fallingTrees.push({
          position: [hit.worldPosition[0], hit.worldPosition[1], hit.worldPosition[2]],
          velocity: 0,
          originalY: hit.worldPosition[1],
          species,
          scale: 1,
          rotationY: 0,
          normalY: 1,
        });
        falling = true;
        treeSystem.markPatchesDirty();
      }
      if (fellInput.flush !== false) await flushSaveRuntimeOnce(Number.MAX_SAFE_INTEGER);
      return { ok: true, propId: hit.propId, falling, dirtyRegions, reason: null };
    };
  }

  const scheduleConstructionTerrainConform = (request: ConstructionTerrainConformRequest): void => {
    const decision = canCommitBuild(editAuthority, authorityOrigin(), request.position);
    publishPlayerEditAuthorityDecision(authorityCounters(), decision);
    if (!decision.allowed) {
      session.lastDigSummary = `construction terrain conform rejected: ${decision.reason}`;
      updateInfo();
      return;
    }
    terrainEditService.scheduleConstructionTerrainConform(request);
  };

  return {
    terrainEditService,
    flushAncestors: () => terrainEditService.flushAncestors(),
    scheduleDig: (ray) => terrainEditService.scheduleDig(ray),
    scheduleConstructionTerrainConform,
    playerTerraformEditActive,
    setTerrainEditDirtyListener: (listener) => { dirtyQueue.onEnqueue = listener; },
  };
}
