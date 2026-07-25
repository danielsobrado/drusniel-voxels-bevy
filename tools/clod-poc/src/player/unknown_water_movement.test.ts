import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PlayerController, type PlayerInputState } from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import type { WaterAuthority, WaterSample } from "../water/water_authority.js";
import { type CellReadinessFeeds, movementReadinessAt } from "./cell_readiness.js";

// Reproduction of the "clunky movement / stuck at the frontier" report, headless.
//
// The predictive-streaming fix (hydrology_prefetch_lead.ts) intentionally KEEPS this
// fail-closed freeze — it prevents water being "unknown" ahead of the player rather than
// making unknown water walkable — so these assertions stay a valid contract, not a bug to flip.
//
// The hydrology tile atlas is built only inside a grid; beyond it the water authority
// returns state "unknown" (water_authority.ts:237 -> unknownSample). Here the built region
// is z > UNKNOWN_Z; walking forward (-z) crosses into the not-yet-built region — the whole
// path is on collision-ready floor, so the ONLY thing that can stop the player is water.
//
// Two INDEPENDENT freeze paths both trip on the same "unknown" condition, which is why the
// water toggle could not tell them apart and a gate-only trace missed the second one:
//  - the movementReadinessAt look-ahead gate (waterQueryReady === false), and
//  - the swim contact freeze at the current cell (resolveSwimContact -> "blocked_unknown").

const BOUNDS = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE: PlayerInputState = { forward: 0, right: 0, sprint: false, jump: false, dive: false };
const UNKNOWN_Z = -5;

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function floorColliders(): TerrainColliderSet {
  const set = new TerrainColliderSet([{
    id: "floor",
    geometry: plane(180, 0),
    footprint: { minX: -90, minZ: -90, maxX: 90, maxZ: 90 },
  }]);
  set.prewarmAll();
  return set;
}

function drySample(): WaterSample {
  return { state: "dry", surfaceY: -100, bottomY: -108, bodyId: "", bodyKind: "lake", flow: [0, 0], sourceRevision: 1 };
}

function unknownSample(): WaterSample {
  return { state: "unknown", surfaceY: Number.NaN, bodyId: "", bodyKind: "lake", flow: [0, 0], sourceRevision: 1 };
}

function boundaryAuthority(): WaterAuthority {
  const sample = (_x: number, z: number): WaterSample => (z <= UNKNOWN_Z ? unknownSample() : drySample());
  return { sample, readyAt: (x, z) => sample(x, z).state !== "unknown", revision: () => 1 };
}

// Collision-ready + certified everywhere, water is the only variable — isolates the freeze cause.
function collisionReadyFeeds(terrain: TerrainColliderSet, authority: WaterAuthority): CellReadinessFeeds {
  return {
    terrainRevision: () => 0,
    colliderStatusAt: (x, z) => terrain.colliderStatusAt(x, z),
    columnCertified: () => true,
    editAuthorityResidentAt: () => true,
    waterQueryReadyAt: (x, z) => authority.readyAt(x, z),
  };
}

function walkForward(player: PlayerController, seconds: number): void {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) player.update(1 / 60, { ...IDLE, forward: 1 }, FORWARD);
}

describe("unknown-water movement freeze (reproduction)", () => {
  it("path A: the look-ahead readiness gate halts the player before the unknown boundary", () => {
    const terrain = floorColliders();
    const authority = boundaryAuthority();
    const feeds = collisionReadyFeeds(terrain, authority);
    const player = new PlayerController(terrain, BOUNDS);
    player.attachMovementReadiness((x, z) => movementReadinessAt(feeds, x, z));
    player.attachWaterAuthority(authority);
    player.spawn(new THREE.Vector3(0, 0.4, 0));

    walkForward(player, 8);

    // Walked part-way, then frozen shy of the boundary on solid collision-ready floor.
    expect(player.position.z).toBeLessThan(-1);
    expect(player.position.z).toBeGreaterThan(UNKNOWN_Z);
    expect(player.velocity.length()).toBeLessThan(1e-3);
    // Still over dry ground — this is the gate, not the swim freeze.
    expect(player.swimMode).toBe("dry");
    terrain.dispose();
  });

  it("path B: the swim contact freezes the player at the current cell even when the gate allows it", () => {
    const terrain = floorColliders();
    const authority = boundaryAuthority();
    const player = new PlayerController(terrain, BOUNDS);
    // Gate always "ready" isolates the SECOND freeze path — the one the look-ahead trace misses.
    player.attachMovementReadiness(() => "ready");
    player.attachWaterAuthority(authority);
    player.spawn(new THREE.Vector3(0, 0.4, 0));

    walkForward(player, 8);

    // Steps across the boundary, then frozen in place by swim contact.
    expect(player.position.z).toBeLessThan(UNKNOWN_Z);
    expect(player.swimMode).toBe("blocked_unknown");
    expect(player.velocity.length()).toBeLessThan(1e-3);
    terrain.dispose();
  });
});
