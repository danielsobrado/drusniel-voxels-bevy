import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { emitAudio } from "../audio/index.js";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  PlayerInteractionState,
} from "../player_controller.js";
import type { TerrainColliderSet } from "../terrain/terrain_collider.js";

export interface PlayerModeControllerDeps {
  renderer: { domElement: HTMLElement };
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainColliders: TerrainColliderSet;
  surfaceHeight: (x: number, z: number) => number;
  orbitModeButton: HTMLButtonElement;
  playerModeButton: HTMLButtonElement;
  playerModeStatus: HTMLElement;
  searchParams: URLSearchParams;
  getTerraformEditActive: () => boolean;
  getTabUiHold: () => boolean;
  onBeforeExitMode: () => void;
  resetPlayerInput: () => void;
  onStartPlayingFacing: (yaw: number, pitch: number) => void;
}

export interface PlayerModeController {
  updatePlayerModeUi(): void;
  exitPlayerMode(): void;
  choosePlayerSpawn(): void;
  bindTerraformEditCheckbox(checkbox: HTMLInputElement): void;
  bindEditToggleInput(input: HTMLInputElement): void;
  applyQuerySpawn(): void;
}

export function createPlayerModeController(deps: PlayerModeControllerDeps): PlayerModeController {
  const playerRaycaster = new THREE.Raycaster();
  const playerPointer = new THREE.Vector2();
  const playerForward = new THREE.Vector3();
  const orbitReturnTarget = new THREE.Vector3();

  let terraformEditCheckbox: HTMLInputElement | null = null;
  let editToggleInput: HTMLInputElement | null = null;

  const updatePlayerModeUi = () => {
    document.body.dataset.playerMode = deps.interaction.mode;
    deps.orbitModeButton.setAttribute("aria-pressed", String(deps.interaction.mode === "orbit"));
    deps.playerModeButton.setAttribute("aria-pressed", String(deps.interaction.mode !== "orbit"));
    if (deps.getTabUiHold() && deps.interaction.mode === "playing") {
      deps.playerModeStatus.textContent = "Tab held — click palette · release Tab to look";
    } else {
      deps.playerModeStatus.textContent = deps.interaction.mode === "choosingSpawn"
        ? "Click the terrain to choose your starting position"
        : deps.interaction.mode === "playing"
          ? `WASD · Shift · Space · Esc${deps.getTerraformEditActive() ? " · click digs" : ""} · Shift+wheel radius`
          : "Orbit camera";
    }
    document.body.dataset.tabUi = deps.getTabUiHold() ? "true" : "false";
    if (terraformEditCheckbox) {
      document.body.dataset.tfEdit = terraformEditCheckbox.checked ? "true" : "false";
    }
  };

  const exitPlayerMode = () => {
    emitAudio("camera.mode.orbit");
    deps.onBeforeExitMode();
    if (deps.interaction.mode === "playing") {
      orbitReturnTarget.copy(deps.player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, DEFAULT_PLAYER_CONFIG.eyeHeight * 0.65);
      deps.controls.target.copy(orbitReturnTarget);
      deps.camera.position.copy(orbitReturnTarget).add(new THREE.Vector3(8, 6, 8));
      deps.camera.lookAt(orbitReturnTarget);
    }
    deps.interaction.exitToOrbit();
    deps.resetPlayerInput();
    deps.controls.enabled = true;
    deps.controls.update();
    if (terraformEditCheckbox) {
      terraformEditCheckbox.checked = true;
      document.body.dataset.tfEdit = "true";
    }
    updatePlayerModeUi();
  };

  const choosePlayerSpawn = () => {
    deps.interaction.chooseSpawn();
    deps.resetPlayerInput();
    deps.controls.enabled = false;
    updatePlayerModeUi();
  };

  const startPlayerAtPointer = (event: PointerEvent) => {
    const rect = deps.renderer.domElement.getBoundingClientRect();
    playerPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    playerRaycaster.setFromCamera(playerPointer, deps.camera);
    const hit = deps.terrainColliders.raycastSpawn(playerRaycaster.ray);
    if (!hit) {
      deps.playerModeStatus.textContent = "No playable terrain there";
      return;
    }

    deps.camera.getWorldDirection(playerForward);
    playerForward.y = 0;
    if (playerForward.lengthSq() < 1e-8) playerForward.set(0, 0, -1);
    else playerForward.normalize();
    deps.onStartPlayingFacing(Math.atan2(-playerForward.x, -playerForward.z), 0);
    deps.player.spawn(hit.point);
    deps.interaction.startPlaying();
    emitAudio("camera.mode.player");
    deps.controls.enabled = false;
    if (editToggleInput) {
      editToggleInput.checked = true;
      document.body.dataset.tfEdit = "true";
    }
    updatePlayerModeUi();
    void deps.renderer.domElement.requestPointerLock();
  };

  deps.orbitModeButton.addEventListener("click", exitPlayerMode);
  deps.playerModeButton.addEventListener("click", choosePlayerSpawn);
  deps.renderer.domElement.addEventListener("pointerdown", (event) => {
    if (deps.interaction.mode === "choosingSpawn" && event.button === 0) startPlayerAtPointer(event);
  });
  document.addEventListener("pointerlockerror", () => {
    if (deps.interaction.mode === "playing") deps.playerModeStatus.textContent = "Click viewport to capture mouse";
  });

  const applyQuerySpawn = () => {
    const qx = deps.searchParams.get("x");
    const qz = deps.searchParams.get("z");
    const qyaw = deps.searchParams.get("yaw");
    if (qx === null || qz === null) return;
    const xVal = Number(qx);
    const zVal = Number(qz);
    const yawVal = qyaw !== null ? Number(qyaw) : 0;
    const terrainY = deps.surfaceHeight(xVal, zVal);

    deps.controls.target.set(xVal, terrainY, zVal);
    deps.camera.position.set(xVal, terrainY + 15, zVal + 20);
    deps.camera.lookAt(deps.controls.target);
    deps.controls.update();

    deps.player.spawn(new THREE.Vector3(xVal, terrainY, zVal));
    deps.onStartPlayingFacing(yawVal, 0);
    deps.interaction.startPlaying();
    deps.controls.enabled = false;

    deps.camera.position.copy(deps.player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, DEFAULT_PLAYER_CONFIG.eyeHeight);
    deps.camera.rotation.set(0, yawVal, 0, "YXZ");
  };

  return {
    updatePlayerModeUi,
    exitPlayerMode,
    choosePlayerSpawn,
    bindTerraformEditCheckbox(checkbox) {
      terraformEditCheckbox = checkbox;
    },
    bindEditToggleInput(input) {
      editToggleInput = input;
    },
    applyQuerySpawn,
  };
}
