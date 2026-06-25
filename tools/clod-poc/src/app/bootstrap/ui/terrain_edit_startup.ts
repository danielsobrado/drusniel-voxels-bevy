import type * as THREE from "three";
import { createTerrainEditService } from "../../../terrain/editing/terrain_edit_service.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export interface TerrainEditStartupResult {
  terrainEditService: ReturnType<typeof createTerrainEditService>;
  flushAncestors: () => Promise<void>;
  scheduleDig: (ray: THREE.Ray) => void;
  playerTerraformEditActive: () => boolean;
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
    vegetationDirtyQueue,
    staleEditedAncestorIds,
  } = input;
  const {
    applyNodeMesh,
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

  clodWorker.onParentRebuilt = (batch) => {
    for (const node of batch.changed) {
      applyNodeMesh(node);
      staleEditedAncestorIds.delete(node.id);
    }
    selectionController.patchNodes(batch.changed);
    session.pendingParentNodes = batch.parentNodes;
    session.pendingParentMs = batch.parentMs;
    session.pendingParentCount = batch.pendingParents;
    selectionController.invalidate();
    if (!state.freeze) updateSelection();
    updateInfo();
  };
  clodWorker.onParentsComplete = (_requestId, parentNodes, parentMs) => {
    session.pendingParentNodes = parentNodes;
    session.pendingParentMs = parentMs;
    session.pendingParentCount = 0;
    staleEditedAncestorIds.clear();
    if (parentNodes > 0) {
      session.lastDigSummary = `${session.lastDigSummary} + ancestors ${parentNodes}n ${parentMs.toFixed(0)}ms`;
    }
    updateSelection();
    updateInfo();
  };

  const playerTerraformEditActive = () => session.terraformEditCheckbox?.checked ?? false;

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
    applyNodeMesh,
    markEditedAncestorsStale,
    selectionController,
    applyTerrainTextures,
    grassSystem,
    treeSystem,
    understorySystem,
    vegetationDirtyQueue,
    fallingTrees,
    refreshGrassStats: () => bindings.refreshGrassStats(),
    refreshTreeStats: () => bindings.refreshTreeStats(),
    refreshUnderstoryStats: () => bindings.refreshUnderstoryStats(),
    updateInfo,
    getLastDigSummary: () => session.lastDigSummary,
    setLastDigSummary: (summary) => { session.lastDigSummary = summary; },
    setPendingParentCount: (count) => { session.pendingParentCount = count; },
    setPendingParentNodes: (nodes) => { session.pendingParentNodes = nodes; },
    setPendingParentMs: (ms) => { session.pendingParentMs = ms; },
  });

  return {
    terrainEditService,
    flushAncestors: () => terrainEditService.flushAncestors(),
    scheduleDig: (ray) => terrainEditService.scheduleDig(ray),
    playerTerraformEditActive,
  };
}
