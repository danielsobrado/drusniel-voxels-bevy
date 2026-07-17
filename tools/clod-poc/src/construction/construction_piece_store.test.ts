import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ConstructionColliderSet } from "./construction_collider.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const FLOOR: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};

function placed(id: string, x: number): PlacedConstructionPiece {
  return {
    id,
    typeId: FLOOR.id,
    position: [x, 0.1, 0],
    rotationQuarterTurns: 0,
    grounded: true,
    parentIds: [],
  };
}

function createStore() {
  const root = new THREE.Group();
  const snapIndex = new ConstructionSnapIndex(1);
  const overlapIndex = new ConstructionOverlapIndex(4);
  const colliderSet = new ConstructionColliderSet();
  const store = new ConstructionPieceStore(
    root,
    new Map([[FLOOR.id, FLOOR]]),
    snapIndex,
    overlapIndex,
    colliderSet,
    () => new THREE.MeshStandardMaterial(),
  );
  return { root, snapIndex, overlapIndex, colliderSet, store };
}

describe("ConstructionPieceStore", () => {
  it("rejects duplicate entity ids without splitting visual and collision state", () => {
    const { root, overlapIndex, colliderSet, store } = createStore();

    expect(store.add(placed("piece-1", 0), false)).toBe(true);
    expect(store.add(placed("piece-1", 20), false)).toBe(false);

    expect(store.pieces).toHaveLength(1);
    expect(store.meshes).toHaveLength(1);
    expect(root.children).toHaveLength(1);
    expect(overlapIndex.size()).toBe(1);
    expect(colliderSet.activeCount()).toBe(1);
    expect(store.pieces[0]!.position[0]).toBe(0);

    store.dispose();
  });

  it("owns a snapshot of caller-provided placement state", () => {
    const { store } = createStore();
    const input = placed("piece-1", 4);

    expect(store.add(input, false)).toBe(true);
    (input.position as [number, number, number])[0] = 99;
    (input.parentIds as string[]).push("external-parent");

    expect(store.pieces[0]!.position[0]).toBe(4);
    expect(store.pieces[0]!.parentIds).toEqual([]);

    store.dispose();
  });

  it("includes visible construction in shadow and receiver workloads", () => {
    const { store } = createStore();
    expect(store.add(placed("piece-1", 0), false)).toBe(true);

    expect(store.meshes[0]!.castShadow).toBe(true);
    expect(store.meshes[0]!.receiveShadow).toBe(true);

    store.dispose();
  });

  it("removes owned meshes, indexes, and colliders on dispose", () => {
    const { root, snapIndex, overlapIndex, colliderSet, store } = createStore();
    expect(store.add(placed("piece-1", 0), false)).toBe(true);
    expect(overlapIndex.size()).toBe(1);

    store.dispose();

    expect(root.children).toHaveLength(0);
    expect(store.pieces).toHaveLength(0);
    expect(store.meshes).toHaveLength(0);
    expect(snapIndex.size()).toBe(0);
    expect(overlapIndex.size()).toBe(0);
    expect(colliderSet.activeCount()).toBe(0);
  });
});
