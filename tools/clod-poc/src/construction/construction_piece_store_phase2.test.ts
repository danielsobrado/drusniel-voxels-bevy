import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef } from "./types.js";

const piece: ConstructionPieceDef = {
  id: "piece",
  label: "Piece",
  category: "floor",
  dimensionsM: [1, 1, 1],
  canGround: true,
  material: "wood",
  snapPoints: [],
};

describe("ConstructionPieceStore Phase 2 removal", () => {
  it("removes deleted IDs from persisted connection metadata", () => {
    const store = new ConstructionPieceStore(
      new THREE.Group(),
      new Map([[piece.id, piece]]),
      new ConstructionSnapIndex(1),
      new ConstructionOverlapIndex(4),
      null,
      () => new THREE.MeshStandardMaterial(),
    );
    store.add({
      id: "support",
      typeId: piece.id,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      grounded: true,
      connectionIds: ["span"],
      stability: 1,
    }, false);
    store.add({
      id: "span",
      typeId: piece.id,
      position: [1, 0, 0],
      rotationQuarterTurns: 0,
      grounded: false,
      connectionIds: ["support"],
      parentIds: ["support"],
      stability: 0.9,
    }, false);

    const removal = store.removeOne("support");

    expect(removal.disconnectedNeighborIds).toEqual(["span"]);
    expect(store.pieces[0]?.connectionIds).toEqual([]);
    expect(store.pieces[0]?.parentIds).toEqual([]);
    expect(store.graph.neighbors("span")).toEqual([]);
    store.dispose();
  });
});
