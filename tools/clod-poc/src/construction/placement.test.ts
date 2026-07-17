import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
import {
  createConstructionCandidate,
  createFreePlacementPosition,
  validateConstructionPlacement,
} from "./placement.js";
import { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
import type {
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionSnapResult,
  ConstructionStabilityConfig,
  PlacedConstructionPiece,
} from "./types.js";

const placementConfig: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 1,
  overlapPaddingM: 0.04,
  storageKey: "test-construction",
};
const stabilityConfig: ConstructionStabilityConfig = {
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 8,
  connectionToleranceM: 0.08,
  verticalConnectionMinRatio: 0.55,
};
const unboundedPlacementConfig: ConstructionPlacementConfig = { ...placementConfig, unboundedWorld: true };

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

function terrainHit(position: readonly [number, number, number]) {
  return {
    point: [position[0], 0, position[2]] as const,
    normal: [0, 1, 0] as const,
    distanceM: 1,
    surfaceType: "terrain" as const,
  };
}

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
    connectionIds?: readonly string[];
    config?: ConstructionPlacementConfig;
  } = {},
): { valid: boolean; reason: string | null } {
  const snapped = options.snapped ?? false;
  return validateConstructionPlacement({
    piece,
    material: piece.material,
    position,
    rotationQuarterTurns: options.rotationQuarterTurns ?? 0,
    snapped,
    snap: options.snap ?? null,
    connectionIds: options.connectionIds ?? [],
    terrainHit: piece.canGround && !snapped ? terrainHit(position) : null,
    placedPieces: options.placedPieces ?? [],
    piecesById,
    worldCells: 16,
    config: options.config ?? placementConfig,
    stabilityConfig,
    supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
  });
}

function validateSaved(
  placed: PlacedConstructionPiece,
  placedPieces: readonly PlacedConstructionPiece[] = [],
  allowLegacySupportMetadata = false,
  config: ConstructionPlacementConfig = placementConfig,
) {
  const piece = piecesById.get(placed.typeId)!;
  return validateStrictPersistedConstructionPlacement({
    piece,
    placed,
    placedPieces,
    piecesById,
    worldCells: 16,
    config,
    allowLegacySupportMetadata,
  });
}

describe("construction placement", () => {
  it("places grounded pieces on top of terrain", () => {
    expect(createFreePlacementPosition(floor, { ...terrainHit([4, 0, 5]), point: [4, 3, 5], distanceM: 10 })).toEqual([4, 3.1, 5]);
  });

  it("rejects pieces outside finite world bounds", () => {
    expect(validateLive(floor, [0.5, 1, 8])).toEqual({ valid: false, reason: "outside world" });
  });

  it("accepts live pieces outside finite bounds in unbounded mode", () => {
    expect(validateLive(floor, [-512, 1, 2048], { config: unboundedPlacementConfig })).toEqual({ valid: true, reason: null });
  });

  it("rejects invalid world dimensions", () => {
    expect(validateConstructionPlacement({
      piece: floor,
      material: "wood",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      snapped: false,
      snap: null,
      connectionIds: [],
      terrainHit: terrainHit([8, 1, 8]),
      placedPieces: [],
      piecesById: new Map([[floor.id, floor]]),
      worldCells: 0,
      config: placementConfig,
      stabilityConfig,
      supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
    })).toEqual({ valid: false, reason: "invalid position" });
  });

  it("rejects non-ground pieces without snap", () => {
    expect(validateLive(wall, [8, 2, 8])).toEqual({ valid: false, reason: "snap required" });
  });

  it("rejects snapped placement without graph connections", () => {
    expect(validateLive(wall, [8, 2, 8], { snapped: true })).toEqual({ valid: false, reason: "missing support" });
  });

  it("rejects duplicate overlapping placements", () => {
    const placed: PlacedConstructionPiece = {
      id: "piece-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      connectionIds: [],
      stability: 1,
    };
    expect(validateLive(floor, [8, 1, 8], { placedPieces: [placed] })).toEqual({ valid: false, reason: "overlap" });
  });

  it("keeps rotation and predicted stability in the candidate", () => {
    const parent: PlacedConstructionPiece = {
      id: "floor-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
      grounded: true,
      connectionIds: [],
      stability: 1,
    };
    const candidate = createConstructionCandidate({
      piece: wall,
      material: "wood",
      position: [12, 2, 8],
      rotationQuarterTurns: 3,
      snapped: true,
      snap: snapTo("floor-1"),
      connectionIds: ["floor-1"],
      terrainHit: null,
      placedPieces: [parent],
      piecesById,
      worldCells: 16,
      config: placementConfig,
      stabilityConfig,
      supportProfiles: DEFAULT_CONSTRUCTION_SUPPORT_PROFILES,
    });
    expect(candidate.valid).toBe(true);
    expect(candidate.rotationQuarterTurns).toBe(3);
    expect(candidate.stabilityValue).toBeCloseTo(0.9);
  });

  it("accepts saved pieces connected to a loaded graph neighbor", () => {
    const parent: PlacedConstructionPiece = {
      id: "floor-1", typeId: "floor", position: [8, 1, 8], rotationQuarterTurns: 0,
      grounded: true, connectionIds: [], stability: 1,
    };
    expect(validateSaved({
      id: "wall-1", typeId: "wall", position: [12, 2, 8], rotationQuarterTurns: 1,
      grounded: false, connectionIds: ["floor-1"], stability: 0.9,
    }, [parent]).valid).toBe(true);
  });

  it("allows child-before-parent loading through pending retries", () => {
    const child: PlacedConstructionPiece = {
      id: "wall-1", typeId: "wall", position: [12, 2, 8], rotationQuarterTurns: 1,
      grounded: false, connectionIds: ["floor-1"], stability: 0.9,
    };
    const parent: PlacedConstructionPiece = {
      id: "floor-1", typeId: "floor", position: [8, 1, 8], rotationQuarterTurns: 0,
      grounded: true, connectionIds: [], stability: 1,
    };
    const pending = [child, parent];
    const loaded: PlacedConstructionPiece[] = [];
    let madeProgress = true;
    while (pending.length > 0 && madeProgress) {
      madeProgress = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        if (!validateSaved(candidate, loaded).valid) continue;
        pending.splice(index, 1);
        loaded.push(candidate);
        madeProgress = true;
      }
    }
    expect(loaded.map((piece) => piece.id)).toEqual(["floor-1", "wall-1"]);
    expect(pending).toEqual([]);
  });

  it("rejects saved pieces whose connections are missing", () => {
    expect(validateSaved({
      id: "wall-1", typeId: "wall", position: [12, 2, 8], rotationQuarterTurns: 1,
      grounded: false, connectionIds: ["missing-floor"],
    })).toEqual({ valid: false, reason: "unsupported" });
  });

  it("rejects non-ground pieces forged as grounded", () => {
    expect(validateSaved({
      id: "wall-1", typeId: "wall", position: [12, 2, 8], rotationQuarterTurns: 1,
      grounded: true, connectionIds: [],
    })).toEqual({ valid: false, reason: "invalid support" });
  });

  it("keeps legacy migration explicit", () => {
    const legacy = { id: "legacy-floor", typeId: "floor", position: [12, 2, 8], rotationQuarterTurns: 1 } as const;
    expect(validateSaved(legacy)).toEqual({ valid: false, reason: "missing support" });
    expect(validateSaved(legacy, [], true).valid).toBe(true);
  });
});
