// Playable-world-contract P4: construction hardened under streaming and edits.
// - placed pieces are solid for the player (no ghost walls) and stay solid when marked
//   unsupported (collapse deferred = marked-not-passable);
// - removal is atomic across visual, collider, snap index, overlap index, persistence;
// - placement at a collider page border mid-rebuild neither duplicates nor loses pieces;
// - a 30-piece structure round-trips save→load with SEMANTIC equivalence, including
//   support state after digging under part of it.
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_CONFIG, PlayerController } from "../player_controller.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { ConstructionColliderSet } from "./construction_collider.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { loadConstructionPieces, saveConstructionPieces } from "./construction_persistence.js";
import { reevaluateConstructionSupport } from "./support_reevaluation.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

const STEP = DEFAULT_PLAYER_CONFIG.fixedStep;
const FORWARD = new THREE.Vector3(0, 0, -1);
const IDLE = { forward: 0, right: 0, sprint: false, jump: false };
const WALK = { forward: 1, right: 0, sprint: false, jump: false };
const BOUNDS = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };

const FLOOR: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};

const WALL: ConstructionPieceDef = {
  id: "wall",
  label: "Wall",
  category: "wall",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [],
};

const PIECES_BY_ID = new Map<string, ConstructionPieceDef>([["floor", FLOOR], ["wall", WALL]]);
const PLACEMENT: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 0.5,
  overlapPaddingM: 0.05,
  storageKey: "construction-hardening-test",
};

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function testMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial();
}

function createStore(colliderSet: ConstructionColliderSet | null): ConstructionPieceStore {
  return new ConstructionPieceStore(
    new THREE.Group(),
    PIECES_BY_ID,
    new ConstructionSnapIndex(1),
    new ConstructionOverlapIndex(4),
    colliderSet,
    testMaterial,
  );
}

let restoreLocalStorage: (() => void) | null = null;

function stubLocalStorage(): void {
  const map = new Map<string, string>();
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
  };
  restoreLocalStorage = () => {
    if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = original;
  };
}

afterEach(() => {
  restoreLocalStorage?.();
  restoreLocalStorage = null;
});

describe("construction colliders vs the player capsule", () => {
  it("a placed wall stops the walking player; removing it opens the path (no ghost wall either way)", () => {
    const terrain = new TerrainColliderSet([
      { id: "ground", geometry: plane(200, 0), footprint: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } },
    ]);
    terrain.prewarmAll();
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    const player = new PlayerController(terrain, BOUNDS);
    player.attachConstructionColliders(colliderSet);
    player.attachMovementReadiness(() => "ready");
    player.spawn(new THREE.Vector3(0, 0.1, 0));

    const wall: PlacedConstructionPiece = {
      id: "piece-1", typeId: "wall", position: [0, 1, -4], rotationQuarterTurns: 0,
      grounded: false, parentIds: [],
    };
    expect(store.add(wall, false)).toBe(true);
    expect(colliderSet.activeCount()).toBe(1);

    for (let i = 0; i < 480; i++) player.update(STEP, WALK, FORWARD); // 4 s at 120 Hz
    // Wall face is at z = -3.9; the capsule surface stops against it.
    expect(player.position.z).toBeGreaterThan(-3.9);
    expect(player.position.z).toBeLessThan(-2.5); // it actually reached the wall

    store.removeByIds(new Set(["piece-1"]));
    expect(colliderSet.activeCount()).toBe(0);
    for (let i = 0; i < 480; i++) player.update(STEP, WALK, FORWARD);
    expect(player.position.z).toBeLessThan(-5); // path open after removal
    terrain.dispose();
  });

  it("the player stands on a placed floor piece (grounded on construction)", () => {
    const terrain = new TerrainColliderSet([
      { id: "ground", geometry: plane(200, 0), footprint: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } },
    ]);
    terrain.prewarmAll();
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    store.add({ id: "piece-1", typeId: "floor", position: [0, 0.5, 0], rotationQuarterTurns: 0, grounded: true, parentIds: [] }, false);

    const player = new PlayerController(terrain, BOUNDS);
    player.attachConstructionColliders(colliderSet);
    player.attachMovementReadiness(() => "ready");
    player.spawn(new THREE.Vector3(0, 3, 0));
    for (let i = 0; i < 240; i++) player.update(STEP, IDLE, FORWARD);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeCloseTo(0.6, 1); // floor top, not the terrain below
    terrain.dispose();
  });

  it("an unsupported piece stays solid exactly where it is drawn and is visibly marked", () => {
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    const floor: PlacedConstructionPiece = {
      id: "piece-1", typeId: "floor", position: [0, 10.1, 0], rotationQuarterTurns: 0,
      grounded: true, parentIds: [], material: "wood",
    };
    const wall: PlacedConstructionPiece = {
      id: "piece-2", typeId: "wall", position: [0, 11.2, 0], rotationQuarterTurns: 0,
      grounded: false, parentIds: ["piece-1"], material: "wood",
    };
    store.add(floor, false);
    store.add(wall, false);

    const result = reevaluateConstructionSupport({
      pieces: store.pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: () => false, // the dig removed everything under the floor
    });
    expect(result.changed).toBe(true);
    store.applySupportState(result.groundedLost, result.groundedRestored, result.unsupportedIds);

    expect(store.pieces[0]!.grounded).toBe(false);
    expect(store.pieces[0]!.unsupported).toBe(true);
    expect(store.pieces[1]!.unsupported).toBe(true);
    expect(store.isMarkedUnsupported("piece-1")).toBe(true);
    expect(store.isMarkedUnsupported("piece-2")).toBe(true);
    expect(store.unsupportedCount()).toBe(2);

    // Collider unchanged: the capsule still resolves against the floor top at y=10.2.
    expect(colliderSet.has("piece-1")).toBe(true);
    expect(colliderSet.has("piece-2")).toBe(true);
    const hit = colliderSet.resolveCapsule(
      new THREE.Vector3(0.6, 10.15, 0.6), // inside the floor slab, clear of the wall
      new THREE.Vector3(0, -1, 0),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(hit.position.y).toBeGreaterThan(10.15); // pushed up out of the slab
    expect(hit.grounded).toBe(true);
  });

  it("restoring terrain support clears the marking and flags", () => {
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    store.add({
      id: "piece-1", typeId: "floor", position: [0, 10.1, 0], rotationQuarterTurns: 0,
      grounded: false, parentIds: [], unsupported: true,
    }, false);
    expect(store.isMarkedUnsupported("piece-1")).toBe(true); // marked on add (load path)

    const result = reevaluateConstructionSupport({
      pieces: store.pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: () => true, // terrain raised back
    });
    store.applySupportState(result.groundedLost, result.groundedRestored, result.unsupportedIds);
    expect(store.pieces[0]!.grounded).toBe(true);
    expect(store.pieces[0]!.unsupported).toBeUndefined();
    expect(store.isMarkedUnsupported("piece-1")).toBe(false);
    expect(store.unsupportedCount()).toBe(0);
  });
});

