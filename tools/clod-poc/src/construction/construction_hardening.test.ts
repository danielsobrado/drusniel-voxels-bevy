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
  id: "floor", label: "Floor", category: "floor", dimensionsM: [2, 0.2, 2],
  canGround: true, material: "wood", snapPoints: [],
};
const WALL: ConstructionPieceDef = {
  id: "wall", label: "Wall", category: "wall", dimensionsM: [2, 2, 0.2],
  canGround: false, material: "wood", snapPoints: [],
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

function createStore(colliderSet: ConstructionColliderSet | null): ConstructionPieceStore {
  return new ConstructionPieceStore(
    new THREE.Group(),
    PIECES_BY_ID,
    new ConstructionSnapIndex(1),
    new ConstructionOverlapIndex(4),
    colliderSet,
    () => new THREE.MeshStandardMaterial(),
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

describe("construction collider hardening", () => {
  it("a wall blocks the player and removal clears the collider atomically", () => {
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

    store.add({
      id: "piece-1", typeId: "wall", position: [0, 1, -4], rotationQuarterTurns: 0,
      grounded: false, connectionIds: [], stability: 0,
    }, false);
    for (let i = 0; i < 480; i++) player.update(STEP, WALK, FORWARD);
    expect(player.position.z).toBeGreaterThan(-3.9);

    const removal = store.removeOne("piece-1");
    expect(removal.removedCount).toBe(1);
    expect(colliderSet.activeCount()).toBe(0);
    for (let i = 0; i < 480; i++) player.update(STEP, WALK, FORWARD);
    expect(player.position.z).toBeLessThan(-5);
    terrain.dispose();
  });

  it("the player stands on a placed floor", () => {
    const terrain = new TerrainColliderSet([
      { id: "ground", geometry: plane(200, 0), footprint: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } },
    ]);
    terrain.prewarmAll();
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    store.add({
      id: "piece-1", typeId: "floor", position: [0, 0.5, 0], rotationQuarterTurns: 0,
      grounded: true, connectionIds: [], stability: 1,
    }, false);
    const player = new PlayerController(terrain, BOUNDS);
    player.attachConstructionColliders(colliderSet);
    player.attachMovementReadiness(() => "ready");
    player.spawn(new THREE.Vector3(0, 3, 0));
    for (let i = 0; i < 240; i++) player.update(STEP, IDLE, FORWARD);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeCloseTo(0.6, 1);
    terrain.dispose();
  });
});

describe("graph-atomic removal", () => {
  it("removes only the selected piece and reports disconnected neighbors", () => {
    const colliderSet = new ConstructionColliderSet();
    const store = createStore(colliderSet);
    store.add({
      id: "piece-1", typeId: "floor", position: [10, 0.1, 10], rotationQuarterTurns: 0,
      grounded: true, connectionIds: [], stability: 1,
    }, false);
    store.add({
      id: "piece-2", typeId: "wall", position: [10, 1.2, 10], rotationQuarterTurns: 0,
      grounded: false, connectionIds: ["piece-1"], stability: 0.94,
    }, false);

    const removal = store.removeOne("piece-1");
    expect(removal.removedCount).toBe(1);
    expect(removal.disconnectedNeighborIds).toEqual(["piece-2"]);
    expect(store.pieces.map((piece) => piece.id)).toEqual(["piece-2"]);
    expect(colliderSet.activeCount()).toBe(1);
  });
});

describe("terrain support invalidation", () => {
  it("returns dirty roots without performing global structural propagation", () => {
    const pieces: PlacedConstructionPiece[] = [
      { id: "floor-1", typeId: "floor", position: [0, 10.1, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: [], stability: 1 },
      { id: "wall-1", typeId: "wall", position: [0, 11.2, 0], rotationQuarterTurns: 0, grounded: false, connectionIds: ["floor-1"], stability: 0.94 },
    ];
    const result = reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: () => false,
    });
    expect(result.groundedLost).toEqual(["floor-1"]);
    expect(result.dirtyIds).toEqual(["floor-1"]);
    expect(pieces[1]!.stability).toBe(0.94);
  });
});

describe("construction save migration", () => {
  it("round-trips connection IDs and rewrites legacy parent IDs", () => {
    stubLocalStorage();
    localStorage.setItem(PLACEMENT.storageKey, JSON.stringify([
      { id: "piece-1", typeId: "floor", position: [10, 0.1, 10], rotationQuarterTurns: 0, grounded: true, parentIds: [], stability: 1 },
      { id: "piece-2", typeId: "wall", position: [10, 1.2, 10], rotationQuarterTurns: 0, grounded: false, parentIds: ["piece-1"], stability: 0.94 },
    ]));
    const store = createStore(new ConstructionColliderSet());
    const loadResult = loadConstructionPieces({
      storageKey: PLACEMENT.storageKey,
      piecesById: PIECES_BY_ID,
      placedPieces: store.pieces,
      worldCells: 1000,
      placement: PLACEMENT,
      addPiece: (piece) => store.add(piece, false),
    });
    expect(loadResult.rewritten).toBe(true);
    expect(store.pieces).toHaveLength(2);
    expect(store.pieces[1]!.connectionIds).toEqual(["piece-1"]);
    saveConstructionPieces(PLACEMENT.storageKey, store.pieces);
    const saved = JSON.parse(localStorage.getItem(PLACEMENT.storageKey)!) as Record<string, unknown>[];
    expect(saved[1]!.connectionIds).toEqual(["piece-1"]);
    expect(saved[1]!.parentIds).toBeUndefined();
  });
});
