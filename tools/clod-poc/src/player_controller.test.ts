import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  PlayerInteractionState,
  clampPlayerToWorld,
  jumpVelocityForHeight,
  normalizeMovementInput,
  validatePlayerWorldBoundsFit,
  worldEdgePushbackAcceleration,
} from "./player_controller.js";
import { TerrainColliderSet, type TerrainColliderPage } from "./terrain/terrain_collider.js";

function page(id: string, geometry: THREE.BufferGeometry, minX = -10, minZ = -10, maxX = 10, maxZ = 10): TerrainColliderPage {
  return { id, geometry, footprint: { minX, minZ, maxX, maxZ } };
}

function planeGeometry(size = 20, y = 0): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function rampGeometry(angleDegrees: number, width = 12, length = 12): THREE.BufferGeometry {
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
  geometry.computeVertexNormals();
  return geometry;
}

describe("player interaction state", () => {
  it("moves from orbit through spawn selection into play and back", () => {
    const state = new PlayerInteractionState();
    expect(state.mode).toBe("orbit");
    state.chooseSpawn();
    expect(state.mode).toBe("choosingSpawn");
    state.startPlaying();
    expect(state.mode).toBe("playing");
    state.exitToOrbit();
    expect(state.mode).toBe("orbit");
  });
});

describe("player movement helpers", () => {
  it("keeps the migrated player defaults", () => {
    expect(DEFAULT_PLAYER_CONFIG).toMatchObject({
      walkSpeed: 8,
      runSpeed: 16,
      jumpHeight: 4,
      capsuleRadius: 0.45,
      capsuleHeight: 1.8,
      eyeHeight: 1.7,
      maxSlopeDegrees: 60,
      worldEdgeMargin: 16,
      worldEdgePushbackBand: 48,
      worldEdgePushbackAcceleration: 36,
    });
  });

  it("normalizes diagonal movement and selects sprint speed", () => {
    const input = normalizeMovementInput({ forward: 1, right: 1, sprint: true, jump: false });
    expect(input.direction.length()).toBeCloseTo(1);
    expect(input.speed).toBe(16);
  });

  it("derives jump velocity from gravity and jump height", () => {
    expect(jumpVelocityForHeight(4, 30)).toBeCloseTo(Math.sqrt(240));
  });

  it("clamps the player inside the world margin", () => {
    const position = new THREE.Vector3(2, 5, 127);
    clampPlayerToWorld(position, { minX: 0, minZ: 0, maxX: 128, maxZ: 128 }, 16);
    expect(position.toArray()).toEqual([16, 5, 112]);
  });

  it("validates player bounds have room for the edge margin", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
        DEFAULT_PLAYER_CONFIG,
      ),
    ).not.toThrow();
  });

  it("fails when player bounds are smaller than the edge margin", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: 24, maxZ: 128 },
        DEFAULT_PLAYER_CONFIG,
      ),
    ).toThrow("Player world bounds too small for margin 16");
  });

  it("fails when player bounds are inverted", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 128, minZ: 0, maxX: 0, maxZ: 128 },
        DEFAULT_PLAYER_CONFIG,
      ),
    ).toThrow("Player world bounds must have positive width and depth");
  });

  it("fails when player bounds are not finite", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: Number.NaN, maxZ: 128 },
        DEFAULT_PLAYER_CONFIG,
      ),
    ).toThrow("Player world bounds must be finite numbers");
  });

  it("fails when player margin is not finite", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
        { ...DEFAULT_PLAYER_CONFIG, worldEdgeMargin: Number.NaN },
      ),
    ).toThrow("Player world edge margin must be a finite number greater than 0");
  });

  it("fails when player pushback band is not finite", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
        { ...DEFAULT_PLAYER_CONFIG, worldEdgePushbackBand: Number.NaN },
      ),
    ).toThrow("Player world edge pushback band must be a finite number greater than or equal to 0");
  });

  it("fails when player pushback acceleration is negative", () => {
    expect(() =>
      validatePlayerWorldBoundsFit(
        { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
        { ...DEFAULT_PLAYER_CONFIG, worldEdgePushbackAcceleration: -1 },
      ),
    ).toThrow("Player world edge pushback acceleration must be a finite number greater than or equal to 0");
  });

  it("does not push inside the safe center", () => {
    const push = worldEdgePushbackAcceleration(
      new THREE.Vector3(64, 0, 64),
      { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
      16,
      24,
      36,
    );
    expect(push.toArray()).toEqual([0, 0]);
  });

  it("pushes inward before the hard world clamp", () => {
    const bounds = { minX: 0, minZ: 0, maxX: 128, maxZ: 128 };
    const fromMin = worldEdgePushbackAcceleration(new THREE.Vector3(20, 0, 20), bounds, 16, 24, 36);
    const fromMax = worldEdgePushbackAcceleration(new THREE.Vector3(108, 0, 108), bounds, 16, 24, 36);

    expect(fromMin.x).toBeGreaterThan(0);
    expect(fromMin.y).toBeGreaterThan(0);
    expect(fromMax.x).toBeLessThan(0);
    expect(fromMax.y).toBeLessThan(0);
  });
});