describe("atomic removal", () => {
  it("removing a piece clears visual, collider, snap points, overlap index, and persistence in one call", () => {
    stubLocalStorage();
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    store.add({ id: "piece-1", typeId: "floor", position: [10, 0.1, 10], rotationQuarterTurns: 0, grounded: true, parentIds: [] }, false);
    store.add({ id: "piece-2", typeId: "wall", position: [10, 1.2, 10], rotationQuarterTurns: 0, grounded: false, parentIds: ["piece-1"] }, false);
    saveConstructionPieces(PLACEMENT.storageKey, store.pieces);

    const removedIds = store.collectDependentIds("piece-1");
    expect([...removedIds].sort()).toEqual(["piece-1", "piece-2"]); // dependents removed with the root
    const removed = store.removeByIds(removedIds);
    saveConstructionPieces(PLACEMENT.storageKey, store.pieces);

    expect(removed).toBe(2);
    expect(store.pieces).toHaveLength(0);
    expect(store.meshes).toHaveLength(0);
    expect(colliderSet.activeCount()).toBe(0);
    expect(store.unsupportedCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem(PLACEMENT.storageKey)!)).toEqual([]);
  });
});

describe("placement at a collider page border mid-rebuild", () => {
  it("neither duplicates nor loses the piece, and the piece is solid across the border", () => {
    const west = plane(100, 0);
    west.translate(-50, 0, 0);
    const east = plane(100, 0);
    east.translate(50, 0, 0);
    const terrain = new TerrainColliderSet([
      { id: "west", geometry: west, footprint: { minX: -100, minZ: -50, maxX: 0, maxZ: 50 } },
      { id: "east", geometry: east, footprint: { minX: 0, minZ: -50, maxX: 100, maxZ: 50 } },
    ]);
    terrain.prewarmAll();

    // A rebuild for the east page is queued but not yet processed while the player places
    // a piece straddling the page border at x = 0.
    const eastReplacement = plane(100, 0);
    eastReplacement.translate(50, 0, 0);
    expect(terrain.schedulePageUpdate("east", eastReplacement, 1)).toBe(true);

    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    const added = store.add({
      id: "piece-1", typeId: "floor", position: [0, 0.5, 0], rotationQuarterTurns: 0,
      grounded: true, parentIds: [],
    }, false);
    expect(added).toBe(true);

    expect(store.pieces).toHaveLength(1);
    expect(colliderSet.activeCount()).toBe(1);

    expect(terrain.processPendingRebuilds()).toBe(1);
    expect(store.pieces).toHaveLength(1); // the swap neither duplicated nor lost the piece
    expect(colliderSet.activeCount()).toBe(1);

    // The player walks onto the piece across the border and stands on it.
    const player = new PlayerController(terrain, BOUNDS);
    player.attachConstructionColliders(colliderSet);
    player.attachMovementReadiness(() => "ready");
    player.spawn(new THREE.Vector3(0, 2, 0));
    for (let i = 0; i < 240; i++) player.update(STEP, IDLE, FORWARD);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeCloseTo(0.6, 1);
    terrain.dispose();
  });
});

