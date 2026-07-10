import type * as THREE from "three";
import playerEditingConfigText from "../../../../config/player/player_editing.yaml?raw";
import type { ConstructionTerrainConformRequest } from "../../../construction/types.js";
import { markSaveRegionsDirtyForBounds } from "../../../save/save_runtime.js";
import { createTerrainEditService } from "../../../terrain/editing/terrain_edit_service.js";
import { TerrainEditDirtyQueue, type TerrainEditDirtyEvent } from "../../../terrain/editing/terrain_edit_dirty_queue.js";
import {
  canCommitBuild,
  canCommitTerrainEdit,
  publishPlayerEditAuthorityDecision,
  resolvePlayerEditAuthorityConfig,
} from "../../../player/player_edit_authority.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export interface TerrainEditStartupResult {
  terrainEditService: ReturnType<typeof createTerrainEditService>;
  flushAncestors: () => Promise<void>;
  scheduleDig: (ray: THREE.Ray) => void;
  scheduleConstructionTerrainConform: (request: ConstructionTerrainConformRequest) => void;
  playerTerraformEditActive: () => boolean;
}

class SaveTrackingDirtyQueue extends TerrainEditDirtyQueue {
  enqueue(event: TerrainEditDirtyEvent): void {
    super.enqueue(event);
    markSaveRegionsDirtyForBounds({
      minX: event.worldAabb.minX,
      minZ: event.worldAabb.minZ,
      maxX: event.worldAabb.maxX,
      maxZ: event.worldAabb.maxZ,
    });
  }
}

export function runTerrainEditStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
): TerrainEditStartupResult {
  const { input, session } = ctx;
  const {
    clodWorker,
    terrainRaycast,
    state,
    bindings,
    markEditedAncestorsStale,
  } = input;
  const {
    clodApplyQueue,
    selectionController,
    updateSelection,
    applyTerrainTextures,
  } = input.terrainView;
  const {
    grassSystem,
    treeSystem,
    understorySystem,
    fallingTrees,
  } = input.runtime;
  const { updateInfo } = infoPanel;
  const editAuthority = resolvePlayerEditAuthorityConfig(playerEditingConfigText, input.searchParams);
  const dirtyQueue = new SaveTrackingDirtyQueue();
  const authorityOrigin = () => input.interaction.mode === "playing" ? input.player.position : null;
  const authorityCounters = () => input.longView.hooks?.stats?.counters ?? null;

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
      for (const patch of patches) {
        // Worker patches are CPU-meshed while the live page may be GPU-meshed.
        // Rebuild the page with one backend until backend-consistent chunk patching is available.
        input.terrainView.nearFieldBubbleController.invalidatePage(patch.nodeId);
      }
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

  const scheduleDig = (ray: THREE.Ray): void => {
    const hit = terrainRaycast.raycastEditableTerrain(ray);
    if (hit) {
      const decision = canCommitTerrainEdit(editAuthority, authorityOrigin(), hit.point);
      publishPlayerEditAuthorityDecision(authorityCounters(), decision);
      if (!decision.allowed) {
        session.lastDigSummary = `terrain edit rejected: ${decision.reason}`;
        updateInfo();
        return;
      }
    }
    terrainEditService.scheduleDig(ray);
  };

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
    scheduleDig,
    scheduleConstructionTerrainConform,
    playerTerraformEditActive,
  };
}
