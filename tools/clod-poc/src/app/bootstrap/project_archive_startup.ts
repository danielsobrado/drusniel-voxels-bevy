import { createProjectArchiveController } from "../../project/project_archive_controller.js";
import { projectPropEditStore } from "../../project/prop_edit_store.js";
import { updateClodOverlay } from "../../ui/overlay_panel.js";
import type { InfoPanelController } from "./info_panel_startup.js";
import type { TerrainEditStartupResult } from "./ui/terrain_edit_startup.js";
import type { UiStartupContext } from "./ui_startup_context.js";

export function runProjectArchiveStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
  terrainEdit: TerrainEditStartupResult,
): void {
  const { input, session } = ctx;
  const {
    dom: {
      importButton,
      exportButton,
      projectImportInput,
      buildProgress,
      buildProgressBar,
      buildProgressPhase,
      buildProgressPercent,
    },
    WORLD,
    cfg,
    state,
    buildStatusRef,
    result,
    camera,
    controls,
  } = input;
  const { textureController } = input.terrainView;
  const { updateInfo, currentOverlaySnapshot } = infoPanel;
  const { flushAncestors } = terrainEdit;

  const projectArchiveController = createProjectArchiveController({
    importButton,
    exportButton,
    projectImportInput,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    getState: () => state,
    getWorldSize: () => WORLD,
    getConfig: () => cfg,
    getNodesByLevel: () => result.nodesByLevel,
    getProps: () => projectPropEditStore.snapshot(),
    textureController,
    camera,
    controls,
    flushAncestors,
    setBuildStatus: (status) => { buildStatusRef.value = status; },
    updateOverlay: () => updateClodOverlay(currentOverlaySnapshot()),
    setLastArchiveSummary: (summary) => { session.lastArchiveSummary = summary; },
    updateInfo,
  });
  projectArchiveController.bindImportExportButtons();
}
