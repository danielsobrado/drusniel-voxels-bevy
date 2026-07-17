import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
import { resolveConstructionPlacementSupport } from "./support_state.js";
import type {
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  PlacedConstructionPiece,
} from "./types.js";

const stabilityConfig: ConstructionStabilityConfig = {
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 8,
  connectionToleranceM: 0.08,
  verticalConnectionMinRatio: 0.55,
};
const floor: ConstructionPieceDef = {
  id: "floor", label: "Floor", category: "floor", dimensionsM: [2, 0.2, 2],
  canGround: true, material: "wood", snapPoints: [],
};
const wall: ConstructionPieceDef = {
  id: "wall", label: "Wall", category: "wall", dimensionsM: [2, 2, 0.2],
  canGround: false, material: "wood", snapPoints: [],
};
const piecesById = new Map([[floor.id, floor], [wall.id, wall]]);
const groundedFloor: PlacedConstructionPiece = {
  id: "floor-1",
  typeId: "floor",
  position: [10, 5, 10],
  rotationQuarterTurns: 0,
  grounded: true,
  connectionIds: [],
  stability: 1,
};

function resolve(input: {
  snapped: boolean;
  terrainGrounded: boolean;
  connectionIds?: readonly string[];
  piece?: ConstructionPieceDef;
  placedPieces?: readonly PlacedConstructionPiece[];
}) {
  const piece = input.piece ?? wall;
  return resolveConstructionPlacementSupport({
    snapped: input.snapped,
    terrainGrounded: input.terrainGrounded,
    connectionIds: input.connectionIds ?? [],
    position: piece === floor ? [10, 5, 10] : [12, 5, 10],
    piece,
    material: "wood",
    placedPieces: input.placedPieces ?? [],
    piecesById,
    supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
    stabilityConfig,
  });
}

describe("construction support state", () => {
  it("grounds free terrain placements", () => {
    const support = resolve({ snapped: false, terrainGrounded: true, piece: floor });
    expect(support.supported).toBe(true);
    expect(support.grounded).toBe(true);
    expect(support.stabilityValue).toBe(1);
    expect(support.connectionIds).toEqual([]);
  });

  it("predicts support from a connected grounded piece", () => {
    const support = resolve({
      snapped: true,
      terrainGrounded: false,
      connectionIds: ["floor-1"],
      placedPieces: [groundedFloor],
    });
    expect(support.supported).toBe(true);
    expect(support.grounded).toBe(false);
    expect(support.connectionIds).toEqual(["floor-1"]);
    expect(support.stabilityValue).toBeCloseTo(0.9);
  });

  it("uses the best of multiple independent supports", () => {
    const weak: PlacedConstructionPiece = {
      id: "weak", typeId: "wall", position: [11, 5, 10], rotationQuarterTurns: 0,
      grounded: false, connectionIds: ["floor-1"], stability: 0.3,
    };
    const support = resolve({
      snapped: true,
      terrainGrounded: false,
      connectionIds: ["weak", "floor-1"],
      placedPieces: [groundedFloor, weak],
    });
    expect(support.supported).toBe(true);
    expect(support.stabilityValue).toBeCloseTo(0.9);
  });

  it("rejects connections below the collapse threshold", () => {
    const unstable: PlacedConstructionPiece = {
      id: "unstable", typeId: "wall", position: [11, 5, 10], rotationQuarterTurns: 0,
      grounded: false, connectionIds: [], stability: 0.15,
    };
    const support = resolve({
      snapped: true,
      terrainGrounded: false,
      connectionIds: ["unstable"],
      placedPieces: [unstable],
    });
    expect(support.supported).toBe(false);
    expect(support.reason).toBe("insufficient stability");
  });

  it("rejects snapped placement without a graph edge", () => {
    const support = resolve({ snapped: true, terrainGrounded: false });
    expect(support.supported).toBe(false);
    expect(support.reason).toBe("missing support");
  });
});
