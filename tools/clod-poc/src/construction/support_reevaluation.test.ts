// Playable-world-contract P4: digging terrain out from under a supported piece updates
// support state through the parent chain; raising it back restores. Pure re-evaluation
// over the authoritative ground probe — collapse stays deferred (no piece is removed).
import { describe, expect, it } from "vitest";
import { reevaluateConstructionSupport } from "./support_reevaluation.js";
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

function groundedFloor(id: string, x: number, z: number): PlacedConstructionPiece {
  return { id, typeId: "floor", position: [x, 10.1, z], rotationQuarterTurns: 0, grounded: true, parentIds: [] };
}

function snappedWall(id: string, parentId: string, x: number, z: number): PlacedConstructionPiece {
  return { id, typeId: "wall", position: [x, 11.2, z], rotationQuarterTurns: 0, grounded: false, parentIds: [parentId] };
}

const WIDE_AABB = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const SOLID = () => true;
const AIR = () => false;

describe("construction support re-evaluation", () => {
  it("keeps a grounded piece supported while the ground probe stays solid", () => {
    const pieces = [groundedFloor("piece-1", 0, 0)];
    const result = reevaluateConstructionSupport({ pieces, piecesById: PIECES_BY_ID, aabb: WIDE_AABB, groundSolidAt: SOLID });
    expect(result.changed).toBe(false);
    expect(result.groundedLost).toEqual([]);
    expect(result.unsupportedIds.size).toBe(0);
  });

  it("digging under a grounded piece marks it and its dependent chain unsupported", () => {
    const pieces = [
      groundedFloor("piece-1", 0, 0),
      snappedWall("piece-2", "piece-1", 0, -1),
      snappedWall("piece-3", "piece-2", 0, -2),
      groundedFloor("piece-4", 50, 50), // untouched structure elsewhere
    ];
    const result = reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: AIR,
    });
    expect(result.changed).toBe(true);
    expect(result.groundedLost).toEqual(["piece-1"]);
    expect([...result.unsupportedIds].sort()).toEqual(["piece-1", "piece-2", "piece-3"]);
    expect(result.unsupportedIds.has("piece-4")).toBe(false);
  });

  it("never probes pieces outside the edited AABB", () => {
    const probed: Array<[number, number]> = [];
    const pieces = [groundedFloor("piece-1", 0, 0), groundedFloor("piece-2", 60, 60)];
    reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: (x, _y, z) => {
        probed.push([x, z]);
        return false;
      },
    });
    expect(probed.every(([x, z]) => Math.abs(x) < 5 && Math.abs(z) < 5)).toBe(true);
  });

  it("restores a ground-lost piece and its chain when terrain is raised back", () => {
    const pieces: PlacedConstructionPiece[] = [
      { ...groundedFloor("piece-1", 0, 0), grounded: false, unsupported: true },
      { ...snappedWall("piece-2", "piece-1", 0, -1), unsupported: true },
    ];
    const result = reevaluateConstructionSupport({ pieces, piecesById: PIECES_BY_ID, aabb: WIDE_AABB, groundSolidAt: SOLID });
    expect(result.changed).toBe(true);
    expect(result.groundedRestored).toEqual(["piece-1"]);
    expect(result.unsupportedIds.size).toBe(0);
  });

  it("does not ground-restore a piece whose definition cannot ground", () => {
    const pieces: PlacedConstructionPiece[] = [
      { id: "piece-1", typeId: "wall", position: [0, 11, 0], rotationQuarterTurns: 0, grounded: false, parentIds: [], unsupported: true },
    ];
    const result = reevaluateConstructionSupport({ pieces, piecesById: PIECES_BY_ID, aabb: WIDE_AABB, groundSolidAt: SOLID });
    expect(result.groundedRestored).toEqual([]);
    expect(result.unsupportedIds.has("piece-1")).toBe(true);
  });

  it("samples below the piece base, not at the piece itself", () => {
    let sampledY: number | null = null;
    const pieces = [groundedFloor("piece-1", 0, 0)]; // base at y = 10
    reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: WIDE_AABB,
      groundSolidAt: (_x, y) => {
        sampledY = y;
        return true;
      },
    });
    expect(sampledY).not.toBeNull();
    expect(sampledY!).toBeLessThan(10);
    expect(sampledY!).toBeGreaterThan(9);
  });
});
