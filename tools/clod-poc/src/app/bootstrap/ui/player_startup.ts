import * as THREE from "three";
import { surfaceHeight } from "../../../terrain.js";
import { createPlayerModeController } from "../../../player/player_mode_controller.js";
import { createPlayerInputController } from "../../../player/player_input_controller.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export function runPlayerStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
  terrainEdit: TerrainEditStartupResult,
): void {
  const { input, session } = ctx;
  const {
    renderer,
    camera,
    controls,
    player,
    interaction,
    terrainColliders,
    searchParams,
    bindings,
    state,
    dom: { orbitModeButton, playerModeButton, playerModeStatus },
  } = input;
  const { updateInfo } = infoPanel;
  const { scheduleDig, playerTerraformEditActive, terrainEditService } = terrainEdit;

  if (!session.digRadiusController) {
    throw new Error("Player startup requires digRadiusController from texture UI startup");
  }

  const playerInputController = createPlayerInputController({
    renderer,
    camera,
    controls,
    player,
    interaction,
    getDigEnabled: () => state.digEnabled,
    getTerraformEditActive: playerTerraformEditActive,
    getBrushFlowMs: () => state.brushFlowMs,
    scheduleDig,
    getLastDigAt: () => terrainEditService.lastDigAt,
    onTabUiHoldChange: () => { session.playerModeController!.updatePlayerModeUi(); },
    onPlayerModeUiChange: () => { session.playerModeController!.updatePlayerModeUi(); },
    exitPlayerMode: () => session.playerModeController!.exitPlayerMode(),
    adjustDigRadius: (delta) => {
      state.digRadius = THREE.MathUtils.clamp(state.digRadius - Math.sign(delta) * 0.5, 1, 8);
      session.digRadiusController!.updateDisplay();
      bindings.syncTerraformMenu();
      updateInfo();
    },
  });

  const playerModeController = createPlayerModeController({
    renderer,
    camera,
    controls,
    player,
    interaction,
    terrainColliders,
    surfaceHeight,
    orbitModeButton,
    playerModeButton,
    playerModeStatus,
    searchParams,
    getTerraformEditActive: playerTerraformEditActive,
    getTabUiHold: () => playerInputController.tabUiHold,
    onBeforeExitMode: () => playerInputController.onBeforeExitMode(),
    resetPlayerInput: () => playerInputController.resetPlayerInput(),
    onStartPlayingFacing: (yaw, pitch) => playerInputController.setPlayerYawPitch(yaw, pitch),
  });

  bindings.resetPlayerInput = () => playerInputController.resetPlayerInput();
  bindings.updatePlayerModeUi = () => playerModeController.updatePlayerModeUi();
  playerModeController.applyQuerySpawn();
  playerModeController.updatePlayerModeUi();

  session.playerInputController = playerInputController;
  session.playerModeController = playerModeController;
}
