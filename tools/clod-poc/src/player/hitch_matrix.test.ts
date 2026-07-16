// Hitch matrix characterization (playable-world-contract P0.2). The 120 Hz fixed step
// does NOT automatically prevent tunnelling — resolution is positional against BVH
// triangles — so thin-feature behavior is measured here, not assumed. These record
// current behavior; P3 promotes the calibrated cases to gates and fixes what fails.
import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
} from "../player_controller.js";
import { TerrainColliderSet, type TerrainColliderPage } from "../terrain/terrain_collider.js";
import { gameplayDiagnostics, resetGameplayDiagnosticsForTests } from "./gameplay_diagnostics.js";

const BOUNDS = { minX: -5000, minZ: -5000, maxX: 5000, maxZ: 5000 };
const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };
const SPRINT = { forward: 1, right: 0, sprint: true, jump: false };

function page(id: string, geometry: THREE.BufferGeometry, minX: number, minZ: number, maxX: number, maxZ: number): TerrainColliderPage {
  return { id, geometry, footprint: { minX, minZ, maxX, maxZ } };
}

function groundPlane(size: number, y = 0): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function settledSprinter(colliders: TerrainColliderSet, spawn = new THREE.Vector3(0, 0, 0)): PlayerController {
  const controller = new PlayerController(colliders, BOUNDS);
  controller.spawn(spawn);
  for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
  for (let i = 0; i < 240; i++) controller.update(STEP, SPRINT, FORWARD); // reach 16 u/s
  return controller;
}

beforeEach(() => {
  resetGameplayDiagnosticsForTests();
});

describe("hitch matrix: frame-time shapes on solid ground", () => {
  it("single 100 ms frame while sprinting: full 100 ms simulated, still grounded", () => {
    const colliders = new TerrainColliderSet([page("g", groundPlane(2000), -1000, -1000, 1000, 1000)]);
    const controller = settledSprinter(colliders);
    const zBefore = controller.position.z;
    controller.update(0.1, SPRINT, FORWARD);
    expect(zBefore - controller.position.z).toBeCloseTo(16 * 0.1, 1);
    expect(controller.grounded).toBe(true);
  });

  it("single 250 ms hitch: only 100 ms simulated (time dilation), grounded, no recovery", () => {
    const colliders = new TerrainColliderSet([page("g", groundPlane(2000), -1000, -1000, 1000, 1000)]);
    const controller = settledSprinter(colliders);
    const zBefore = controller.position.z;
    controller.update(0.25, SPRINT, FORWARD);
    expect(zBefore - controller.position.z).toBeCloseTo(16 * 0.1, 1); // NOT 16 * 0.25
    expect(controller.grounded).toBe(true);
    expect(gameplayDiagnostics.get("player_recovery_backstop_depth")).toBe(0);
  });

  it("alternating 8 ms / 40 ms frames for 2 s: grounded throughout, sprint speed held", () => {
    const colliders = new TerrainColliderSet([page("g", groundPlane(4000), -2000, -2000, 2000, 2000)]);
    const controller = settledSprinter(colliders);
    let airborneFrames = 0;
    let elapsed = 0;
    for (let i = 0; elapsed < 2; i++) {
      const dt = i % 2 === 0 ? 0.008 : 0.04;
      controller.update(dt, SPRINT, FORWARD);
      elapsed += dt;
      if (!controller.grounded) airborneFrames++;
    }
    expect(airborneFrames).toBe(0);
    expect(Math.hypot(controller.velocity.x, controller.velocity.z)).toBeCloseTo(16, 1);
  });
});

