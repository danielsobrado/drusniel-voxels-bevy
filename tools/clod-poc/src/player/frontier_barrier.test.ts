// Frontier barrier (playable-world-contract P2.3): sprinting at a cold, uncertified
// region's readiness frontier stops the player — not floored, not fallen-through.
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  type MovementReadinessProbe,
} from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { gameplayDiagnostics, resetGameplayDiagnosticsForTests } from "./gameplay_diagnostics.js";

const BOUNDS = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };
const SPRINT = { forward: 1, right: 0, sprint: true, jump: false };

function groundPlane(size: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

beforeEach(() => {
  resetGameplayDiagnosticsForTests();
});

describe("frontier barrier", () => {
  const frontierZ = -30; // covered ground for z >= -30; cold cave region beyond
  const probe: MovementReadinessProbe = (_x, z) => (z < frontierZ ? "blocked" : "ready");

  function barrierController(): PlayerController {
    // Collider ground extends past the frontier so any leak would be visible as walking on.
    const colliders = new TerrainColliderSet([
      { id: "ground", geometry: groundPlane(400), footprint: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(probe);
    controller.spawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    return controller;
  }

  it("sprinting at the frontier stops the player at the boundary — never floored, never fallen through", () => {
    const controller = barrierController();
    for (let i = 0; i < 600; i++) controller.update(STEP, SPRINT, FORWARD);
    expect(controller.position.z).toBeGreaterThan(frontierZ - DEFAULT_PLAYER_CONFIG.capsuleRadius - 0.2);
    expect(controller.grounded).toBe(true); // still standing on real ground at the boundary
    expect(Math.hypot(controller.velocity.x, controller.velocity.z)).toBeLessThan(1);
    expect(gameplayDiagnostics.get("frontier_barrier_engagements")).toBeGreaterThan(0);
  });

  it("engagements keep counting under hitchy frames without crossing the frontier", () => {
    const controller = barrierController();
    for (let i = 0; i < 60; i++) controller.update(0.1, SPRINT, FORWARD);
    expect(controller.position.z).toBeGreaterThan(frontierZ - DEFAULT_PLAYER_CONFIG.capsuleRadius - 0.2);
  });

  it("walking away from the frontier is unrestricted; no engagements on a covered route", () => {
    const controller = barrierController();
    const BACKWARD = { forward: -1, right: 0, sprint: true, jump: false };
    for (let i = 0; i < 240; i++) controller.update(STEP, BACKWARD, FORWARD);
    expect(controller.position.z).toBeGreaterThan(20);
    expect(gameplayDiagnostics.get("frontier_barrier_engagements")).toBe(0);
  });

  it("a player already inside a blocked region is not trapped (barrier only guards entry)", () => {
    const colliders = new TerrainColliderSet([
      { id: "ground", geometry: groundPlane(400), footprint: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(probe);
    controller.spawn(new THREE.Vector3(0, 0, -50)); // spawned beyond the frontier
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    const BACKWARD = { forward: -1, right: 0, sprint: false, jump: false };
    for (let i = 0; i < 600; i++) controller.update(STEP, BACKWARD, FORWARD);
    expect(controller.position.z).toBeGreaterThan(frontierZ); // walked back out
  });

  it("without a probe attached behavior is unchanged (no barrier, no counters)", () => {
    const colliders = new TerrainColliderSet([
      { id: "ground", geometry: groundPlane(400), footprint: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 } },
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    for (let i = 0; i < 600; i++) controller.update(STEP, SPRINT, FORWARD);
    expect(controller.position.z).toBeLessThan(frontierZ); // sails straight past
    expect(gameplayDiagnostics.get("frontier_barrier_engagements")).toBe(0);
  });
});