describe("semantic round-trip (save → reload)", () => {
  interface CanonicalPiece {
    id: string;
    typeId: string;
    position: number[];
    rotationQuarterTurns: number;
    material: string | null;
    grounded: boolean;
    parentIds: string[];
    unsupported: boolean;
  }

  function canonical(pieces: readonly PlacedConstructionPiece[]): CanonicalPiece[] {
    return [...pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((piece) => ({
        id: piece.id,
        typeId: piece.typeId,
        position: piece.position.map((value) => Number(value.toFixed(3))),
        rotationQuarterTurns: piece.rotationQuarterTurns,
        material: piece.material ?? null,
        grounded: piece.grounded === true,
        parentIds: [...(piece.parentIds ?? [])].sort(),
        unsupported: piece.unsupported === true,
      }));
  }

  it("a 30-piece structure with a dug-out section round-trips with equivalent semantic state", () => {
    stubLocalStorage();
    const store = createStore(new ConstructionColliderSet());

    // 10 towers: grounded floor + wall + stacked wall, 3 m apart.
    for (let i = 0; i < 10; i++) {
      const x = 10 + i * 3;
      store.add({ id: `piece-${i * 3 + 1}`, typeId: "floor", position: [x, 10.1, 10], rotationQuarterTurns: 0, material: "wood", grounded: true, parentIds: [] }, false);
      store.add({ id: `piece-${i * 3 + 2}`, typeId: "wall", position: [x, 11.2, 10], rotationQuarterTurns: 0, material: "stone", grounded: false, parentIds: [`piece-${i * 3 + 1}`] }, false);
      store.add({ id: `piece-${i * 3 + 3}`, typeId: "wall", position: [x, 13.2, 10], rotationQuarterTurns: 1, material: "wood", grounded: false, parentIds: [`piece-${i * 3 + 2}`] }, false);
    }
    expect(store.pieces).toHaveLength(30);

    // Dig under the first three towers (x within [9, 17]).
    const result = reevaluateConstructionSupport({
      pieces: store.pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: 9, maxX: 17.2, minZ: 8, maxZ: 12 },
      groundSolidAt: () => false,
    });
    store.applySupportState(result.groundedLost, result.groundedRestored, result.unsupportedIds);
    const unsupportedBefore = store.pieces.filter((piece) => piece.unsupported === true);
    expect(unsupportedBefore).toHaveLength(9);

    saveConstructionPieces(PLACEMENT.storageKey, store.pieces);
    const savedRaw = localStorage.getItem(PLACEMENT.storageKey)!;

    // Fresh session: a new store loads from persistence through strict validation.
    const reloaded = createStore(new ConstructionColliderSet());
    const loadResult = loadConstructionPieces({
      storageKey: PLACEMENT.storageKey,
      piecesById: PIECES_BY_ID,
      placedPieces: reloaded.pieces,
      worldCells: 1000,
      placement: PLACEMENT,
      addPiece: (piece) => reloaded.add(piece, false),
    });

    expect(reloaded.pieces).toHaveLength(30); // nothing dropped — including unsupported pieces
    expect(canonical(reloaded.pieces)).toEqual(canonical(store.pieces)); // semantic equivalence
    expect(reloaded.pieces.filter((piece) => piece.unsupported === true)).toHaveLength(9);
    expect(reloaded.unsupportedCount()).toBe(9); // visual marking restored on load
    expect(loadResult.nextEntityId).toBe(31);

    // Serialization bytes may legitimately differ (order, rewrites); semantic state may not.
    const roundTrippedRaw = localStorage.getItem(PLACEMENT.storageKey)!;
    expect(canonical(JSON.parse(roundTrippedRaw) as PlacedConstructionPiece[])).toEqual(canonical(JSON.parse(savedRaw) as PlacedConstructionPiece[]));
  });
});
