import { describe, expect, it } from "vitest";
import { defaultConstructionConfig } from "./config.js";
import { ConstructionSnapIndex, constructionSnapMath } from "./snap_index.js";
import type { ConstructionPieceDef, ConstructionSnapResult } from "./types.js";

const REQUIRED_STARTER_KIT_IDS = [
  "wood-floor-2x2",
  "wood-floor-1x1",
  "wood-floor-half",
  "wood-wall-2x2",
  "wood-wall-half",
  "wood-door-frame-2x2",
  "wood-window-wall-2x2",
  "wood-pillar-1m",
  "wood-pillar-2m",
  "wood-pillar-4m",
  "wood-beam-1m",
  "wood-beam-2m",
  "wood-beam-4m",
  "wood-diagonal-beam-2m",
  "wood-stairs-2x2",
  "wood-ladder-2m",
  "wood-roof-26",
  "wood-roof-45",
  "wood-roof-ridge-2m",
  "wood-roof-corner-outside-45",
  "wood-roof-corner-inside-45",
  "concrete-foundation-2x2",
  "wood-fence-2x1",
  "wood-gate-2x1",
] as const;

function piece(id: string): ConstructionPieceDef {
  const found = defaultConstructionConfig.pieces.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing starter-kit piece ${id}`);
  return found;
}

function snapTo(
  index: ConstructionSnapIndex,
  source: ConstructionPieceDef,
  cursor: readonly [number, number, number],
): ConstructionSnapResult {
  const candidates = [0, 1, 2, 3]
    .map((rotation) => index.findBestSnap(cursor, source, rotation, defaultConstructionConfig.snap))
    .filter((result): result is ConstructionSnapResult => result !== null)
    .sort((left, right) => right.score - left.score || left.rotationQuarterTurns - right.rotationQuarterTurns);
  const result = candidates[0];
  if (!result) throw new Error(`No snap found for ${source.id} at ${cursor.join(",")}`);
  return result;
}

describe("construction Phase 3 starter kit", () => {
  it("contains the complete coherent starter catalog", () => {
    const ids = new Set(defaultConstructionConfig.pieces.map((entry) => entry.id));
    for (const id of REQUIRED_STARTER_KIT_IDS) expect(ids.has(id)).toBe(true);
    expect(ids.size).toBe(REQUIRED_STARTER_KIT_IDS.length);
  });

  it("keeps render geometry separate from placement proxies for open and compound pieces", () => {
    for (const id of [
      "wood-door-frame-2x2",
      "wood-window-wall-2x2",
      "wood-diagonal-beam-2m",
      "wood-ladder-2m",
      "wood-roof-ridge-2m",
      "wood-roof-corner-outside-45",
      "wood-roof-corner-inside-45",
      "wood-gate-2x1",
    ]) {
      const definition = piece(id);
      expect(definition.geometryParts?.length).toBeGreaterThan(0);
      expect(definition.placementBoxes?.length).toBeGreaterThan(0);
      expect(definition.geometryParts).not.toBe(definition.placementBoxes);
    }
  });

  it("builds a cabin snap chain without free-placement correction", () => {
    const index = new ConstructionSnapIndex(defaultConstructionConfig.snap.spatialCellM);
    const floor = piece("wood-floor-2x2");
    const wall = piece("wood-wall-2x2");
    const roof = piece("wood-roof-45");
    const ridge = piece("wood-roof-ridge-2m");

    index.addPiece(floor, "floor", [0, 0, 0], 0);
    const wallSnap = snapTo(index, wall, [1, 0.1, 0]);
    expect(wallSnap.target.entityId).toBe("floor");
    index.addPiece(wall, "wall", wallSnap.worldPosition, wallSnap.rotationQuarterTurns);

    const roofSnap = snapTo(index, roof, [wallSnap.worldPosition[0], wallSnap.worldPosition[1] + 1, wallSnap.worldPosition[2]]);
    expect(roofSnap.target.entityId).toBe("wall");
    index.addPiece(roof, "roof", roofSnap.worldPosition, roofSnap.rotationQuarterTurns);

    const roofRidgeSnapPoint = roof.snapPoints.find((entry) => entry.id === "ridge")!;
    const ridgeOffset = constructionSnapMath.rotateYQuarter(
      roofRidgeSnapPoint.localPos,
      roofSnap.rotationQuarterTurns,
    );
    const ridgeCursor: readonly [number, number, number] = [
      roofSnap.worldPosition[0] + ridgeOffset[0],
      roofSnap.worldPosition[1] + ridgeOffset[1],
      roofSnap.worldPosition[2] + ridgeOffset[2],
    ];
    const ridgeSnap = snapTo(index, ridge, ridgeCursor);
    expect(ridgeSnap.target.entityId).toBe("roof");
  });

  it("builds a bridge deck and a three-storey tower from snap results", () => {
    const index = new ConstructionSnapIndex(defaultConstructionConfig.snap.spatialCellM);
    const foundation = piece("concrete-foundation-2x2");
    const pillar = piece("wood-pillar-2m");
    const beam = piece("wood-beam-4m");
    const floor = piece("wood-floor-2x2");
    const wall = piece("wood-wall-2x2");

    index.addPiece(foundation, "foundation", [0, 0, 0], 0);
    const pillarSnap = snapTo(index, pillar, [1, 0.5, 0]);
    expect(pillarSnap.target.entityId).toBe("foundation");
    index.addPiece(pillar, "pillar", pillarSnap.worldPosition, pillarSnap.rotationQuarterTurns);

    const beamCursor: readonly [number, number, number] = [
      pillarSnap.worldPosition[0],
      pillarSnap.worldPosition[1] + 1,
      pillarSnap.worldPosition[2],
    ];
    const beamSnap = snapTo(index, beam, beamCursor);
    expect(beamSnap.target.entityId).toBe("pillar");
    index.addPiece(beam, "bridge-beam", beamSnap.worldPosition, beamSnap.rotationQuarterTurns);
    const beamDeck = beam.snapPoints.find((entry) => entry.id === "deck")!;
    const deckOffset = constructionSnapMath.rotateYQuarter(beamDeck.localPos, beamSnap.rotationQuarterTurns);
    const deckCursor: readonly [number, number, number] = [
      beamSnap.worldPosition[0] + deckOffset[0],
      beamSnap.worldPosition[1] + deckOffset[1],
      beamSnap.worldPosition[2] + deckOffset[2],
    ];
    const bridgeFloor = snapTo(index, floor, deckCursor);
    expect(bridgeFloor.target.entityId).toBe("bridge-beam");

    index.clear();
    let floorPosition: readonly [number, number, number] = [0, 0, 0];
    let floorRotation = 0;
    index.addPiece(floor, "tower-floor-0", floorPosition, floorRotation);
    for (let storey = 1; storey <= 3; storey += 1) {
      const edge = floor.snapPoints.find((entry) => entry.id === "edge-east")!;
      const edgeOffset = constructionSnapMath.rotateYQuarter(edge.localPos, floorRotation);
      const wallCursor: readonly [number, number, number] = [
        floorPosition[0] + edgeOffset[0],
        floorPosition[1] + edgeOffset[1],
        floorPosition[2] + edgeOffset[2],
      ];
      const wallSnap = snapTo(index, wall, wallCursor);
      const wallId = `tower-wall-${storey}`;
      index.addPiece(wall, wallId, wallSnap.worldPosition, wallSnap.rotationQuarterTurns);
      const wallTop = wall.snapPoints.find((entry) => entry.id === "top")!;
      const wallTopOffset = constructionSnapMath.rotateYQuarter(wallTop.localPos, wallSnap.rotationQuarterTurns);
      const floorCursor: readonly [number, number, number] = [
        wallSnap.worldPosition[0] + wallTopOffset[0],
        wallSnap.worldPosition[1] + wallTopOffset[1],
        wallSnap.worldPosition[2] + wallTopOffset[2],
      ];
      const upperFloor = snapTo(index, floor, floorCursor);
      expect(upperFloor.worldPosition[1]).toBeGreaterThan(floorPosition[1]);
      floorPosition = upperFloor.worldPosition;
      floorRotation = upperFloor.rotationQuarterTurns;
      index.addPiece(floor, `tower-floor-${storey}`, floorPosition, floorRotation);
    }
  });
});