describe("terrain collider set", () => {
  it("finds valid spawn points and rejects misses", () => {
    const colliders = new TerrainColliderSet([page("ground", planeGeometry())]);
    const hit = colliders.raycastSpawn(new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)));
    expect(hit?.point.y).toBeCloseTo(0);
    expect(colliders.raycastSpawn(new THREE.Ray(new THREE.Vector3(30, 10, 30), new THREE.Vector3(0, -1, 0)))).toBeNull();
  });

  it("resolves a capsule on flat ground and across adjacent page boundaries", () => {
    const left = planeGeometry(10);
    left.translate(-5, 0, 0);
    const right = planeGeometry(10);
    right.translate(5, 0, 0);
    const colliders = new TerrainColliderSet([
      page("left", left, -10, -5, 0, 5),
      page("right", right, 0, -5, 10, 5),
    ]);
    const result = colliders.resolveCapsule(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, -1, 0), DEFAULT_PLAYER_CONFIG);
    expect(result.position.y).toBeGreaterThanOrEqual(-0.001);
    expect(result.grounded).toBe(true);
    expect(result.pagesTested).toBe(2);
  });

  it("treats a walkable ramp as ground and a steep ramp as a slide", () => {
    const walkable = new TerrainColliderSet([page("ramp", rampGeometry(30))]);
    const steep = new TerrainColliderSet([page("steep", rampGeometry(70))]);
    const walkResult = walkable.resolveCapsule(new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(0, -2, 0), DEFAULT_PLAYER_CONFIG);
    const steepResult = steep.resolveCapsule(new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, -2, 0), DEFAULT_PLAYER_CONFIG);
    expect(walkResult.grounded).toBe(true);
    expect(steepResult.grounded).toBe(false);
  });

  it("blocks horizontal movement through a wall", () => {
    const wall = new THREE.PlaneGeometry(20, 20, 1, 1);
    wall.translate(0, DEFAULT_PLAYER_CONFIG.capsuleHeight / 2, 0);
    const colliders = new TerrainColliderSet([page("wall", wall)]);
    const result = colliders.resolveCapsule(
      new THREE.Vector3(0, 0, -0.2),
      new THREE.Vector3(0, 0, 4),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(result.position.z).toBeLessThanOrEqual(-DEFAULT_PLAYER_CONFIG.capsuleRadius + 0.001);
    expect(result.velocity.z).toBeCloseTo(0);
    expect(result.grounded).toBe(false);
  });
});

describe("fixed-step player controller", () => {
  it("moves, jumps, and recovers to the last safe position", () => {
    const colliders = new TerrainColliderSet([page("ground", planeGeometry(100), -50, -50, 50, 50)]);
    const controller = new PlayerController(colliders, { minX: -50, minZ: -50, maxX: 50, maxZ: 50 });
    controller.spawn(new THREE.Vector3(0, 0, 0));
    controller.update(1 / 30, { forward: 1, right: 0, sprint: false, jump: false }, new THREE.Vector3(0, 0, -1));
    expect(controller.position.z).toBeLessThan(0);

    controller.grounded = true;
    controller.update(1 / 60, { forward: 0, right: 0, sprint: false, jump: true }, new THREE.Vector3(0, 0, -1));
    expect(controller.velocity.y).toBeGreaterThan(0);

    const safe = controller.lastSafePosition.clone();
    controller.position.y = -100;
    controller.update(1 / 60, { forward: 0, right: 0, sprint: false, jump: false }, new THREE.Vector3(0, 0, -1));
    expect(controller.position.distanceTo(safe)).toBeLessThan(0.01);
  });
});
