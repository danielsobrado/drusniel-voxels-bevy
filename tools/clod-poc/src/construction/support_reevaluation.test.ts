import { describe, expect, it } from "vitest";
import { reevaluateConstructionSupport } from "./support_reevaluation.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const FLOOR: ConstructionPieceDef = {
  id: "floor", label: "Floor", category: "floor", dimensionsM: [2, 0.2, 2],
  canGround: true, material: "wood", snapPoints: [],
};
const WALL: ConstructionPieceDef = {
  id: "wall", label: "Wall", category: "wall", dimensionsM: [2, 2, 0.2],
  canGround: false, material: "wood", snapPoints: [],
};
const PIECES_BY_ID = new Map<string, ConstructionPieceDef>([["floor", FLOOR], ["wall", WALL]]);
const WIDE_AABB = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

function groundedFloor(id: string, x: number, z: number): PlacedConstructionPiece {
  return {
    id, typeId: "floor", position: [x, 10.1, z], rotationQuarterTurns: 0,
    grounded: true, connectionIds: [], stability: 1,
  };
}

function connectedWall(id: string, connectionId: string, x: number, z: number): PlacedConstructionPiece {
  return {
    id, typeId: "wall", position: [x, 11.2, z], rotationQuarterTurns: 0,
    grounded: false, connectionIds: [connectionId], stability: 0.94,
  };
}

describe("construction ground support re-evaluation", () => {
  it("keeps a grounded piece unchanged while the probe stays solid", () => {
    const result = reevaluateConstructionSupport({
      pieces: [groundedFloor("piece-1", 0, 0)],
      piecesById: PIECES_BY_ID,
      aabb: WIDE_AABB,
      groundSolidAt: () => true,
    });
    expect(result.changed).toBe(false);
    expect(result.groundedLost).toEqual([]);
    expect(result.dirtyIds).toEqual([]);
  });

  it("dirties only the grounded root after terrain is removed", () => {
    const pieces = [
      groundedFloor("piece-1", 0, 0),
      connectedWall("piece-2", "piece-1", 0, -1),
      connectedWall("piece-3", "piece-2", 0, -2),
      groundedFloor("piece-4", 50, 50),
    ];
    const result = reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: () => false,
    });
    expect(result.groundedLost).toEqual(["piece-1"]);
    expect(result.dirtyIds).toEqual(["piece-1"]);
    expect(pieces[1]!.stability).toBe(0.94);
  });

  it("never probes pieces outside the edited AABB", () => {
    const probed: Array<[number, number]> = [];
    reevaluateConstructionSupport({
      pieces: [groundedFloor("piece-1", 0, 0), groundedFloor("piece-2", 60, 60)],
      piecesById: PIECES_BY_ID,
      aabb: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      groundSolidAt: (x, _y, z) => {
        probed.push([x, z]);
        return false;
      },
    });
    expect(probed.every(([x, z]) => Math.abs(x) < 5 && Math.abs(z) < 5)).toBe(true);
  });

  it("restores an unconnected groundable piece when terrain returns", () => {
    const pieces: PlacedConstructionPiece[] = [{
      ...groundedFloor("piece-1", 0, 0),
      grounded: false,
      stability: 0,
      unsupported: true,
    }];
    const result = reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: WIDE_AABB,
      groundSolidAt: () => true,
    });
    expect(result.groundedRestored).toEqual(["piece-1"]);
    expect(result.dirtyIds).toEqual(["piece-1"]);
  });

  it("does not restore non-groundable pieces", () => {
    const pieces: PlacedConstructionPiece[] = [{
      id: "piece-1", typeId: "wall", position: [0, 11, 0], rotationQuarterTurns: 0,
      grounded: false, connectionIds: [], stability: 0, unsupported: true,
    }];
    const result = reevaluateConstructionSupport({
      pieces,
      piecesById: PIECES_BY_ID,
      aabb: WIDE_AABB,
      groundSolidAt: () => true,
    });
    expect(result.groundedRestored).toEqual([]);
  });

  it("samples below the piece base", () => {
    let sampledY: number | null = null;
    reevaluateConstructionSupport({
      pieces: [groundedFloor("piece-1", 0, 0)],
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
