import * as THREE from "three";
import { tryRequestPlayerPointerLock } from "./request_player_pointer_lock.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { emitAudio } from "../audio/index.js";
import { createSpawnWaitIndicator } from "./spawn_wait_indicator.js";
import { gameplayDiagnostics } from "./gameplay_diagnostics.js";
import {
  PlayerController,
  PlayerInteractionState,
} from "../player_controller.js";
import type { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { WATER_LEVEL } from "../terrain/terrain.js";

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
  /** Defer the query spawn until streamed-root safety pages + colliders are ready (streaming worlds). */
  spawnGateEnabled?: boolean;
  /** Cell readiness at the spawn/teleport target: a collision-ready movement envelope exists. */
  movementReadyAt?: (x: number, z: number) => boolean;
}

export interface PlayerModeController {
  updatePlayerModeUi(): void;
  exitPlayerMode(): void;
  choosePlayerSpawn(): void;
  bindTerraformEditCheckbox(checkbox: HTMLInputElement): void;
  bindEditToggleInput(input: HTMLInputElement): void;
  applyQuerySpawn(): void;
}

export interface QuerySpawnPoint {
  x: number;
  y: number;
  z: number;
  adjusted: boolean;
}

const ORBIT_RETURN_OFFSET = new THREE.Vector3(8, 7, 8);
const QUERY_SPAWN_DRY_CLEARANCE_M = 2;
const QUERY_SPAWN_FALLBACK_LIFT_M = 16;
const QUERY_SPAWN_RAYCAST_HEIGHT_M = 512;
const QUERY_SPAWN_SEARCH_RADII_M = [0, 16, 32, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536] as const;
const QUERY_SPAWN_SEARCH_DIRECTIONS = 24;
const SPAWN_GATE_STALL_WARNING_FRAMES = 300;

function querySpawnDryEnough(height: number): boolean {
  return Number.isFinite(height) && height >= WATER_LEVEL + QUERY_SPAWN_DRY_CLEARANCE_M;
}

export function resolveQuerySpawnPoint(
  x: number,
  z: number,
  surfaceHeight: (x: number, z: number) => number,
): QuerySpawnPoint {
  const centerY = surfaceHeight(x, z);
  let best: QuerySpawnPoint = {
    x,
    y: Number.isFinite(centerY) ? centerY : Number.NEGATIVE_INFINITY,
    z,
    adjusted: false,
  };
  if (querySpawnDryEnough(best.y)) return best;

  for (const radius of QUERY_SPAWN_SEARCH_RADII_M) {
    if (radius <= 0) continue;
    for (let i = 0; i < QUERY_SPAWN_SEARCH_DIRECTIONS; i++) {
      const angle = (i / QUERY_SPAWN_SEARCH_DIRECTIONS) * Math.PI * 2;
      const candidateX = x + Math.cos(angle) * radius;
      const candidateZ = z + Math.sin(angle) * radius;
      const candidateY = surfaceHeight(candidateX, candidateZ);
      if (!Number.isFinite(candidateY)) continue;
      if (candidateY > best.y) best = { x: candidateX, y: candidateY, z: candidateZ, adjusted: true };
      if (querySpawnDryEnough(candidateY)) {
        return { x: candidateX, y: candidateY, z: candidateZ, adjusted: true };
      }
    }
  }

  if (Number.isFinite(best.y)) return best;
  return { x, y: WATER_LEVEL + QUERY_SPAWN_DRY_CLEARANCE_M, z, adjusted: false };
}

export interface QuerySpawnGateState {
  /** Only streaming/infinite worlds gate; finite worlds spawn immediately. */
  enabled: boolean;
  safetyReady: number;
  safetyRequired: number;
  collidersLoaded: number;
  /** Retained for diagnostics; elapsed time must never bypass readiness. */
  framesWaited: number;
  /** Retained for diagnostics; elapsed time must never bypass readiness. */
  maxFrames: number;
  /** Readiness of the target cell itself (collision envelope); absent = not evaluated. */
  targetCellReady?: boolean;
}

/**
 * Decide whether the query spawn may be applied this frame. Streaming worlds fail closed:
 * elapsed frames are observability only and never authorize a spawn onto missing terrain.
 */
export function shouldApplyQuerySpawnNow(gate: QuerySpawnGateState): boolean {
  if (!gate.enabled) return true;
  const safetyReady = gate.safetyRequired > 0 && gate.safetyReady >= gate.safetyRequired;
  return safetyReady && gate.collidersLoaded > 0 && gate.targetCellReady === true;
}

