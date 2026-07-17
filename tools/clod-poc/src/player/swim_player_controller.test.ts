import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PlayerController, type PlayerInputState } from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import type { WaterAuthority, WaterSample } from "../water/water_authority.js";

const BOUNDS = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE: PlayerInputState = { forward: 0, right: 0, sprint: false, jump: false, dive: false };

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function colliders(floorY = -20): TerrainColliderSet {
  const set = new TerrainColliderSet([{
    id: "floor",
    geometry: plane(180, floorY),
    footprint: { minX: -90, minZ: -90, maxX: 90, maxZ: 90 },
  }]);
  set.prewarmAll();
  return set;
}

function authority(sampleAt: (x: number, z: number) => WaterSample): WaterAuthority {
  return {
    sample: sampleAt,
    readyAt: (x, z) => sampleAt(x, z).state !== "unknown",
    revision: () => 1,
  };
}

function water(
  surfaceY: number,
  kind: WaterSample["bodyKind"] = "lake",
  flow: readonly [number, number] = [0, 0],
  bodyId = "body:1",
): WaterSample {
  return {
    state: "water",
    surfaceY,
    bottomY: surfaceY - 8,
    bodyId,
    bodyKind: kind,
    flow,
    sourceRevision: 1,
  };
}

function simulate(player: PlayerController, seconds: number, frameRate: number, input: PlayerInputState = IDLE): void {
  const frames = Math.round(seconds * frameRate);
  for (let frame = 0; frame < frames; frame++) player.update(1 / frameRate, input, FORWARD);
}

describe("player swim integration", () => {
  it("crosses a lake with fixed-step surface swimming", () => {
    const terrain = colliders();
    const player = new PlayerController(terrain, BOUNDS);
    player.attachMovementReadiness(() => "ready");
    player.attachWaterAuthority(authority(() => water(1.2)));
    player.spawn(new THREE.Vector3(0, 0.4, 0));

    simulate(player, 2, 60, { ...IDLE, forward: 1 });

    expect(player.swimMode).toBe("surface");
    expect(player.position.z).toBeLessThan(-4);
    expect(player.waterSubmersionM).toBeGreaterThan(0.35);
    terrain.dispose();
  });

  it("applies river flow while the player is idle", () => {
    const terrain = colliders();
    const player = new PlayerController(terrain, BOUNDS);
    player.attachMovementReadiness(() => "ready");
    player.attachWaterAuthority(authority(() => water(1.2, "river", [2.5, 0], "river:7")));
    player.spawn(new THREE.Vector3(0, 0.4, 0));

    simulate(player, 2, 60);

    expect(player.swimMode).toBe("surface");
    expect(player.waterBodyId).toBe("river:7");
    expect(player.position.x).toBeGreaterThan(1);
    terrain.dispose();
  });

  it("enters an authoritative cave pond below the surface world", () => {
    const terrain = colliders(-20);
    const player = new PlayerController(terrain, BOUNDS);
    player.attachMovementReadiness(() => "ready");
    player.attachWaterAuthority(authority(() => water(-5, "pond", [0, 0], "edited:cave-pond")));
    player.spawn(new THREE.Vector3(0, -5.8, 0));

    simulate(player, 1, 30);

    expect(player.swimMode).toBe("surface");
    expect(player.waterBodyId).toBe("edited:cave-pond");
    expect(player.position.y).toBeGreaterThan(-6);
    terrain.dispose();
  });

  it("blocks movement while the water authority is unknown", () => {
    const terrain = colliders(0);
    const player = new PlayerController(terrain, BOUNDS);
    player.attachMovementReadiness(() => "blocked");
    player.attachWaterAuthority(authority(() => ({
      state: "unknown",
      surfaceY: Number.NaN,
      bodyId: "",
      bodyKind: "pond",
      flow: [0, 0],
      sourceRevision: 4,
    })));
    player.spawn(new THREE.Vector3(0, 1, 0));
    const start = player.position.clone();

    simulate(player, 1, 20, { ...IDLE, forward: 1, jump: true });

    expect(player.swimMode).toBe("blocked_unknown");
    expect(player.position.distanceTo(start)).toBeLessThan(1e-6);
    expect(player.velocity.length()).toBeLessThan(1e-6);
    terrain.dispose();
  });

  it("produces equivalent lake traversal at 60, 30, and 20 fps", () => {
    const run = (frameRate: number) => {
      const terrain = colliders();
      const player = new PlayerController(terrain, BOUNDS);
      player.attachMovementReadiness(() => "ready");
      player.attachWaterAuthority(authority(() => water(1.2, "lake", [0.4, 0])));
      player.spawn(new THREE.Vector3(0, 0.4, 0));
      simulate(player, 2, frameRate, { ...IDLE, forward: 1 });
      const result = player.position.clone();
      terrain.dispose();
      return result;
    };

    const at60 = run(60);
    for (const rate of [30, 20]) {
      const actual = run(rate);
      expect(actual.x).toBeCloseTo(at60.x, 5);
      expect(actual.y).toBeCloseTo(at60.y, 5);
      expect(actual.z).toBeCloseTo(at60.z, 5);
    }
  });
});
