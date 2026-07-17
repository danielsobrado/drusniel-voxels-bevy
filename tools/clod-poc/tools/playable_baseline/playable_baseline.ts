// Honest baseline harness (playable-world-contract P0.4): a deterministic scripted
// 10-sim-minute run (walk + sprint + jump + dig + teleport + one cave + one unstreamed
// frontier) over a synthetic world, recording every reason-coded event. Runs twice:
// "legacy" reproduces the pre-contract configuration (uncertified height fallback, sync
// collider rebuilds, no barrier); "contract" runs the P1/P2 wiring. The comparison is
// the evidence that the restriction bites and that only real failures gate.
import * as THREE from "three";
import { PlayerController } from "../../src/player_controller.js";
import {
  TerrainColliderSet,
  type TerrainColliderPage,
} from "../../src/terrain/terrain_collider.js";
import {
  gameplayDiagnostics,
  resetGameplayDiagnosticsForTests,
} from "../../src/player/gameplay_diagnostics.js";
import {
  appColumnCertified,
  createAppCellReadinessFeeds,
  movementReadinessAt,
  teleportTargetReady,
} from "../../src/player/cell_readiness.js";
import { addDigEdit, clearDigEdits } from "../../src/terrain/terrain_edits.js";
import { setVoxelOverlayResidentBounds } from "../../src/terrain/voxel_overlay/voxel_overlay.js";

export const WORLD_SIZE_M = 640;
const PAGE_SIZE_M = 64;
const PAGE_GRID_STEP_M = 4;

// One cave from the (simulated) voxel overlay: a hole in the surface with a real floor
// 8 m below — legitimately below the canonical surface.
export const CAVE = { minX: 280, minZ: 280, maxX: 312, maxZ: 312 };
const CAVE_HOLE = { minX: 288, minZ: 288, maxX: 304, maxZ: 304 };
const CAVE_FLOOR_DEPTH_M = 8;

// A never-streamed corner (no collider pages, overlay-resident → uncertified): the
// frontier the barrier must hold and the fake floor must not paper over.
export const UNSTREAMED = { minX: 576, minZ: 576, maxX: 640, maxZ: 640 };

export function baseSurfaceHeight(x: number, z: number): number {
  return 40 + 6 * Math.sin(x * 0.02) + 6 * Math.cos(z * 0.017);
}

interface Carve {
  x: number;
  z: number;
  r: number;
  depth: number;
}

function carvedSurfaceHeight(x: number, z: number, carves: readonly Carve[]): number {
  let y = baseSurfaceHeight(x, z);
  for (const carve of carves) {
    const d = Math.hypot(x - carve.x, z - carve.z);
    if (d < carve.r) y -= carve.depth * (1 - d / carve.r);
  }
  return y;
}

function inRect(x: number, z: number, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  return x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
}

function pageId(px: number, pz: number): string {
  return `page:${px},${pz}`;
}