function resolveColliderSpawnPoint(
  terrainColliders: TerrainColliderSet,
  spawn: QuerySpawnPoint,
): THREE.Vector3 {
  const originY = Math.max(spawn.y + QUERY_SPAWN_RAYCAST_HEIGHT_M, WATER_LEVEL + QUERY_SPAWN_RAYCAST_HEIGHT_M);
  const origin = new THREE.Vector3(spawn.x, originY, spawn.z);
  const ray = new THREE.Ray(origin, new THREE.Vector3(0, -1, 0));
  const hit = terrainColliders.raycastSpawn(ray);
  if (hit) return hit.point.clone();
  return new THREE.Vector3(spawn.x, spawn.y + QUERY_SPAWN_FALLBACK_LIFT_M, spawn.z);
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

  const setOrbitCameraAroundPlayer = () => {
    const playerX = deps.player.position.x;
    const playerZ = deps.player.position.z;
    orbitReturnTarget.set(playerX, deps.surfaceHeight(playerX, playerZ), playerZ);
    deps.controls.target.copy(orbitReturnTarget);
    deps.camera.position.copy(orbitReturnTarget).add(ORBIT_RETURN_OFFSET);
    deps.camera.lookAt(orbitReturnTarget);
  };

  const exitPlayerMode = () => {
    emitAudio("camera.mode.orbit");
    deps.onBeforeExitMode();
    if (deps.interaction.mode === "playing") {
      setOrbitCameraAroundPlayer();
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
    void tryRequestPlayerPointerLock(deps.renderer.domElement);
  };

  deps.orbitModeButton.addEventListener("click", exitPlayerMode);
  deps.playerModeButton.addEventListener("click", choosePlayerSpawn);
  deps.renderer.domElement.addEventListener("pointerdown", (event) => {
    if (deps.interaction.mode === "choosingSpawn" && event.button === 0) startPlayerAtPointer(event);
  });
  document.addEventListener("pointerlockerror", () => {
    if (deps.interaction.mode === "playing") deps.playerModeStatus.textContent = "Click viewport to capture mouse";
  });

  const performQuerySpawn = (
    requestedX: number,
    requestedZ: number,
    spawn: QuerySpawnPoint,
    yawVal: number,
  ) => {
    const spawnPoint = resolveColliderSpawnPoint(deps.terrainColliders, spawn);
    if (spawn.adjusted) {
      console.info(
        `[player] query spawn adjusted to dry land: requested=(${requestedX.toFixed(1)}, ${requestedZ.toFixed(1)}) ` +
          `resolved=(${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) y=${spawn.y.toFixed(1)}`,
      );
    }

    deps.controls.target.copy(spawnPoint);
    deps.camera.position.set(spawnPoint.x, spawnPoint.y + 15, spawnPoint.z + 20);
    deps.camera.lookAt(deps.controls.target);
    deps.controls.update();

    deps.player.spawn(spawnPoint);
    deps.onStartPlayingFacing(yawVal, 0);
    deps.interaction.startPlaying();
    deps.controls.enabled = false;
    updatePlayerModeUi();

    deps.camera.position.copy(deps.player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, deps.player.config.eyeHeight);
    deps.camera.rotation.set(0, yawVal, 0, "YXZ");
  };

  const applyQuerySpawn = () => {
    const qx = deps.searchParams.get("x");
    const qz = deps.searchParams.get("z");
    const qyaw = deps.searchParams.get("yaw");
    if (qx === null || qz === null) return;
    const xVal = Number(qx);
    const zVal = Number(qz);
    const yawVal = qyaw !== null ? Number(qyaw) : 0;
    if (!Number.isFinite(xVal) || !Number.isFinite(zVal)) return;

    const spawn = resolveQuerySpawnPoint(xVal, zVal, deps.surfaceHeight);
    const gateStartedAt = performance.now();
    if (deps.spawnGateEnabled !== true) {
      performQuerySpawn(xVal, zVal, spawn, yawVal);
      gameplayDiagnostics.set("time_to_gameplay_ready_ms", performance.now() - gateStartedAt);
      return;
    }

    // Streaming worlds remain in the pre-play view until safety coverage, colliders, and
    // the resolved dry-land target envelope are ready. A stalled stream is surfaced but
    // never bypassed by elapsed time.
    let framesWaited = 0;
    const waitIndicator = createSpawnWaitIndicator();
    const poll = () => {
      if (deps.interaction.mode === "playing") {
        waitIndicator.done();
        return;
      }
      const counters = (typeof window !== "undefined" ? window.__drusnielClod?.stats?.counters : undefined) ?? {};
      const safetyReady = counters["live_clod_stream_safety_ready_pages"] ?? 0;
      const safetyRequired = counters["live_clod_stream_safety_required_pages"] ?? 0;
      const collidersLoaded = deps.terrainColliders.loadedPageCount();
      waitIndicator.update({ safetyReady, safetyRequired, collidersLoaded });
      const ready = shouldApplyQuerySpawnNow({
        enabled: true,
        safetyReady,
        safetyRequired,
        collidersLoaded,
        framesWaited,
        maxFrames: SPAWN_GATE_STALL_WARNING_FRAMES,
        targetCellReady: deps.movementReadyAt ? deps.movementReadyAt(spawn.x, spawn.z) : undefined,
      });
      if (ready) {
        waitIndicator.done();
        performQuerySpawn(xVal, zVal, spawn, yawVal);
        gameplayDiagnostics.set("time_to_gameplay_ready_ms", performance.now() - gateStartedAt);
        return;
      }
      if (framesWaited === SPAWN_GATE_STALL_WARNING_FRAMES) {
        deps.playerModeStatus.textContent = "Spawn area is still streaming — waiting for safe terrain";
        console.warn(`[player] query spawn safety gate stalled at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}); continuing to wait`);
      }
      framesWaited++;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
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
