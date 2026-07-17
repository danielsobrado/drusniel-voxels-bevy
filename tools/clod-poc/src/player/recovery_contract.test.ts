// Recovery contract (playable-world-contract P3.2): recover ONLY on proven-invalid
// conditions. A player deep below their last grounded position in a covered column is
// legitimately falling into a cave — the floor collider catches them, not a teleport.
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
} from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { gameplayDiagnostics, resetGameplayDiagnosticsForTests } from "./gameplay_diagnostics.js";

const BOUNDS = { minX: -2000, minZ: -2000, maxX: 2000, maxZ: 2000 };
const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function totalRecoveries(): number {
  return gameplayDiagnostics.get("player_recovery_non_finite")
    + gameplayDiagnostics.get("player_recovery_kill_plane")
    + gameplayDiagnostics.get("player_recovery_missing_collider")
    + gameplayDiagnostics.get("player_recovery_backstop_depth");
}

beforeEach(() => {
  resetGameplayDiagnosticsForTests();
});

describe("recovery contract: proven-invalid conditions", () => {
  it("deep cave traversal (60 m drop onto a real floor) triggers ZERO recoveries", () => {
    // Fails against pre-P3 code: the crude 32 m sink rule teleported the player back
    // mid-air, so drops deeper than 32 m never completed.
    const colliders = new TerrainColliderSet([
      { id: "floor", geometry: plane(200, 0), footprint: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "ready"); // covered world
    controller.spawn(new THREE.Vector3(0, 60, 0));
    let landed = false;
    for (let i = 0; i < 1200 && !landed; i++) {
      controller.update(STEP, IDLE, FORWARD);
      landed = controller.grounded;
    }
    expect(landed).toBe(true);
    expect(Math.abs(controller.position.y)).toBeLessThan(0.5);
    expect(totalRecoveries()).toBe(0);
  });

  it("kill plane: falling below the valid volume recovers with the kill-plane reason", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "ready"); // covered — depth rule must NOT fire
    controller.spawn(new THREE.Vector3(0, 20, 0));
    for (let i = 0; i < 1200 && gameplayDiagnostics.get("player_recovery_kill_plane") === 0; i++) {
      controller.update(STEP, IDLE, FORWARD);
    }
    expect(gameplayDiagnostics.get("player_recovery_kill_plane")).toBeGreaterThan(0);
    expect(gameplayDiagnostics.get("player_recovery_backstop_depth")).toBe(0);
    expect(controller.position.y).toBeCloseTo(20, 0); // back at last safe (spawn)
  });

  it("non-finite state recovers immediately with the non-finite reason", () => {
    const colliders = new TerrainColliderSet([
      { id: "g", geometry: plane(100, 0), footprint: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "ready");
    controller.spawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    controller.velocity.x = Number.NaN;
    controller.update(STEP, IDLE, FORWARD);
    expect(gameplayDiagnostics.get("player_recovery_non_finite")).toBeGreaterThan(0);
    expect(Number.isFinite(controller.position.x)).toBe(true);
    expect(Number.isFinite(controller.velocity.x)).toBe(true);
  });

  it("falling in a blocked column recovers after the bounded step count", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "blocked"); // every barrier failed somehow
    controller.spawn(new THREE.Vector3(0, 20, 0));
    for (let i = 0; i <= DEFAULT_PLAYER_CONFIG.invalidColumnRecoverySteps + 2; i++) {
      controller.update(STEP, IDLE, FORWARD);
      if (gameplayDiagnostics.get("player_recovery_missing_collider") > 0) break;
    }
    expect(gameplayDiagnostics.get("player_recovery_missing_collider")).toBeGreaterThan(0);
    expect(controller.position.y).toBeCloseTo(20, 0);
  });

  it("probe-less worlds keep the legacy 32 m sink rule with its reason code", () => {
    const colliders = new TerrainColliderSet([
      { id: "g", geometry: plane(100, 0), footprint: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    const safe = controller.lastSafePosition.clone();
    controller.position.y = safe.y - DEFAULT_PLAYER_CONFIG.recoveryDepth - 1;
    controller.update(STEP, IDLE, FORWARD);
    expect(gameplayDiagnostics.get("player_recovery_backstop_depth")).toBeGreaterThan(0);
    expect(controller.position.distanceTo(safe)).toBeLessThan(0.05);
  });

  it("terminal velocity: a long natural fall never exceeds maxFallSpeed", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "ready");
    controller.spawn(new THREE.Vector3(0, 200, 0));
    let minVy = 0;
    for (let i = 0; i < 600; i++) {
      controller.update(STEP, IDLE, FORWARD);
      minVy = Math.min(minVy, controller.velocity.y);
    }
    expect(minVy).toBeGreaterThanOrEqual(-DEFAULT_PLAYER_CONFIG.maxFallSpeed - 1e-6);
    expect(minVy).toBeLessThan(-DEFAULT_PLAYER_CONFIG.maxFallSpeed + 1);
  });
});