/** Grid-triangulated page mesh over the carved surface, skipping cells inside the cave hole. */
function buildPageGeometry(px: number, pz: number, carves: readonly Carve[]): THREE.BufferGeometry {
  const x0 = px * PAGE_SIZE_M;
  const z0 = pz * PAGE_SIZE_M;
  const cells = PAGE_SIZE_M / PAGE_GRID_STEP_M;
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<string, number>();
  const vertexAt = (gx: number, gz: number): number => {
    const key = `${gx},${gz}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;
    const x = x0 + gx * PAGE_GRID_STEP_M;
    const z = z0 + gz * PAGE_GRID_STEP_M;
    positions.push(x, carvedSurfaceHeight(x, z, carves), z);
    const index = positions.length / 3 - 1;
    vertexIndex.set(key, index);
    return index;
  };
  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const cx = x0 + (gx + 0.5) * PAGE_GRID_STEP_M;
      const cz = z0 + (gz + 0.5) * PAGE_GRID_STEP_M;
      if (inRect(cx, cz, CAVE_HOLE)) continue; // the cave mouth: no surface here
      const a = vertexAt(gx, gz);
      const b = vertexAt(gx + 1, gz);
      const c = vertexAt(gx, gz + 1);
      const d = vertexAt(gx + 1, gz + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}

function buildCaveFloorGeometry(): THREE.BufferGeometry {
  const y = baseSurfaceHeight((CAVE.minX + CAVE.maxX) / 2, (CAVE.minZ + CAVE.maxZ) / 2) - CAVE_FLOOR_DEPTH_M;
  const geometry = new THREE.PlaneGeometry(CAVE.maxX - CAVE.minX, CAVE.maxZ - CAVE.minZ, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((CAVE.minX + CAVE.maxX) / 2, y, (CAVE.minZ + CAVE.maxZ) / 2);
  return geometry;
}

export function caveFloorY(): number {
  return baseSurfaceHeight((CAVE.minX + CAVE.maxX) / 2, (CAVE.minZ + CAVE.maxZ) / 2) - CAVE_FLOOR_DEPTH_M;
}

function buildWorldPages(carves: readonly Carve[]): TerrainColliderPage[] {
  const pages: TerrainColliderPage[] = [];
  const gridPages = WORLD_SIZE_M / PAGE_SIZE_M;
  for (let pz = 0; pz < gridPages; pz++) {
    for (let px = 0; px < gridPages; px++) {
      const minX = px * PAGE_SIZE_M;
      const minZ = pz * PAGE_SIZE_M;
      // The unstreamed corner never gets collider pages.
      if (inRect(minX + PAGE_SIZE_M / 2, minZ + PAGE_SIZE_M / 2, UNSTREAMED)) continue;
      pages.push({
        id: pageId(px, pz),
        geometry: buildPageGeometry(px, pz, carves),
        footprint: { minX, minZ, maxX: minX + PAGE_SIZE_M, maxZ: minZ + PAGE_SIZE_M },
      });
    }
  }
  pages.push({
    id: "cave-floor",
    geometry: buildCaveFloorGeometry(),
    footprint: { ...CAVE },
  });
  return pages;
}

export interface BaselineRunResult {
  label: "legacy" | "contract";
  simSeconds: number;
  wallClockMs: number;
  counters: Record<string, number>;
  digs: number;
  teleports: number;
  jumps: number;
  /** Frames spent standing on the invented fallback floor inside the cave/unstreamed zones. */
  fakeFloorFramesInCave: number;
  fakeFloorFramesUnstreamed: number;
  caveFloorReached: boolean;
  enteredUnstreamed: boolean;
  finalPosition: [number, number, number];
}

const FRAME_DT = 1 / 60;
const BOUNDS = { minX: 0, minZ: 0, maxX: WORLD_SIZE_M, maxZ: WORLD_SIZE_M };

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function runPlayableBaseline(
  label: "legacy" | "contract",
  simSeconds = 600,
  traceSink?: string[],
  routeSeed = 0xd275,
): BaselineRunResult {
  resetGameplayDiagnosticsForTests();
  clearDigEdits();
  setVoxelOverlayResidentBounds("baseline-cave", null);
  setVoxelOverlayResidentBounds("baseline-unstreamed", null);
  if (label === "contract") {
    // The 3D regions announce themselves through the voxel overlay residency mask —
    // the same mask the app certifier consults.
    setVoxelOverlayResidentBounds("baseline-cave", CAVE);
    setVoxelOverlayResidentBounds("baseline-unstreamed", UNSTREAMED);
  }

  const carves: Carve[] = [];
  const colliders = new TerrainColliderSet(buildWorldPages(carves), {
    enabled: true,
    surfaceHeight: baseSurfaceHeight, // canonical (pre-edit) surface — the risk to contain
    ...(label === "contract" ? { certifyColumn: appColumnCertified } : {}),
  });
  colliders.prewarmAll();

  const controller = new PlayerController(colliders, BOUNDS);
  if (label === "contract") {
    const feeds = createAppCellReadinessFeeds({ terrainColliders: colliders });
    controller.attachMovementReadiness((x, z) => movementReadinessAt(feeds, x, z));
  }
  const readinessFeeds = createAppCellReadinessFeeds({ terrainColliders: colliders });

  controller.spawn(new THREE.Vector3(96, baseSurfaceHeight(96, 96) + 0.5, 96));

  const random = seededRandom(routeSeed); // deterministic route
  let heading = 0;
  let digs = 0;
  let teleports = 0;
  let jumps = 0;
  let fakeFloorFramesInCave = 0;
  let fakeFloorFramesUnstreamed = 0;
  let caveFloorReached = false;
  let enteredUnstreamed = false;

  const frames = Math.round(simSeconds / FRAME_DT);
  const startedAt = performance.now();

  const performDig = () => {
    const x = controller.position.x;
    const z = controller.position.z;
    const carve: Carve = { x, z, r: 6, depth: 1.5 };
    carves.push(carve);
    // Register the edit with the real voxel authority: revision bumps, column loses
    // certification — exactly what a live dig does.
    addDigEdit({ x, y: carvedSurfaceHeight(x, z, carves), z, r: 3 });
    const px = Math.floor(x / PAGE_SIZE_M);
    const pz = Math.floor(z / PAGE_SIZE_M);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const id = pageId(px + dx, pz + dz);
        const geometry = buildPageGeometry(px + dx, pz + dz, carves);
        if (label === "contract") {
          if (!colliders.schedulePageUpdate(id, geometry, digs + 1)) geometry.dispose();
        } else {
          if (!colliders.updatePage(id, geometry, digs + 1)) geometry.dispose();
        }
      }
    }
    digs++;
  };

  const teleportTo = (x: number, y: number, z: number) => {
    if (label === "contract") {
      // Teleport gate: hold until a collision-ready movement envelope exists (all
      // resident here, so this asserts the wiring rather than waiting).
      if (!teleportTargetReady(readinessFeeds, x, z)) return;
    }
    controller.spawn(new THREE.Vector3(x, y, z));
    teleports++;
  };

  for (let frame = 0; frame < frames; frame++) {
    const t = frame * FRAME_DT;

    // Route script — heading drifts every 8 s; sprint 3 s of every 10; jump every 7 s.
    if (frame % Math.round(8 / FRAME_DT) === 0) heading = random() * Math.PI * 2;
    const sprint = t % 10 < 3;
    const jump = frame % Math.round(7 / FRAME_DT) === 0 && frame > 0;
    if (jump) jumps++;

    // Dig every 20 s.
    if (frame > 0 && frame % Math.round(20 / FRAME_DT) === 0) performDig();

    // Teleports: minute 5 into the cave void (legitimately below the canonical surface);
    // minute 8 next to the unstreamed frontier, walking straight at it; every other
    // 2-minute mark a plain surface teleport.
    if (frame === Math.round(300 / FRAME_DT)) {
      teleportTo(296, baseSurfaceHeight(296, 296) - 6, 296);
    } else if (frame === Math.round(480 / FRAME_DT)) {
      teleportTo(UNSTREAMED.minX - 24, baseSurfaceHeight(UNSTREAMED.minX - 24, UNSTREAMED.minZ + 32) + 0.5, UNSTREAMED.minZ + 32);
    } else if (frame > 0 && frame % Math.round(120 / FRAME_DT) === 0) {
      const tx = 96 + random() * 320;
      const tz = 96 + random() * 128;
      teleportTo(tx, baseSurfaceHeight(tx, tz) + 0.5, tz);
    }

    // Steering: between minutes 5–5.7 wander inside the cave; from minute 8 head
    // straight into the unstreamed corner (the frontier walk).
    let direction = heading;
    if (t >= 300 && t < 342) {
      direction = random() * Math.PI * 2; // cave wander (region is small)
    } else if (t >= 480) {
      direction = Math.atan2(UNSTREAMED.minX + 32 - controller.position.x, -(UNSTREAMED.minZ + 32 - controller.position.z));
    }

    const forward = new THREE.Vector3(Math.sin(direction), 0, -Math.cos(direction));
    controller.update(FRAME_DT, { forward: 1, right: 0, sprint, jump }, forward);
    if (label === "contract") colliders.processPendingRebuilds(1); // the off-frame driver tick

    const { x, y, z } = controller.position;
    // Inset the hole rect: rim triangles from adjacent kept cells reach up to half a grid
    // cell + capsule radius inside it, and standing there is legitimate rim ground.
    const holeInterior = {
      minX: CAVE_HOLE.minX + PAGE_GRID_STEP_M, minZ: CAVE_HOLE.minZ + PAGE_GRID_STEP_M,
      maxX: CAVE_HOLE.maxX - PAGE_GRID_STEP_M, maxZ: CAVE_HOLE.maxZ - PAGE_GRID_STEP_M,
    };
    if (inRect(x, z, holeInterior) && controller.grounded) {
      const surface = baseSurfaceHeight(x, z);
      if (Math.abs(y - surface) < 1.5) fakeFloorFramesInCave++; // standing on the invented floor
      if (y < surface - CAVE_FLOOR_DEPTH_M + 2) caveFloorReached = true;
    }
    if (inRect(x, z, UNSTREAMED)) {
      enteredUnstreamed = true;
      if (controller.grounded) fakeFloorFramesUnstreamed++;
    }

    if (traceSink && frame % 600 === 0) {
      traceSink.push(
        `[trace ${label}] t=${t.toFixed(0)}s pos=(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) `
        + `grounded=${controller.grounded} sync=${gameplayDiagnostics.get("collider_sync_frame_builds")} `
        + `builds=${gameplayDiagnostics.get("collider_build_count")} queued=${gameplayDiagnostics.get("collider_jobs_queued")} `
        + `barrier=${gameplayDiagnostics.get("frontier_barrier_engagements")} covMiss=${gameplayDiagnostics.get("collider_coverage_missing")}`,
      );
    }
  }

  const result: BaselineRunResult = {
    label,
    simSeconds,
    wallClockMs: performance.now() - startedAt,
    counters: gameplayDiagnostics.snapshot(),
    digs,
    teleports,
    jumps,
    fakeFloorFramesInCave,
    fakeFloorFramesUnstreamed,
    caveFloorReached,
    enteredUnstreamed,
    finalPosition: [controller.position.x, controller.position.y, controller.position.z],
  };

  colliders.dispose();
  clearDigEdits();
  setVoxelOverlayResidentBounds("baseline-cave", null);
  setVoxelOverlayResidentBounds("baseline-unstreamed", null);
  resetGameplayDiagnosticsForTests();
  return result;
}
