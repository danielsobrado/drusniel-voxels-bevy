import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
import { ConstructionColliderSet } from "./construction_collider.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { loadConstructionPieces, saveConstructionPieces } from "./construction_persistence.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import { ConstructionStabilityRuntime } from "./construction_stability_runtime.js";
import { canonicalConstructionPieces } from "./construction_semantic.js";
import { reevaluateConstructionSupport } from "./support_reevaluation.js";
import type {
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionStabilityConfig,
  PlacedConstructionPiece,
} from "./types.js";
import { cellReadinessAt, createAppCellReadinessFeeds } from "../player/cell_readiness.js";
import {
  createEditCommand,
  validateEditCommand,
} from "../player/edit_commands.js";

const BASE_COLOR = 0x8b6b4a;
const STORAGE_KEY = "playable-world-p4-construction";
const FLOOR: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [1, 0.2, 1],
  canGround: true,
  material: "wood",
  snapPoints: [{
    id: "edge",
    localPos: [0.5, 0, 0],
    direction: [1, 0, 0],
    tangent: [0, 1, 0],
    group: "floor-edge",
    accepts: ["floor-edge"],
  }],
};
const PIECES_BY_ID = new Map([[FLOOR.id, FLOOR]]);
const STABILITY: ConstructionStabilityConfig = {
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 8,
  connectionToleranceM: 0.08,
  verticalConnectionMinRatio: 0.55,
};
const PLACEMENT: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 0.5,
  overlapPaddingM: 0.04,
  overlapSpatialCellM: 4,
  storageKey: STORAGE_KEY,
};

interface StoreFixture {
  root: THREE.Group;
  snapIndex: ConstructionSnapIndex;
  overlapIndex: ConstructionOverlapIndex;
  colliderSet: ConstructionColliderSet;
  store: ConstructionPieceStore;
}

function createStore(): StoreFixture {
  const root = new THREE.Group();
  const snapIndex = new ConstructionSnapIndex(1);
  const overlapIndex = new ConstructionOverlapIndex(4);
  const colliderSet = new ConstructionColliderSet();
  const store = new ConstructionPieceStore(
    root,
    PIECES_BY_ID,
    snapIndex,
    overlapIndex,
    colliderSet,
    () => new THREE.MeshStandardMaterial({ color: BASE_COLOR }),
  );
  return { root, snapIndex, overlapIndex, colliderSet, store };
}

function placed(
  id: string,
  position: readonly [number, number, number],
  grounded: boolean,
  connectionIds: readonly string[] = [],
): PlacedConstructionPiece {
  return {
    id,
    typeId: FLOOR.id,
    position,
    rotationQuarterTurns: 0,
    grounded,
    connectionIds,
    stability: grounded ? 1 : 0,
  };
}

function plane(size: number, centerX: number, centerZ: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(centerX, y, centerZ);
  return geometry;
}

let restoreLocalStorage: (() => void) | null = null;

