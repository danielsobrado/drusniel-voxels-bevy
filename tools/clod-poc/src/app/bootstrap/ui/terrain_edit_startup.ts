import * as THREE from "three";
import playerEditingConfigText from "../../../../config/player/player_editing.yaml?raw";
import { setActiveConstructionTerrainConformHandler } from "../../../construction/construction_terrain_registry.js";
import type { ConstructionTerrainConformRequest } from "../../../construction/types.js";
import { flushSaveRuntimeOnce, markSaveRegionsDirtyForBounds } from "../../../save/save_runtime.js";
import { getDigEditRevision, voxelEditCount } from "../../../terrain/terrain.js";
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
import { setRenderedClodOwnershipKeySource } from "../../../stream/clod_ownership_keys.js";

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
  const renderedRootKeys = () => input.result.roots.map((node) => node.id);
  setRenderedClodOwnershipKeySource(renderedRootKeys);

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

  const terrainEditService = createTerrainEditService({
    clodWorker,
    terrainRaycast,
    getBrushParams: () => ({
      digRadius: state.digRadius,
      brushShape: state.brushShape,
      brushOp: state.brushOp,
      brushMaterial: state.brushMaterial,
      brushHeight: state.brushHeight,
      brushStrength: state.brushStrength,
      brushFalloff: state.brushFalloff,
    }),
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
    editReadyAt: (x, z) => editTargetAcceptable(readinessFeeds, x, z),
    dirtyQueue,
    refreshGrassStats: () => bindings.refreshGrassStats(),
    refreshTreeStats: () => bindings.refreshTreeStats(),
    refreshUnderstoryStats: () => bindings.refreshUnderstoryStats(),
    updateInfo,
    setLastDigSummary: (summary) => { session.lastDigSummary = summary; },
    setPendingParentCount: (count) => { session.pendingParentCount = count; },
    setPendingParentNodes: (nodes) => { session.pendingParentNodes = nodes; },
    setPendingParentMs: (ms) => { session.pendingParentMs = ms; },
  });

  setActiveConstructionTerrainConformHandler({
    preview: (request) => terrainEditService.previewConstructionTerrainConform(request),
    commit: (request) => terrainEditService.commitConstructionTerrainConform(request),
    undo: (receipt) => terrainEditService.undoConstructionTerrainConform(receipt),
    forget: (receipt) => terrainEditService.forgetConstructionTerrainConform(receipt),
  });

  if (input.longView.hooks) {
    input.longView.hooks.getStreamingRootReadyPageKeys = renderedRootKeys;
    input.longView.hooks.getStreamingResidencySnapshot = () => {
      const farSummary = (window as typeof window & {
        __drusnielFarSummary?: Partial<FarSummaryIntegration>;
      }).__drusnielFarSummary;
      return {
        clodCachedKeys: session.streamingClodRootController?.cachedPageKeys() ?? [],
        farSummaryResidentKeys: farSummary?.cache?.residentTileKeys() ?? [],
        heightfieldResidentKeys: heightfieldTileResidentKeys(),
        vegetationClusterKeys: null,
        waterHydrologyKeys: null,
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
