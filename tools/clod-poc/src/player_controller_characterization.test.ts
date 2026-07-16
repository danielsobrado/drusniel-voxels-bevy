// Characterization tests for the verified controller semantics (playable-world-contract
// P0.1). These record CURRENT behavior — they are a semantics table, not a wishlist.
// If one fails after a controller change, either the change is a bug or the recorded
// semantics moved on purpose and this table must be updated alongside the plan doc.
import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  jumpVelocityForHeight,
} from "./player_controller.js";
import { TerrainColliderSet, type TerrainColliderPage } from "./terrain/terrain_collider.js";
import { resetGameplayDiagnosticsForTests } from "./player/gameplay_diagnostics.js";

const BOUNDS = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };
const WALK = { forward: 1, right: 0, sprint: false, jump: false };

function page(id: string, geometry: THREE.BufferGeometry, minX: number, minZ: number, maxX: number, maxZ: number): TerrainColliderPage {
  return { id, geometry, footprint: { minX, minZ, maxX, maxZ } };
}

function groundPlane(size = 400, y = 0): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function groundedController(colliders = new TerrainColliderSet([page("ground", groundPlane(), -200, -200, 200, 200)])): PlayerController {
  const controller = new PlayerController(colliders, BOUNDS);
  controller.spawn(new THREE.Vector3(0, 0, 0));
  // Settle onto the plane so `grounded` is real, not spawn-assumed.
  for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
  expect(controller.grounded).toBe(true);
  return controller;
}

beforeEach(() => {
  resetGameplayDiagnosticsForTests();
});

describe("controller characterization: acceleration", () => {
  it("grounded horizontal speed ramps at groundAcceleration (60 u/s²), one clamped increment per fixed step", () => {
    const controller = groundedController();
    controller.update(STEP, WALK, FORWARD);
    // One 120 Hz step: |Δv| ≤ 60 * (1/120) = 0.5.
    expect(Math.hypot(controller.velocity.x, controller.velocity.z)).toBeCloseTo(0.5, 5);
    // Walk speed 8 needs 16 accel steps (8 / 0.5); it is NOT instant.
    for (let i = 0; i < 15; i++) controller.update(STEP, WALK, FORWARD);
    expect(Math.hypot(controller.velocity.x, controller.velocity.z)).toBeCloseTo(8, 3);
  });

  it("airborne steering uses airAcceleration (16 u/s²) — 3.75× weaker than ground traction", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 100, 0));
    controller.update(STEP, WALK, FORWARD);
    expect(Math.hypot(controller.velocity.x, controller.velocity.z)).toBeCloseTo(16 / 120, 5);
  });
});

describe("controller characterization: fixed-step clamp and time dilation", () => {
  it("a 250 ms frame simulates only 100 ms (12 steps × 1/120) — time dilates under hitches", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 100, 0));
    controller.update(0.25, IDLE, FORWARD);
    // Gravity integrated for exactly 0.1 s of simulated time, not 0.25 s.
    expect(controller.velocity.y).toBeCloseTo(-DEFAULT_PLAYER_CONFIG.gravity * 0.1, 5);
  });

  it("a tab-resume 2 s delta is clamped identically to 100 ms of simulation", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 100, 0));
    controller.update(2.0, IDLE, FORWARD);
    expect(controller.velocity.y).toBeCloseTo(-DEFAULT_PLAYER_CONFIG.gravity * 0.1, 5);
  });

  it("sub-step deltas accumulate: two 1/240 updates run one 1/120 physics step", () => {
    const colliders = new TerrainColliderSet([]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 100, 0));
    controller.update(1 / 240, IDLE, FORWARD);
    expect(controller.velocity.y).toBe(0); // accumulator below one fixed step: nothing simulated
    controller.update(1 / 240, IDLE, FORWARD);
    expect(controller.velocity.y).toBeCloseTo(-DEFAULT_PLAYER_CONFIG.gravity * STEP, 6);
  });
});

