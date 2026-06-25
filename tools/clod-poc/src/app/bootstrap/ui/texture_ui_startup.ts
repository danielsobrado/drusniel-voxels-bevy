import { createClodPocTerrainMaterialGui } from "../../../ui/gui/gui_root.js";
import { createTerraformMenu } from "../../../ui/terraform_menu.js";
import { createTerrainTextureModal } from "../../../terrain/material/terrain_texture_modal.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { GuiStartupResult } from "./gui_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";
import { runPlayerStartup } from "./player_startup.js";

export interface TextureUiStartupResult {
  textureModal: ReturnType<typeof createTerrainTextureModal>;
}

export async function runTextureUiStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
  gui: GuiStartupResult,
  terrainEdit: import("./terrain_edit_startup.js").TerrainEditStartupResult,
): Promise<TextureUiStartupResult> {
  const { input, session } = ctx;
  const {
    stagedImport,
    state,
    bindings,
    textureLoadOptions,
    dom: { buildProgress, buildProgressBar, buildProgressPhase, buildProgressPercent },
  } = input;
  const {
    textureController,
    applyTerrainTextures,
    materialController,
    nearFieldBubbleController,
    updateSelection,
  } = input.terrainView;
  const { brushPreview } = input.terrainView;
  const { updateInfo } = infoPanel;

  const textureProgress = {
    setPhase: (label: string, fraction: number) => {
      buildProgress.hidden = false;
      buildProgressPhase.textContent = label;
      buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
      buildProgressBar.value = fraction;
    },
  };

  const textureModal = createTerrainTextureModal({
    textureController,
    textureLoadOptions,
    applyTerrainTextures,
    setLoadedTextureFiles: (value) => {
      state.loadedTextureFiles = value;
    },
    onBrushMaterialClamped: (maxIndex) => {
      if (state.brushMaterial > maxIndex) state.brushMaterial = 0;
    },
  });

  const { digRadiusController } = createClodPocTerrainMaterialGui(gui.gui, state, {
    terrainMaterial: {
      textureModal,
      applyTerrainTextures,
      updateSelection,
      updateInfo,
      applyBubbleTint: (enabled) => nearFieldBubbleController.applyTint(enabled),
    },
  });
  session.digRadiusController = digRadiusController;

  runPlayerStartup(ctx, infoPanel, terrainEdit);

  const terraformMenuUi = createTerraformMenu({
    root: document.getElementById("terraform-menu")!,
    state,
    materialController,
    digRadiusController,
    updateInfo,
    bindTerraformEditCheckbox: (el) => session.playerModeController!.bindTerraformEditCheckbox(el),
    bindEditToggleInput: (el) => session.playerModeController!.bindEditToggleInput(el),
    onEditToggleChanged: (enabled) => {
      if (!enabled) {
        session.playerInputController!.clearDigHold();
        brushPreview.hide();
      }
      session.playerModeController!.updatePlayerModeUi();
    },
  });
  session.terraformEditCheckbox = terraformMenuUi.editCheckbox;
  bindings.refreshTerraformSwatches = terraformMenuUi.refreshSwatches;
  bindings.syncTerraformMenu = terraformMenuUi.syncMenu;

  if (stagedImport) {
    textureModal.rebuildTextureSlotCards();
    await textureController.restoreStagedImport(textureProgress);
  } else if (!state.clodPerfMode && state.terrainMaterialSource === "external_pbr") {
    await textureController.loadDefaultBuiltinTextures(textureProgress);
  } else {
    state.loadedTextureFiles = state.clodPerfMode ? "perf mode" : state.terrainMaterialSource;
  }
  textureModal.syncTextureModalControls();
  textureModal.updateTextureSlotPreviews();
  textureModal.refreshTextureState();
  buildProgress.hidden = true;

  return { textureModal };
}
