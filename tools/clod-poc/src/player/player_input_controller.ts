import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { emitAudio } from "../audio/index.js";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  PlayerInteractionState,
  type PlayerInputState,
} from "../player_controller.js";

export interface PlayerInputControllerDeps {
  renderer: { domElement: HTMLElement };
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  getDigEnabled: () => boolean;
  getTerraformEditActive: () => boolean;
  getBrushFlowMs: () => number;
  scheduleDig: (ray: THREE.Ray) => void;
  getLastDigAt: () => number;
  onTabUiHoldChange: () => void;
  onPlayerModeUiChange: () => void;
  exitPlayerMode: () => void;
  adjustDigRadius: (delta: number) => void;
  cycleBrushShape: () => void;
  triggerSwordAttack?: () => boolean;
}

export interface PlayerInputController {
  readonly playerInput: PlayerInputState;
  readonly playerTimer: THREE.Timer;
  get playerYaw(): number;
  get playerPitch(): number;
  get digHeld(): boolean;
  get tabUiHold(): boolean;
  resetPlayerInput(): void;
  updateFrame(deltaSeconds: number): void;
  updateHoldToDig(): void;
  getPlayingAimRay(): THREE.Ray;
  getOrbitHoverRay(): THREE.Ray | null;
  clearDigHold(): void;
  setPlayerYawPitch(yaw: number, pitch: number): void;
  onBeforeExitMode(): void;
}