describe("controller characterization: jump, coyote time, jump buffer", () => {
  it("jump applies sqrt(2gh) upward velocity and unsets grounded", () => {
    const controller = groundedController();
    controller.update(STEP, { ...IDLE, jump: true }, FORWARD);
    expect(controller.velocity.y).toBeCloseTo(
      jumpVelocityForHeight(DEFAULT_PLAYER_CONFIG.jumpHeight, DEFAULT_PLAYER_CONFIG.gravity),
      3,
    );
    expect(controller.grounded).toBe(false);
  });

  it("coyote time: a jump still fires within 0.12 s after the ground vanishes, not after", () => {
    const jumpVelocity = jumpVelocityForHeight(DEFAULT_PLAYER_CONFIG.jumpHeight, DEFAULT_PLAYER_CONFIG.gravity);

    const airborneStepsBeforeJump = (stepsAirborne: number): number => {
      const colliders = new TerrainColliderSet([page("ground", groundPlane(), -200, -200, 200, 200)]);
      const controller = new PlayerController(colliders, BOUNDS);
      controller.spawn(new THREE.Vector3(0, 0, 0));
      for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
      colliders.removePage("ground"); // the floor disappears under the player
      for (let i = 0; i < stepsAirborne; i++) controller.update(STEP, IDLE, FORWARD);
      controller.update(STEP, { ...IDLE, jump: true }, FORWARD);
      return controller.velocity.y;
    };

    // 13 airborne steps ≈ 0.108 s < 0.12 s coyote window → jump fires.
    expect(airborneStepsBeforeJump(13)).toBeCloseTo(jumpVelocity, 2);
    // 15 airborne steps ≈ 0.125 s > 0.12 s → too late, gravity keeps winning.
    expect(airborneStepsBeforeJump(15)).toBeLessThan(0);
  });

  it("jump buffer: a press up to 0.15 s before landing fires on touchdown", () => {
    const colliders = new TerrainColliderSet([page("ground", groundPlane(), -200, -200, 200, 200)]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 3, 0));
    // Fall until just above the ground so touchdown lands inside the 0.15 s buffer window.
    for (let i = 0; i < 200 && controller.position.y > 0.5; i++) controller.update(STEP, IDLE, FORWARD);
    expect(controller.grounded).toBe(false);
    controller.update(STEP, { ...IDLE, jump: true }, FORWARD);
    expect(controller.velocity.y).toBeLessThan(0); // airborne press does not jump mid-air
    // Release; the buffered press fires on touchdown.
    let landedAndJumped = false;
    for (let i = 0; i < 17; i++) {
      controller.update(STEP, IDLE, FORWARD);
      if (controller.velocity.y > 1) {
        landedAndJumped = true;
        break;
      }
    }
    expect(landedAndJumped).toBe(true);
  });
});

describe("controller characterization: slopes and steps over BVH triangles", () => {
  function slopeGrounded(angleDegrees: number): boolean {
    const width = 60;
    const length = 60;
    const rise = Math.tan(THREE.MathUtils.degToRad(angleDegrees)) * length;
    const positions = new Float32Array([
      -width / 2, 0, -length / 2,
      width / 2, 0, -length / 2,
      -width / 2, rise, length / 2,
      width / 2, rise, length / 2,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    const colliders = new TerrainColliderSet([page("slope", geometry, -30, -30, 30, 30)]);
    const controller = new PlayerController(colliders, BOUNDS);
    const midHeight = rise / 2;
    controller.spawn(new THREE.Vector3(0, midHeight + 0.5, 0));
    for (let i = 0; i < 60; i++) controller.update(STEP, IDLE, FORWARD);
    return controller.grounded;
  }

  it("a 55° slope is ground; a 65° slope is a slide (maxSlopeDegrees = 60)", () => {
    expect(slopeGrounded(55)).toBe(true);
    expect(slopeGrounded(65)).toBe(false);
  });

  it("walking into a low step (0.3 m < capsule radius) climbs it via positional push-out", () => {
    const lower = groundPlane(40, 0);
    const upper = groundPlane(40, 0.3);
    upper.translate(0, 0, -40); // raised shelf ahead of the walker (walking toward -z)
    const riser = new THREE.PlaneGeometry(40, 0.3, 1, 1);
    riser.translate(0, 0.15, -20);
    const colliders = new TerrainColliderSet([
      page("lower", lower, -20, -20, 20, 20),
      page("upper", upper, -20, -60, 20, -20),
      page("riser", riser, -20, -21, 20, -19),
    ]);
    const controller = new PlayerController(colliders, BOUNDS);
    controller.spawn(new THREE.Vector3(0, 0, -18));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    for (let i = 0; i < 600; i++) controller.update(STEP, WALK, FORWARD);
    // Characterized: the capsule ends up on the shelf, past the riser.
    expect(controller.position.z).toBeLessThan(-21);
    expect(controller.position.y).toBeGreaterThanOrEqual(0.29);
    expect(controller.grounded).toBe(true);
  });
});

describe("controller characterization: safety net", () => {
  it("lastSafePosition tracks the latest grounded position only", () => {
    const controller = groundedController();
    const safeBefore = controller.lastSafePosition.clone();
    for (let i = 0; i < 30; i++) controller.update(STEP, WALK, FORWARD);
    expect(controller.lastSafePosition.z).toBeLessThan(safeBefore.z);
    expect(controller.lastSafePosition.distanceTo(controller.position)).toBeLessThan(0.01);
  });

  it("recovery is the crude 32 m sink rule: teleport to lastSafePosition, velocity zeroed", () => {
    const controller = groundedController();
    const safe = controller.lastSafePosition.clone();
    controller.position.y = safe.y - 33;
    controller.update(STEP, IDLE, FORWARD);
    expect(controller.position.distanceTo(safe)).toBeLessThan(0.05);
    expect(controller.velocity.length()).toBeLessThan(0.3);
  });
});
