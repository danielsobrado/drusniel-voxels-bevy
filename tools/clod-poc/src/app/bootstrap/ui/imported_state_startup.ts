import * as THREE from "three";
import { LOD_COLORS } from "../../clod_constants.js";
import { isExternalGpuClodGeometry } from "../../../rendering/webgpu_external_buffer_geometry.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

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
    setViewNormalMode,
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

  const viewList = [...views.values()];
  const residentGeometryPresent = viewList.some((view) =>
    isExternalGpuClodGeometry(view.mesh.geometry as THREE.BufferGeometry),
  );
  const safeWireframe = state.wireframe && !residentGeometryPresent;
  materialController.forEachMaterial((material) => {
    material.setWireframe(safeWireframe);
    material.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    material.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
  });
  for (const view of viewList) {
    const resident = isExternalGpuClodGeometry(view.mesh.geometry as THREE.BufferGeometry);
    view.mat.setBaseColor(state.colorByLod ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8);
    if (state.recomputedNormals && !resident) {
      setViewNormalMode(view, "recomputed");
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
