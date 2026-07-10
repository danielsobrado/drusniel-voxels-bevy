import * as THREE from "three";
import { getDigEditRevision, surfaceHeight } from "../../../terrain/terrain.js";
import { createPlayerModeController } from "../../../player/player_mode_controller.js";
import { createPlayerInputController } from "../../../player/player_input_controller.js";
import { createFirstPersonWeapon, createSwordAttackController } from "../../../combat/index.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

const MAX_PLAYER_FRAME_DELTA_SECONDS = 0.1;
const PLAYER_AUTOMATION_SURFACE_OFFSET_M = 0.02;

export function runPlayerStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
  terrainEdit: TerrainEditStartupResult,
): void {
  const { input, session } = ctx;
  const {
    renderer,
    scene,
    camera,
    controls,
    player,
    interaction,
    terrainColliders,
    terrainRaycast,
    searchParams,
    bindings,
    state,
    dom: { orbitModeButton, playerModeButton, playerModeStatus },
  } = input;
  const { brushPreview } = input.terrainView;
  const { updateInfo } = infoPanel;
  const { scheduleDig, playerTerraformEditActive, terrainEditService } = terrainEdit;

  if (!session.digRadiusController) {
    throw new Error("Player startup requires digRadiusController from texture UI startup");
  }

  const weapon = createFirstPersonWeapon({ scene, camera });
  const combatController = createSwordAttackController({
    camera,
    weapon,
    isEnabled: () => interaction.mode === "playing",
  });
  const config = combatController.getConfig();

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
    cycleBrushShape: () => {
      const shapes = ["sphere", "cube", "cylinder"] as const;
      const current = shapes.indexOf(state.brushShape);
      state.brushShape = shapes[(current + 1) % shapes.length];
      bindings.syncTerraformMenu();
      updateInfo();
    },
    triggerSwordAttack: () => combatController.trigger(),
  });

  const updateOrbitControls = controls.update.bind(controls);
  controls.update = () => (interaction.mode === "orbit" ? updateOrbitControls() : false);

  let lastPlayerFrameAt = performance.now();
  const updatePlayerInteraction = (now: number): void => {
    const deltaSeconds = Math.min(Math.max((now - lastPlayerFrameAt) / 1000, 0), MAX_PLAYER_FRAME_DELTA_SECONDS);
    lastPlayerFrameAt = now;
    if (interaction.mode === "playing") {
      playerInputController.updateFrame(deltaSeconds);
      playerInputController.updateHoldToDig();
    }
    brushPreview.update({
      digEnabled: state.digEnabled,
      interactionMode: interaction.mode,
      terraformEditActive: playerTerraformEditActive(),
      brushShape: state.brushShape,
      brushOp: state.brushOp,
      digRadius: state.digRadius,
      brushHeight: state.brushHeight,
      terrainRevision: getDigEditRevision(),
      raycastEditableTerrain: (ray) => terrainRaycast.raycastEditableTerrain(ray),
      getPlayingAimRay: () => playerInputController.getPlayingAimRay(),
      getOrbitHoverRay: () => playerInputController.getOrbitHoverRay(),
    });
    requestAnimationFrame(updatePlayerInteraction);
  };
  requestAnimationFrame(updatePlayerInteraction);

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
    // Infinite-island worlds stream terrain around the player; gate the query spawn on streamed-root
    // safety coverage + colliders so the player never drops through un-meshed ground at startup.
    spawnGateEnabled: window.__drusnielWorldMode?.mode === "infinite_islands",
  });

  const automationHooks = input.longView.hooks;
  if (automationHooks) {
    const baseSetPose = automationHooks.setPose;
    const baseGetPose = automationHooks.getPose;
    automationHooks.setPose = (pose) => {
      if (interaction.mode !== "playing") {
        baseSetPose?.(pose);
        return;
      }
      const terrainY = surfaceHeight(pose.p[0], pose.p[2]);
      const playerY = Number.isFinite(terrainY)
        ? terrainY + PLAYER_AUTOMATION_SURFACE_OFFSET_M
        : pose.p[1] - player.config.eyeHeight;
      player.position.set(pose.p[0], playerY, pose.p[2]);
      player.lastSafePosition.copy(player.position);
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      playerInputController.resetPlayerInput();
      playerInputController.setPlayerYawPitch(pose.yaw, pose.pitch);
      camera.position.copy(player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, player.config.eyeHeight);
      camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
      if (Number.isFinite(pose.fov)) {
        camera.fov = pose.fov!;
        camera.updateProjectionMatrix();
      }
    };
    automationHooks.getPose = () => {
      if (interaction.mode === "playing") {
        return {
          p: [camera.position.x, camera.position.y, camera.position.z],
          yaw: playerInputController.playerYaw,
          pitch: playerInputController.playerPitch,
          fov: camera.fov,
        };
      }
      return baseGetPose?.() ?? {
        p: [camera.position.x, camera.position.y, camera.position.z],
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
        fov: camera.fov,
      };
    };
  }

  bindings.resetPlayerInput = () => playerInputController.resetPlayerInput();
  bindings.updatePlayerModeUi = () => playerModeController.updatePlayerModeUi();
  playerModeController.applyQuerySpawn();
  playerModeController.updatePlayerModeUi();

  const offset = new THREE.Vector3(...config.camera_offset);
  weapon.load(config.model_path, offset).catch((error: unknown) => {
    console.warn("[combat] failed to load first-person weapon model", error);
  });

  session.playerInputController = playerInputController;
  session.playerModeController = playerModeController;
  session.combatController = combatController;
}
