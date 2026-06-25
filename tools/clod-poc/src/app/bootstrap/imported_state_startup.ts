import * as THREE from "three";
import { LOD_COLORS } from "../clod_constants.js";
import { recomputedNormalsFor } from "./bootstrap_types.js";
import type { InfoPanelController } from "./info_panel_startup.js";
import type { UiStartupContext } from "./ui_startup_context.js";

export function applyImportedStateSideEffects(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
): void {
  const { input } = ctx;
  const { state, bindings } = input;
  const {
    views,
    materialController,
    applyColorAdjustmentsToTerrain,
    applyTerrainTextures,
    updateSelection,
  } = input.terrainView;
  const {
    grassSystem,
    makeGrassSettings,
    treeSystem,
    treeController,
    understorySystem,
    understoryController,
    forestLightingController,
    updateLighting,
  } = input.runtime;
  const { updateInfo } = infoPanel;

  materialController.forEachMaterial((material) => {
    material.setWireframe(state.wireframe);
    material.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    material.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
  });
  for (const view of views.values()) {
    view.mat.setBaseColor(state.colorByLod ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8);
    if (state.recomputedNormals) {
      view.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(view), 3));
    }
  }
  applyColorAdjustmentsToTerrain();
  updateLighting();
  applyTerrainTextures();
  grassSystem?.setEnabled(state.grassEnabled);
  grassSystem?.updateSettings(makeGrassSettings());
  bindings.refreshGrassStats();
  treeSystem.setEnabled(state.treesEnabled);
  treeController.applySettings();
  bindings.refreshTreeStats();
  understorySystem.setEnabled(state.understoryEnabled);
  understoryController.applySettings();
  bindings.refreshUnderstoryStats();
  forestLightingController.bumpSettingsVersion();
  forestLightingController.applySettings();
  updateSelection();
  updateInfo();
}
