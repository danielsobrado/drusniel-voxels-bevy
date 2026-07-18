import * as THREE from "three";
import { getDigEditRevision, surfaceHeight } from "../../../terrain/terrain.js";
import { createPlayerModeController } from "../../../player/player_mode_controller.js";
import { createPlayerInputController } from "../../../player/player_input_controller.js";
import { runReadinessGatedTeleport } from "../../../player/teleport_recovery.js";
import { gameplayDiagnostics } from "../../../player/gameplay_diagnostics.js";
import {
  createAppCellReadinessFeeds,
  movementReadinessAt,
  teleportTargetReady,
} from "../../../player/cell_readiness.js";
import { installStreamCursorPrimeTarget } from "../../../stream/stream_cursor.js";
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

  const waterAuthority = input.runtime.waterController?.authority ?? null;
  player.attachWaterAuthority(waterAuthority);
  const playerReadinessFeeds = createAppCellReadinessFeeds({
    terrainColliders,
    waterQueryReadyAt: waterAuthority ? (x, z) => waterAuthority.readyAt(x, z) : undefined,
  });
  player.attachMovementReadiness((x, z) => movementReadinessAt(playerReadinessFeeds, x, z));

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
  let activeGameplayTeleportProbes = 0;
  const updatePlayerInteraction = (now: number): void => {
    const deltaSeconds = Math.min(Math.max((now - lastPlayerFrameAt) / 1000, 0), MAX_PLAYER_FRAME_DELTA_SECONDS);
    lastPlayerFrameAt = now;
    if (interaction.mode === "playing" && activeGameplayTeleportProbes === 0) {
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
    // Infinite worlds and cave tests gate spawn against the same collision + water
    // authority envelope used by runtime movement.
    spawnGateEnabled: window.__drusnielWorldMode?.mode === "infinite_islands"
      || searchParams.get("scene") === "cave-test",
    movementReadyAt: (x, z) => teleportTargetReady(playerReadinessFeeds, x, z),
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
    automationHooks.teleportGameplayTarget = async (target) => {
      const applyPose = ({ x, z }: { x: number; z: number }): void => {
        const current = automationHooks.getPose?.();
        if (!current || !automationHooks.setPose) {
          throw new Error("gameplay teleport requires pose automation hooks");
        }
        automationHooks.setPose({
          ...current,
          p: [x, current.p[1], z],
          yaw: target.yaw ?? current.yaw,
        });
      };
      let releasePrime: (() => void) | null = null;
      const clearPrime = (): void => {
        releasePrime?.();
        releasePrime = null;
      };
      activeGameplayTeleportProbes += 1;
      playerInputController.resetPlayerInput();
      try {
        return await runReadinessGatedTeleport({
          target,
          timeoutMs: Math.max(1_000, target.timeoutMs ?? 180_000),
          primeStream: ({ x, z }) => {
            clearPrime();
            releasePrime = installStreamCursorPrimeTarget({ x, z });
          },
          commit: (readyTarget) => {
            clearPrime();
            applyPose(readyTarget);
          },
          readyAt: (x, z) => teleportTargetReady(playerReadinessFeeds, x, z),
          waitFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          now: () => performance.now(),
          recordReadyMs: (milliseconds) => gameplayDiagnostics.set("time_to_gameplay_ready_ms", milliseconds),
        });
      } finally {
        clearPrime();
        activeGameplayTeleportProbes = Math.max(0, activeGameplayTeleportProbes - 1);
      }
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