export function createPlayerInputController(deps: PlayerInputControllerDeps): PlayerInputController {
  const playerInput: PlayerInputState = { forward: 0, right: 0, sprint: false, jump: false };
  const playerRaycaster = new THREE.Raycaster();
  const playerPointer = new THREE.Vector2();
  const playerForward = new THREE.Vector3();
  const digDirection = new THREE.Vector3();
  const digAimRay = new THREE.Ray();
  const hoverPointer = new THREE.Vector2();
  const playerTimer = new THREE.Timer();
  playerTimer.connect(document);

  let playerYaw = 0;
  let playerPitch = 0;
  let playerPointerLocked = false;
  let tabUiHold = false;
  let digHeld = false;
  let digPointerDown: { x: number; y: number } | null = null;
  let hoverPointerValid = false;

  const resetPlayerInput = () => {
    playerInput.forward = 0;
    playerInput.right = 0;
    playerInput.sprint = false;
    playerInput.jump = false;
    digHeld = false;
  };

  const onBeforeExitMode = () => {
    tabUiHold = false;
    if (document.pointerLockElement === deps.renderer.domElement) document.exitPointerLock();
    playerPointerLocked = false;
  };

  deps.renderer.domElement.addEventListener("pointerdown", (event) => {
    if (deps.interaction.mode === "playing" && event.button === 0 && deps.getDigEnabled() && deps.getTerraformEditActive()) {
      digHeld = true;
      deps.camera.getWorldDirection(digDirection);
      deps.scheduleDig(new THREE.Ray(deps.camera.position.clone(), digDirection.clone()));
      if (document.pointerLockElement !== deps.renderer.domElement) {
        void deps.renderer.domElement.requestPointerLock();
      }
    } else if (deps.interaction.mode === "playing" && event.button === 0 && document.pointerLockElement !== deps.renderer.domElement) {
      void deps.renderer.domElement.requestPointerLock();
    } else if (deps.interaction.mode === "playing" && event.button === 0 && document.pointerLockElement === deps.renderer.domElement) {
      deps.triggerSwordAttack?.();
    } else if (deps.interaction.mode === "orbit" && event.button === 0 && deps.getDigEnabled()) {
      digPointerDown = { x: event.clientX, y: event.clientY };
    }
  });
  deps.renderer.domElement.addEventListener("pointerup", (event) => {
    if (event.button === 0) digHeld = false;
    if (!digPointerDown || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - digPointerDown.x, event.clientY - digPointerDown.y);
    digPointerDown = null;
    if (moved > 4 || deps.interaction.mode !== "orbit" || !deps.getDigEnabled()) return;
    const rect = deps.renderer.domElement.getBoundingClientRect();
    playerPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    playerRaycaster.setFromCamera(playerPointer, deps.camera);
    deps.scheduleDig(playerRaycaster.ray);
  });
  deps.renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = deps.renderer.domElement.getBoundingClientRect();
    hoverPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverPointerValid = true;
  });
  deps.renderer.domElement.addEventListener("pointerleave", () => {
    hoverPointerValid = false;
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === deps.renderer.domElement) {
      playerPointerLocked = true;
      tabUiHold = false;
      deps.onTabUiHoldChange();
      deps.onPlayerModeUiChange();
    } else if (deps.interaction.mode === "playing" && playerPointerLocked) {
      playerPointerLocked = false;
      if (tabUiHold) {
        deps.onPlayerModeUiChange();
        return;
      }
      deps.exitPlayerMode();
    }
  });
  document.addEventListener("mousemove", (event) => {
    if (deps.interaction.mode !== "playing" || document.pointerLockElement !== deps.renderer.domElement) return;
    playerYaw -= event.movementX * 0.002;
    playerPitch = THREE.MathUtils.clamp(playerPitch - event.movementY * 0.002, -1.5, 1.5);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && deps.interaction.mode === "choosingSpawn") {
      deps.exitPlayerMode();
      return;
    }
    if (event.code === "Escape" && deps.interaction.mode === "playing" && !playerPointerLocked) {
      deps.exitPlayerMode();
      return;
    }
    if (event.code === "Tab" && deps.interaction.mode === "playing") {
      event.preventDefault();
      if (document.pointerLockElement === deps.renderer.domElement) {
        tabUiHold = true;
        deps.onTabUiHoldChange();
        document.exitPointerLock();
      }
      return;
    }
    if (deps.interaction.mode !== "playing") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === "KeyW") playerInput.forward = 1;
    if (event.code === "KeyS") playerInput.forward = -1;
    if (event.code === "KeyA") playerInput.right = -1;
    if (event.code === "KeyD") playerInput.right = 1;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") playerInput.sprint = true;
    if (event.code === "Space") playerInput.jump = true;
    if (event.code === "KeyG") {
      deps.cycleBrushShape();
      return;
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Tab" && deps.interaction.mode === "playing" && tabUiHold) {
      tabUiHold = false;
      deps.onTabUiHoldChange();
      deps.onPlayerModeUiChange();
      if (document.pointerLockElement !== deps.renderer.domElement) {
        void deps.renderer.domElement.requestPointerLock();
      }
      return;
    }
    if (event.code === "KeyW" && playerInput.forward > 0) playerInput.forward = 0;
    if (event.code === "KeyS" && playerInput.forward < 0) playerInput.forward = 0;
    if (event.code === "KeyA" && playerInput.right < 0) playerInput.right = 0;
    if (event.code === "KeyD" && playerInput.right > 0) playerInput.right = 0;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") playerInput.sprint = false;
    if (event.code === "Space") playerInput.jump = false;
  });
  window.addEventListener("blur", () => {
    resetPlayerInput();
    if (tabUiHold) {
      tabUiHold = false;
      deps.onTabUiHoldChange();
      deps.onPlayerModeUiChange();
    }
  });
  window.addEventListener("wheel", (event) => {
    if (deps.interaction.mode !== "playing" || !event.shiftKey) return;
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (delta === 0) return;
    deps.adjustDigRadius(delta);
    emitAudio("terrain.brush.radius");
  });

  return {
    playerInput,
    playerTimer,
    get playerYaw() { return playerYaw; },
    get playerPitch() { return playerPitch; },
    get digHeld() { return digHeld; },
    get tabUiHold() { return tabUiHold; },
    resetPlayerInput,
    onBeforeExitMode,
    updateFrame(deltaSeconds) {
      if (deps.interaction.mode === "playing") {
        playerForward.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
        deps.player.update(deltaSeconds, playerInput, playerForward);
        deps.camera.position.copy(deps.player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, DEFAULT_PLAYER_CONFIG.eyeHeight);
        deps.camera.rotation.set(playerPitch, playerYaw, 0, "YXZ");
      } else {
        deps.controls.update();
      }
    },
    updateHoldToDig() {
      if (
        deps.interaction.mode === "playing" && digHeld && deps.getDigEnabled() && deps.getTerraformEditActive() &&
        document.pointerLockElement === deps.renderer.domElement &&
        performance.now() - deps.getLastDigAt() >= deps.getBrushFlowMs()
      ) {
        deps.camera.getWorldDirection(digDirection);
        deps.scheduleDig(new THREE.Ray(deps.camera.position.clone(), digDirection.clone()));
      }
    },
    getPlayingAimRay() {
      deps.camera.getWorldDirection(digDirection);
      digAimRay.origin.copy(deps.camera.position);
      digAimRay.direction.copy(digDirection);
      return digAimRay;
    },
    getOrbitHoverRay() {
      if (!hoverPointerValid) return null;
      playerRaycaster.setFromCamera(hoverPointer, deps.camera);
      return playerRaycaster.ray;
    },
    clearDigHold() {
      digHeld = false;
    },
    setPlayerYawPitch(yaw, pitch) {
      playerYaw = yaw;
      playerPitch = pitch;
    },
  };
}
