import { describe, expect, it } from "vitest";
import { ConstructionStabilityRuntime } from "./construction_stability_runtime.js";
import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  ConstructionSupportProfile,
  PlacedConstructionPiece,
} from "./types.js";

const wood: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.06, horizontalDecay: 0.10, supportClass: "wood" };
const stone: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.10, horizontalDecay: 0.18, supportClass: "stone" };
const metal: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.03, horizontalDecay: 0.05, supportClass: "ground" };
const profiles = { wood, brick: stone, concrete: stone, marble: stone, tiles: stone, stone, metal, thatch: { ...wood, verticalDecay: 1, horizontalDecay: 1 } } satisfies Record<ConstructionMaterial, ConstructionSupportProfile>;
const config: ConstructionStabilityConfig = {
  enabled: true,
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 16,
  collapseDelayMs: 20,
  connectionToleranceM: 0.08,
  materialProfiles: profiles,
};
const definition: ConstructionPieceDef = {
  id: "piece",
  label: "Piece",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};
const definitions = new Map([[definition.id, definition]]);

function runtimeFor(pieces: PlacedConstructionPiece[]): ConstructionStabilityRuntime {
  const runtime = new ConstructionStabilityRuntime(config, definitions, pieces);
  runtime.rebuild();
  runtime.recomputeDirty(0);
  return runtime;
}

describe("ConstructionStabilityRuntime", () => {
  it("keeps a two-support bridge standing after one support is removed", () => {
    const pieces: PlacedConstructionPiece[] = [
      { id: "left", typeId: "piece", position: [0, 0, 0], rotationQuarterTurns: 0, material: "metal", grounded: true, connectionIds: ["bridge"] },
      { id: "bridge", typeId: "piece", position: [2, 0, 0], rotationQuarterTurns: 0, material: "wood", grounded: false, connectionIds: ["left", "right"] },
      { id: "right", typeId: "piece", position: [4, 0, 0], rotationQuarterTurns: 0, material: "metal", grounded: true, connectionIds: ["bridge"] },
    ];
    const runtime = runtimeFor(pieces);
    expect(pieces.find((piece) => piece.id === "bridge")?.stability).toBe(1);

    runtime.removePiece("left");
    pieces.splice(pieces.findIndex((piece) => piece.id === "left"), 1);
    runtime.recomputeDirty(1);

    expect(pieces.find((piece) => piece.id === "bridge")?.stability).toBe(1);
    expect(runtime.takeReadyCollapseIds(100)).toEqual([]);
  });

  it("degrades a horizontal wood cantilever progressively", () => {
    const pieces: PlacedConstructionPiece[] = Array.from({ length: 5 }, (_, index) => ({
      id: `p${index}`,
      typeId: "piece",
      position: [index * 2, 0, 0] as const,
      rotationQuarterTurns: 0,
      material: "wood" as const,
      grounded: index === 0,
      connectionIds: [index > 0 ? `p${index - 1}` : "", index < 4 ? `p${index + 1}` : ""].filter(Boolean),
    }));
    runtimeFor(pieces);
    expect(pieces.map((piece) => piece.stability)).toEqual([1, 0.9, 0.8, 0.7, 0.6]);
  });

  it("recomputes only the marked connected island", () => {
    const pieces: PlacedConstructionPiece[] = [
      { id: "a", typeId: "piece", position: [0, 0, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: ["b"] },
      { id: "b", typeId: "piece", position: [2, 0, 0], rotationQuarterTurns: 0, connectionIds: ["a"] },
      { id: "remote", typeId: "piece", position: [100, 0, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: [] },
    ];
    const runtime = runtimeFor(pieces);
    runtime.graph.markDirty("a");
    runtime.recomputeDirty(1);
    expect(runtime.stats().islands).toBe(1);
    expect(runtime.stats().largestIsland).toBe(2);
  });

  it("rebuilds deterministic stability values from persisted connections", () => {
    const source: PlacedConstructionPiece[] = [
      { id: "a", typeId: "piece", position: [0, 0, 0], rotationQuarterTurns: 0, grounded: true, connectionIds: ["b"] },
      { id: "b", typeId: "piece", position: [2, 0, 0], rotationQuarterTurns: 0, connectionIds: ["a", "c"] },
      { id: "c", typeId: "piece", position: [4, 0, 0], rotationQuarterTurns: 0, connectionIds: ["b"] },
    ];
    runtimeFor(source);
    const expected = source.map((piece) => piece.stability);
    const restored = JSON.parse(JSON.stringify(source)) as PlacedConstructionPiece[];
    for (const piece of restored) delete piece.stability;
    runtimeFor(restored);
    expect(restored.map((piece) => piece.stability)).toEqual(expected);
  });
});
