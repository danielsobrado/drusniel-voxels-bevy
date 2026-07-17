import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
import { ConstructionStabilityRuntime } from "./construction_stability_runtime.js";
import { ConstructionSupportGraph } from "./construction_support_graph.js";
import type {
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  PlacedConstructionPiece,
} from "./types.js";

const FLOOR: ConstructionPieceDef = {
  id: "floor", label: "Floor", category: "floor", dimensionsM: [2, 0.2, 2],
  canGround: true, material: "wood", snapPoints: [],
};
const PIECES_BY_ID = new Map([[FLOOR.id, FLOOR]]);
const CONFIG: ConstructionStabilityConfig = {
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 8,
  connectionToleranceM: 0.08,
  verticalConnectionMinRatio: 0.55,
};

function bridge(): { pieces: PlacedConstructionPiece[]; graph: ConstructionSupportGraph; runtime: ConstructionStabilityRuntime } {
  const pieces: PlacedConstructionPiece[] = [
    { id: "left", typeId: "floor", position: [0, 0, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: ["mid-left"] },
    { id: "mid-left", typeId: "floor", position: [2, 0, 0], rotationQuarterTurns: 0, grounded: false, connectionIds: ["left", "center"] },
    { id: "center", typeId: "floor", position: [4, 0, 0], rotationQuarterTurns: 0, grounded: false, connectionIds: ["mid-left", "mid-right"] },
    { id: "mid-right", typeId: "floor", position: [6, 0, 0], rotationQuarterTurns: 0, grounded: false, connectionIds: ["center", "right"] },
    { id: "right", typeId: "floor", position: [8, 0, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: ["mid-right"] },
  ];
  const graph = new ConstructionSupportGraph();
  graph.rebuild(pieces);
  const runtime = new ConstructionStabilityRuntime(graph, PIECES_BY_ID, DEFAULT_CONSTRUCTION_SUPPORT_PROFILES, CONFIG);
  runtime.markAllDirty(pieces);
  runtime.recompute(pieces);
  return { pieces, graph, runtime };
}

function removePiece(
  pieces: PlacedConstructionPiece[],
  graph: ConstructionSupportGraph,
  id: string,
) {
  const disconnectedNeighborIds = graph.removeNode(id);
  const index = pieces.findIndex((piece) => piece.id === id);
  if (index >= 0) pieces.splice(index, 1);
  return { removed: index >= 0, disconnectedNeighborIds };
}

describe("construction stability runtime", () => {
  it("keeps a two-support bridge standing after one support is removed", () => {
    const { pieces, graph, runtime } = bridge();
    expect(pieces.find((piece) => piece.id === "center")!.stability).toBeCloseTo(0.8);

    const removal = removePiece(pieces, graph, "left");
    runtime.markDirtyMany(removal.disconnectedNeighborIds);
    const result = runtime.recompute(pieces);

    expect(result.islands).toBe(1);
    expect(pieces.find((piece) => piece.id === "center")!.stability).toBeCloseTo(0.8);
    expect(runtime.pendingCollapseCount()).toBe(0);
  });

  it("marks an unsupported island without deleting it", () => {
    const { pieces, graph, runtime } = bridge();
    for (const id of ["left", "right"]) {
      const removal = removePiece(pieces, graph, id);
      runtime.markDirtyMany(removal.disconnectedNeighborIds);
      runtime.recompute(pieces);
    }

    expect(pieces).toHaveLength(3);
    expect(pieces.every((piece) => piece.unsupported === true)).toBe(true);
    expect(runtime.pendingCollapseCount()).toBe(0);

    const step = runtime.processPendingCollapses(pieces, (id) => removePiece(pieces, graph, id));
    expect(step).toEqual({ collapsedIds: [], recomputes: 0 });
    expect(pieces).toHaveLength(3);
  });

  it("does not touch an unrelated island", () => {
    const { pieces, graph, runtime } = bridge();
    pieces.push({
      id: "remote", typeId: "floor", position: [100, 0, 100], rotationQuarterTurns: 0,
      grounded: true, connectionIds: [], stability: 0.73,
    });
    graph.addNode("remote");
    const removal = removePiece(pieces, graph, "left");
    runtime.markDirtyMany(removal.disconnectedNeighborIds);
    const result = runtime.recompute(pieces);
    expect(result.largestIsland).toBe(4);
    expect(pieces.find((piece) => piece.id === "remote")!.stability).toBe(0.73);
  });

  it("caps oversized islands without replacing their previous values", () => {
    const pieces: PlacedConstructionPiece[] = Array.from({ length: 5 }, (_, index) => ({
      id: `piece-${index}`,
      typeId: "floor",
      position: [index * 2, 0, 0],
      rotationQuarterTurns: 0,
      grounded: index === 0,
      connectionIds: index === 0 ? ["piece-1"] : index === 4 ? ["piece-3"] : [`piece-${index - 1}`, `piece-${index + 1}`],
      stability: 0.42,
    }));
    const graph = new ConstructionSupportGraph();
    graph.rebuild(pieces);
    const runtime = new ConstructionStabilityRuntime(graph, PIECES_BY_ID, DEFAULT_CONSTRUCTION_SUPPORT_PROFILES, {
      ...CONFIG,
      maxIslandSize: 4,
    });
    runtime.markDirty("piece-0");
    const result = runtime.recompute(pieces);
    expect(result.capHits).toBe(1);
    expect(pieces.every((piece) => piece.stability === 0.42)).toBe(true);
  });
});
