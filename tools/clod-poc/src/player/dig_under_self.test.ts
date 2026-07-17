// Dig-under-self, corrected (playable-world-contract P3.1): old collider active while
// the replacement builds → atomic swap → ground gone → the player becomes airborne and
// FALLS → collides with the next real surface → no tunnelling, no recovery, and no
// "follow terrain" snap. (Bedrock/crust protection is the voxel authority's own guard —
// covered in src/dig.test.ts "respects the bedrock guard".)
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
} from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { GameplayDiagnostics, gameplayDiagnostics, resetGameplayDiagnosticsForTests } from "./gameplay_diagnostics.js";

const BOUNDS = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/** The upper surface after the dig: same footprint, but a hole where the player stands. */
function dugUpperGeometry(y: number): THREE.BufferGeometry {
  // Ring of floor around a 12×12 hole centered on the origin (player position).
  const parts: THREE.BufferGeometry[] = [];
  const strips: Array<[number, number, number, number]> = [
    [-50, -50, 50, -6],   // north strip
    [-50, 6, 50, 50],     // south strip
    [-50, -6, -6, 6],     // west strip
    [6, -6, 50, 6],       // east strip
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x0, z0, x1, z1] of strips) {
    const base = positions.length / 3;
    positions.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  parts.forEach((part) => part.dispose());
  return geometry;
}

beforeEach(() => {
  resetGameplayDiagnosticsForTests();
});

describe("dig-under-self fall semantics", () => {
  it("old collider serves until the swap; then the player falls 60 m onto the real floor below — no snap, no recovery, no tunnel", () => {
    const diagnostics = new GameplayDiagnostics();
    const upperY = 60;
    const colliders = new TerrainColliderSet([
      { id: "upper", geometry: plane(100, upperY), footprint: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 } },
      { id: "floor", geometry: plane(100, 0), footprint: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 } },
    ], null, { diagnostics });
    colliders.prewarmAll();
    const controller = new PlayerController(colliders, BOUNDS);
    controller.attachMovementReadiness(() => "ready"); // both cells stay covered
    controller.spawn(new THREE.Vector3(0, upperY, 0));
    for (let i = 0; i < 20; i++) controller.update(STEP, IDLE, FORWARD);
    expect(controller.grounded).toBe(true);
    expect(controller.position.y).toBeCloseTo(upperY, 1);

    // The dig: replacement queued, NOT yet processed — the old collider must keep
    // serving (stale-safe), the player must not fall through a gap frame.
    expect(colliders.schedulePageUpdate("upper", dugUpperGeometry(upperY), 1)).toBe(true);
    for (let i = 0; i < 10; i++) controller.update(STEP, IDLE, FORWARD);
    expect(controller.grounded).toBe(true);
    expect(controller.position.y).toBeCloseTo(upperY, 1);
    expect(diagnostics.get("collider_stale_frames")).toBeGreaterThan(0);

    // Atomic swap: ground gone under the player.
    expect(colliders.processPendingRebuilds()).toBe(1);

    let landed = false;
    let wasAirborne = false;
    for (let i = 0; i < 1200 && !landed; i++) {
      controller.update(STEP, IDLE, FORWARD);
      if (!controller.grounded) wasAirborne = true;
      else if (wasAirborne) landed = true;
    }
    expect(wasAirborne).toBe(true); // the player FELL — not "followed terrain"
    expect(landed).toBe(true);
    expect(controller.position.y).toBeCloseTo(0, 1); // caught by the real floor below
    expect(gameplayDiagnostics.get("player_recovery_backstop_depth")).toBe(0);
    expect(gameplayDiagnostics.get("player_recovery_missing_collider")).toBe(0);
    expect(gameplayDiagnostics.get("player_recovery_kill_plane")).toBe(0);
    colliders.dispose();
  });
});
