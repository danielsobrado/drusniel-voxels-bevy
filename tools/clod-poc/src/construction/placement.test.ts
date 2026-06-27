import { describe, expect, it } from "vitest";
import {
  createConstructionCandidate,
  createFreePlacementPosition,
  validateConstructionPlacement,
} from "./placement.js";
import { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, ConstructionSnapResult, PlacedConstructionPiece } from "./types.js";

const placementConfig: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 1,
  overlapPaddingM: 0.04,
  storageKey: "test-construction",
};

const floor: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};

const wall: ConstructionPieceDef = {
  id: "wall",
  label: "Wall",
  category: "wall",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [],
};

const piecesById = new Map<string, ConstructionPieceDef>([[floor.id, floor], [wall.id, wall]]);

function snapTo(entityId: string): ConstructionSnapResult {
  return {
    target: {
      entityId,
      pieceTypeId: "floor",
      snapIndex: 0,
      worldPos: [0, 0, 0],
      worldDirection: [1, 0, 0],
      group: "floor-edge",
      accepts: ["wall-bottom"],
    },
    sourceSnapIndex: 0,
    worldPosition: [12, 2, 8],
    rotationQuarterTurns: 3,
    score: 1,
  };
}

function validateLive(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  options: {
    placedPieces?: readonly PlacedConstructionPiece[];
    rotationQuarterTurns?: number;
    snapped?: boolean;
    snap?: ConstructionSnapResult | null;
  } = {},
): { valid: boolean; reason: string | null } {
  const snapped = options.snapped ?? false;
  return validateConstructionPlacement({
    piece,
    position,
    rotationQuarterTurns: options.rotationQuarterTurns ?? 0,
    snapped,
    snap: options.snap ?? null,
    terrainHit: piece.canGround && !snapped ? { point: [position[0], 0, position[2]], distanceM: 1 } : null,
    placedPieces: options.placedPieces ?? [],
    piecesById,
    worldCells: 16,
    config: placementConfig,
  });
}

function validateSaved(
  placed: PlacedConstructionPiece,
  placedPieces: readonly PlacedConstructionPiece[] = [],
  allowLegacySupportMetadata = false,
) {
  const piece = piecesById.get(placed.typeId)!;
  return validateStrictPersistedConstructionPlacement({
    piece,
    placed,
    placedPieces,
    piecesById,
    worldCells: 16,
    config: placementConfig,
    allowLegacySupportMetadata,
  });
}

describe("construction placement", () => {
  it("places grounded pieces on top of terrain", () => {
    expect(createFreePlacementPosition(floor, { point: [4, 3, 5], distanceM: 10 })).toEqual([4, 3.1, 5]);
  });

  it("rejects pieces that extend outside the world even when their center is inside", () => {
    expect(validateLive(floor, [0.5, 1, 8])).toEqual({ valid: false, reason: "outside world" });
  });

  it("rejects invalid world dimensions", () => {
    const result = validateConstructionPlacement({
      piece: floor,
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      snapped: false,
      snap: null,
      terrainHit: { point: [8, 0, 8], distanceM: 1 },
      placedPieces: [],
      piecesById: new Map([[floor.id, floor]]),
      worldCells: 0,
      config: placementConfig,
    });

    expect(result).toEqual({ valid: false, reason: "invalid position" });
  });

  it("rejects non-ground pieces without snap", () => {
    expect(validateLive(wall, [8, 2, 8])).toEqual({ valid: false, reason: "snap required" });
  });

  it("rejects snapped placement without a snap payload", () => {
    expect(validateLive(wall, [8, 2, 8], { snapped: true })).toEqual({ valid: false, reason: "missing support" });
  });

  it("rejects duplicate overlapping placements", () => {
    const placed: PlacedConstructionPiece = {
      id: "piece-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      parentIds: [],
    };

    expect(validateLive(floor, [8, 1, 8], { placedPieces: [placed] })).toEqual({ valid: false, reason: "overlap" });
  });

  it("keeps candidate rotation from the validated input", () => {
    const parent: PlacedConstructionPiece = {
      id: "floor-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      parentIds: [],
    };
    const candidate = createConstructionCandidate({
      piece: wall,
      position: [12, 2, 8],
      rotationQuarterTurns: 3,
      snapped: true,
      snap: snapTo("floor-1"),
      terrainHit: null,
      placedPieces: [parent],
      piecesById,
      worldCells: 16,
      config: placementConfig,
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.rotationQuarterTurns).toBe(3);
  });

  it("accepts saved pieces connected to a supported parent", () => {
    const parent: PlacedConstructionPiece = {
      id: "floor-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      parentIds: [],
    };

    const result = validateSaved({
      id: "wall-1",
      typeId: "wall",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
      grounded: false,
      parentIds: ["floor-1"],
    }, [parent]);

    expect(result.valid).toBe(true);
  });

  it("allows child-before-parent loading when the loader retries pending pieces", () => {
    const child: PlacedConstructionPiece = {
      id: "wall-1",
      typeId: "wall",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
      grounded: false,
      parentIds: ["floor-1"],
    };
    const parent: PlacedConstructionPiece = {
      id: "floor-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      parentIds: [],
    };
    const pending = [child, parent];
    const loaded: PlacedConstructionPiece[] = [];

    let madeProgress = true;
    while (pending.length > 0 && madeProgress) {
      madeProgress = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        const result = validateSaved(candidate, loaded);
        if (!result.valid) continue;
        pending.splice(index, 1);
        loaded.push(candidate);
        madeProgress = true;
      }
    }

    expect(loaded.map((piece) => piece.id)).toEqual(["floor-1", "wall-1"]);
    expect(pending).toEqual([]);
  });

  it("rejects saved pieces whose parent chain is missing", () => {
    const result = validateSaved({
      id: "wall-1",
      typeId: "wall",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
      grounded: false,
      parentIds: ["missing-floor"],
    });

    expect(result).toEqual({ valid: false, reason: "unsupported" });
  });

  it("rejects saved non-ground pieces forged as grounded", () => {
    const result = validateSaved({
      id: "wall-1",
      typeId: "wall",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
      grounded: true,
      parentIds: [],
    });

    expect(result).toEqual({ valid: false, reason: "invalid support" });
  });

  it("rejects old saved pieces without support metadata by default", () => {
    const result = validateSaved({
      id: "legacy-floor",
      typeId: "floor",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
    });

    expect(result).toEqual({ valid: false, reason: "missing support" });
  });

  it("keeps old saved ground pieces loadable only during explicit legacy migration", () => {
    const result = validateSaved({
      id: "legacy-floor",
      typeId: "floor",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
    }, [], true);

    expect(result.valid).toBe(true);
  });

  it("rejects old saved non-ground pieces even during explicit legacy migration", () => {
    const result = validateSaved({
      id: "legacy-wall",
      typeId: "wall",
      position: [12, 2, 8],
      rotationQuarterTurns: 1,
    }, [], true);

    expect(result).toEqual({ valid: false, reason: "invalid support" });
  });
});