describe("hitch matrix: thin features and high velocity", () => {
  it("sprint into a zero-thickness wall during a 100 ms hitch frame: blocked, no tunnelling", () => {
    const wall = new THREE.PlaneGeometry(40, 8, 1, 1); // vertical, facing ±z, at z = -20
    wall.translate(0, 4, 0);
    const wallZ = -20;
    wall.translate(0, 0, wallZ);
    const colliders = new TerrainColliderSet([
      page("g", groundPlane(2000), -1000, -1000, 1000, 1000),
      page("wall", wall, -20, wallZ - 1, 20, wallZ + 1),
    ]);
    const controller = settledSprinter(colliders);
    for (let i = 0; i < 40; i++) controller.update(0.1, SPRINT, FORWARD); // 4 s of hitchy frames
    // Characterized: per-fixed-step motion (16/120 = 0.13 m) stays under the capsule
    // radius (0.45 m), so the positional resolve blocks even a zero-thickness wall.
    expect(controller.position.z).toBeGreaterThan(wallZ - DEFAULT_PLAYER_CONFIG.capsuleRadius - 0.05);
  });

  it("fall onto a thin floor from 30 m (~42 m/s): caught — per-step motion still well under the capsule", () => {
    const colliders = new TerrainColliderSet([page("g", groundPlane(2000), -1000, -1000, 1000, 1000)]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 30, 0));
    for (let i = 0; i < 1200 && !controller.grounded; i++) controller.update(STEP, IDLE, FORWARD);
    expect(controller.grounded).toBe(true);
    expect(Math.abs(controller.position.y)).toBeLessThan(0.5);
  });

  it("KNOWN LIMIT: a drop deeper than recoveryDepth (32 m) NEVER completes — the sink rule treats long free fall as invalid state", () => {
    // Falling does not update lastSafePosition, so 32 m below the spawn/last-grounded
    // point the recovery teleports the player back up mid-air, forever. A 200 m drop
    // (or digging a deep shaft under yourself) yo-yos instead of landing. Recorded as a
    // P0 finding; the P3 recovery contract (proven-invalid conditions only) removes it.
    const colliders = new TerrainColliderSet([page("g", groundPlane(2000), -1000, -1000, 1000, 1000)]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 200, 0));
    let landed = false;
    let minY = 200;
    for (let i = 0; i < 2400; i++) {
      controller.update(STEP, IDLE, FORWARD);
      minY = Math.min(minY, controller.position.y);
      if (controller.grounded) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(false);
    expect(minY).toBeGreaterThan(200 - 34); // snapped back before ever nearing the floor
    expect(gameplayDiagnostics.get("player_recovery_backstop_depth")).toBeGreaterThan(0);
  });

  it("KNOWN LIMIT: at injected 600 m/s fall speed the capsule can pass a zero-thickness floor (no swept resolve, no terminal velocity)", () => {
    // 600 m/s → 5 m per 120 Hz step, far above the 1.8 m capsule: when the plane falls in
    // the inter-step gap the positional resolve never sees it. (At 300 m/s the same drop
    // happens to sample inside the capsule and is caught — thin-feature safety is
    // alignment luck, not a guarantee.) Unreachable by natural falls today only because
    // the 32 m sink rule fires first; a terminal-velocity/swept fix owns this case.
    const colliders = new TerrainColliderSet([page("floor", groundPlane(2000), -1000, -1000, 1000, 1000)]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 12, 0));
    controller.velocity.y = -600;
    let minY = 10;
    let grounded = false;
    for (let i = 0; i < 30; i++) {
      controller.update(STEP, IDLE, FORWARD);
      minY = Math.min(minY, controller.position.y);
      if (controller.grounded) {
        grounded = true;
        break;
      }
    }
    expect(grounded).toBe(false);
    expect(minY).toBeLessThan(-2); // passed through the floor plane at y = 0
  });

  it("jump into a low ceiling (1.9 m clearance over a 1.8 m capsule): pushed out, lands again, no sticking", () => {
    const ceiling = groundPlane(40, 1.9);
    const colliders = new TerrainColliderSet([
      page("g", groundPlane(2000), -1000, -1000, 1000, 1000),
      page("ceiling", ceiling, -20, -20, 20, 20),
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    controller.update(STEP, { ...IDLE, jump: true }, FORWARD);
    let maxY = 0;
    let landed = false;
    for (let i = 0; i < 600; i++) {
      controller.update(STEP, IDLE, FORWARD);
      maxY = Math.max(maxY, controller.position.y);
      if (i > 5 && controller.grounded) {
        landed = true;
        break;
      }
    }
    expect(maxY).toBeLessThan(0.35); // capsule top stopped at the ceiling (1.9 - 1.8 + push-out slack)
    expect(landed).toBe(true);
  });

  it("fall onto a narrow (1 m) ledge: caught by the ledge when the drop centers on it", () => {
    const ledge = new THREE.PlaneGeometry(1, 1, 1, 1);
    ledge.rotateX(-Math.PI / 2);
    ledge.translate(0, 50, 0);
    const colliders = new TerrainColliderSet([page("ledge", ledge, -0.5, -0.5, 0.5, 0.5)]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 60, 0));
    let caught = false;
    for (let i = 0; i < 600; i++) {
      controller.update(STEP, IDLE, FORWARD);
      if (controller.grounded) {
        caught = true;
        break;
      }
      if (controller.position.y < 40) break;
    }
    expect(caught).toBe(true);
    expect(controller.position.y).toBeCloseTo(50, 1);
  });
});

describe("hitch matrix: page boundary during collider swap", () => {
  it("sprinting across a boundary while the far page has a queued (unprocessed) rebuild: old collider serves, zero coverage loss", () => {
    const left = groundPlane(40);
    left.translate(0, 0, 20);
    const right = groundPlane(40);
    right.translate(0, 0, -20);
    const colliders = new TerrainColliderSet([
      page("left", left, -20, 0, 20, 40),
      page("right", right, -20, -40, 20, 0),
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 0, 20));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);

    // Queue a replacement for the destination page mid-run and never process it: the
    // old collider must keep serving (stale-safe), not leave a gap frame.
    const replacement = groundPlane(40);
    replacement.translate(0, 0, -20);
    expect(colliders.schedulePageUpdate("right", replacement, 1)).toBe(true);

    let airborneFrames = 0;
    for (let i = 0; i < 600 && controller.position.z > -20; i++) {
      controller.update(STEP, SPRINT, FORWARD);
      if (!controller.grounded) airborneFrames++;
    }
    expect(controller.position.z).toBeLessThan(-19);
    expect(airborneFrames).toBe(0);
    expect(gameplayDiagnostics.get("collider_coverage_missing")).toBe(0);
    expect(gameplayDiagnostics.get("collider_stale_frames")).toBeGreaterThan(0);
  });
});
