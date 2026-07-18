import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import { createProjectArchiveController } from "../../project/project_archive_controller.js";
import { projectPropEditStore } from "../../project/prop_edit_store.js";
import { createSaveCheckpointController } from "../../save/save_checkpoint_controller.js";
import {
  flushSaveRuntimeOrThrow,
  hasActiveSaveRuntime,
  isSaveRuntimeConverged,
} from "../../save/save_runtime.js";
import { getTerrainFieldConfig } from "../../terrain/terrain.js";
import { updateClodOverlay } from "../../ui/overlay_panel.js";
import type { InfoPanelController } from "./info_panel_startup.js";
import type { TerrainEditStartupResult } from "./ui/terrain_edit_startup.js";
import type { UiStartupContext } from "./ui_startup_context.js";

const CHECKPOINT_MAX_REGION_WRITES = Number.MAX_SAFE_INTEGER;

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

  const checkpointController = createSaveCheckpointController({
    flush: async () => {
      if (!hasActiveSaveRuntime()) throw new Error("no active saved world to checkpoint");
      await flushAncestors();
      await flushSaveRuntimeOrThrow(CHECKPOINT_MAX_REGION_WRITES);
    },
    isConverged: isSaveRuntimeConverged,
    getCounters: () => input.longView.hooks?.stats?.counters ?? null,
    onStatus: (status) => {
      session.lastArchiveSummary = status;
      updateInfo();
    },
  });

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
    getWorldIdentity: () => ({
      scene: input.searchParams.get("scene") ?? "default",
      generatorVersion: TERRAIN_SOURCE_VERSION,
      terrainField: structuredClone(getTerrainFieldConfig()),
    }),
    getNodesByLevel: () => result.nodesByLevel,
    getProps: () => projectPropEditStore.snapshot(),
    textureController,
    camera,
    controls,
    flushAncestors,
    beforeImportNavigation: async () => {
      if (!hasActiveSaveRuntime() || isSaveRuntimeConverged()) return;
      await checkpointController.requestCheckpoint();
    },
    setBuildStatus: (status) => { buildStatusRef.value = status; },
    updateOverlay: () => updateClodOverlay(currentOverlaySnapshot()),
    setLastArchiveSummary: (summary) => { session.lastArchiveSummary = summary; },
    updateInfo,
  });
  projectArchiveController.bindImportExportButtons();

  const disposeCheckpointShortcut = checkpointController.bindShortcut();
  window.addEventListener("beforeunload", disposeCheckpointShortcut, { once: true });
}