function stubLocalStorage(): void {
  const values = new Map<string, string>();
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
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

describe("playable-world P4 construction hardening", () => {
  it("marks terrain-unsupported pieces while preserving visible geometry and colliders", () => {
    const fixture = createStore();
    fixture.store.add(placed("foundation", [10, 0.1, 10], true, ["span"]), false);
    fixture.store.add(placed("span", [12, 0.1, 10], false, ["foundation"]), false);
    const runtime = new ConstructionStabilityRuntime(
      fixture.store.graph,
      PIECES_BY_ID,
      DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
      STABILITY,
    );
    runtime.markAllDirty(fixture.store.pieces);
    runtime.recompute(fixture.store.pieces);
    const baseColor = (fixture.store.meshes[0]!.material as THREE.MeshStandardMaterial).color.getHex();

    const support = reevaluateConstructionSupport({
      pieces: fixture.store.pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: 8, maxX: 14, minZ: 8, maxZ: 12 },
      groundSolidAt: () => false,
    });
    for (const piece of fixture.store.pieces) {
      if (support.groundedLost.includes(piece.id)) piece.grounded = false;
      if (support.groundedRestored.includes(piece.id)) piece.grounded = true;
    }
    runtime.markDirtyMany(support.dirtyIds);
    const recompute = runtime.recompute(fixture.store.pieces);
    fixture.store.refreshStabilityVisuals(recompute.changedIds);

    expect(fixture.store.pieces.every((piece) => piece.unsupported === true)).toBe(true);
    expect(fixture.store.meshes).toHaveLength(2);
    expect(fixture.root.children).toHaveLength(2);
    expect(fixture.colliderSet.activeCount()).toBe(2);
    expect(fixture.colliderSet.has("foundation")).toBe(true);
    expect(fixture.colliderSet.has("span")).toBe(true);
    expect(runtime.pendingCollapseCount()).toBe(0);
    expect((fixture.store.meshes[0]!.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(baseColor);

    const collapse = runtime.processPendingCollapses(fixture.store.pieces, () => {
      throw new Error("deferred collapse must not remove construction");
    });
    expect(collapse.collapsedIds).toEqual([]);
    expect(fixture.store.pieces).toHaveLength(2);
    fixture.store.dispose();
  });

  it("removes visual, collider, snap, overlap, graph, and persisted state together", () => {
    stubLocalStorage();
    const fixture = createStore();
    fixture.store.add(placed("support", [10, 0.1, 10], true, ["span"]), false);
    fixture.store.add(placed("span", [12, 0.1, 10], false, ["support"]), false);
    saveConstructionPieces(STORAGE_KEY, fixture.store.pieces);

    const removal = fixture.store.removeOne("support");
    saveConstructionPieces(STORAGE_KEY, fixture.store.pieces);

    expect(removal.removedIds).toEqual(["support"]);
    expect(fixture.store.pieces.map((piece) => piece.id)).toEqual(["span"]);
    expect(fixture.store.meshes).toHaveLength(1);
    expect(fixture.root.children).toHaveLength(1);
    expect(fixture.snapIndex.size()).toBe(1);
    expect(fixture.overlapIndex.size()).toBe(1);
    expect(fixture.colliderSet.has("support")).toBe(false);
    expect(fixture.colliderSet.has("span")).toBe(true);
    expect(fixture.store.graph.hasNode("support")).toBe(false);
    expect(fixture.store.graph.neighbors("span")).toEqual([]);
    expect(fixture.store.pieces[0]!.connectionIds).toEqual([]);

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as PlacedConstructionPiece[];
    expect(saved.map((piece) => piece.id)).toEqual(["span"]);
    expect(saved[0]!.connectionIds).toEqual([]);
    fixture.store.dispose();
  });

  it("round-trips thirty pieces by semantic state", () => {
    stubLocalStorage();
    const source = createStore();
    for (let index = 0; index < 30; index += 1) {
      const unsupported = index < 5;
      const x = 10 + (index % 6) * 2;
      const z = 10 + Math.floor(index / 6) * 2;
      source.store.add({
        ...placed(`piece-${index}`, [x, 0.1, z], !unsupported),
        material: index % 2 === 0 ? "wood" : "stone",
        stability: unsupported ? 0 : 1,
        ...(unsupported ? { unsupported: true } : {}),
      }, false);
    }
    saveConstructionPieces(STORAGE_KEY, source.store.pieces);
    const expected = canonicalConstructionPieces(source.store.pieces);

    const restored = createStore();
    const load = loadConstructionPieces({
      storageKey: STORAGE_KEY,
      piecesById: PIECES_BY_ID,
      placedPieces: restored.store.pieces,
      worldCells: 1000,
      placement: PLACEMENT,
      addPiece: (piece) => restored.store.add(piece, false),
    });

    expect(load.rewritten).toBe(false);
    expect(restored.store.pieces).toHaveLength(30);
    expect(canonicalConstructionPieces(restored.store.pieces)).toEqual(expected);
    expect(restored.colliderSet.activeCount()).toBe(30);
    expect(restored.snapIndex.size()).toBe(30);
    expect(restored.overlapIndex.size()).toBe(30);
    source.store.dispose();
    restored.store.dispose();
  });

  it("dig-under → save → reload preserves unsupported semantic state", () => {
    stubLocalStorage();
    const source = createStore();
    for (let index = 0; index < 30; index += 1) {
      const x = 10 + (index % 6) * 2;
      const z = 10 + Math.floor(index / 6) * 2;
      source.store.add(placed(`piece-${index}`, [x, 0.1, z], true, index > 0 ? [`piece-${index - 1}`] : []), false);
    }
    const runtime = new ConstructionStabilityRuntime(
      source.store.graph,
      PIECES_BY_ID,
      DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
      STABILITY,
    );
    runtime.markAllDirty(source.store.pieces);
    runtime.recompute(source.store.pieces);

    const support = reevaluateConstructionSupport({
      pieces: source.store.pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 },
      groundSolidAt: () => false,
    });
    for (const piece of source.store.pieces) {
      if (support.groundedLost.includes(piece.id)) piece.grounded = false;
      if (support.groundedRestored.includes(piece.id)) piece.grounded = true;
    }
    runtime.markDirtyMany(support.dirtyIds);
    runtime.recompute(source.store.pieces);
    expect(source.store.pieces.some((piece) => piece.unsupported === true)).toBe(true);
    saveConstructionPieces(STORAGE_KEY, source.store.pieces);
    const expected = canonicalConstructionPieces(source.store.pieces);

    const restored = createStore();
    loadConstructionPieces({
      storageKey: STORAGE_KEY,
      piecesById: PIECES_BY_ID,
      placedPieces: restored.store.pieces,
      worldCells: 1000,
      placement: PLACEMENT,
      addPiece: (piece) => restored.store.add(piece, false),
    });
    expect(canonicalConstructionPieces(restored.store.pieces)).toEqual(expected);
    expect(restored.store.pieces.filter((piece) => piece.unsupported === true).length)
      .toBe(expected.filter((piece) => piece.unsupported).length);
    expect(restored.colliderSet.activeCount()).toBe(30);
    source.store.dispose();
    restored.store.dispose();
  });

  it("keeps one committed piece while a boundary collider replacement is pending", () => {
    stubLocalStorage();
    const terrain = new TerrainColliderSet([{
      id: "page",
      geometry: plane(128, 64, 32, 0),
      footprint: { minX: 0, minZ: -32, maxX: 128, maxZ: 96 },
    }]);
    terrain.prewarmAll();
    terrain.schedulePageUpdate("page", plane(128, 64, 32, 1), 1);
    expect(terrain.colliderStatusAt(64, 32).replacementPending).toBe(true);

    const fixture = createStore();
    const borderPiece = placed("border-piece", [64, 1.1, 32], true);
    expect(fixture.store.add(borderPiece, false)).toBe(true);
    expect(fixture.store.add(borderPiece, false)).toBe(false);
    saveConstructionPieces(STORAGE_KEY, fixture.store.pieces);

    terrain.processPendingRebuilds();

    expect(terrain.colliderStatusAt(64, 32)).toEqual({ covered: true, revision: 1, replacementPending: false });
    expect(fixture.store.pieces).toHaveLength(1);
    expect(fixture.store.meshes).toHaveLength(1);
    expect(fixture.colliderSet.activeCount()).toBe(1);
    expect(fixture.snapIndex.size()).toBe(1);
    expect(fixture.overlapIndex.size()).toBe(1);
    expect((JSON.parse(localStorage.getItem(STORAGE_KEY)!) as PlacedConstructionPiece[])).toHaveLength(1);
    fixture.store.dispose();
    terrain.dispose();
  });

  it("denies construction place while a covering collider page is mid-rebuild", () => {
    const terrain = new TerrainColliderSet([{
      id: "page",
      geometry: plane(128, 64, 32, 0),
      footprint: { minX: 0, minZ: -32, maxX: 128, maxZ: 96 },
    }]);
    terrain.prewarmAll();
    terrain.schedulePageUpdate("page", plane(128, 64, 32, 1), 1);
    const feeds = createAppCellReadinessFeeds({ terrainColliders: terrain });
    expect(cellReadinessAt(feeds, 64, 32).constructionReady).toBe(false);

    const ghost = createEditCommand({
      operation: "construction_place",
      targetPosition: [64, 1.1, 32],
      targetNormal: [0, 1, 0],
      sourceTerrainRevision: 0,
      actor: "player",
      mode: "construction",
      nowMs: 0,
    });
    expect(validateEditCommand(ghost, {
      nowMs: 10,
      currentTerrainRevision: 0,
      actorPosition: { x: 64, z: 32 },
      maxDistanceM: 80,
      currentMode: "construction",
      targetReady: cellReadinessAt(feeds, 64, 32).constructionReady,
    })).toEqual({ allowed: false, reason: "not_ready" });

    terrain.processPendingRebuilds();
    expect(cellReadinessAt(feeds, 64, 32).constructionReady).toBe(true);
    expect(validateEditCommand(ghost, {
      nowMs: 10,
      currentTerrainRevision: 0,
      actorPosition: { x: 64, z: 32 },
      maxDistanceM: 80,
      currentMode: "construction",
      targetReady: true,
    })).toEqual({ allowed: true });
    terrain.dispose();
  });
});
