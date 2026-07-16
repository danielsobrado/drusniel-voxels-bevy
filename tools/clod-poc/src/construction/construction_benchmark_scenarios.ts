import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

export type ConstructionBenchmarkScenarioId =
  | "small-cabin"
  | "cantilever-balcony"
  | "supported-bridge"
  | "tall-tower"
  | "sloped-roof-corners"
  | "uneven-terrain-foundation"
  | "settlement-10k";

export interface ConstructionBenchmarkScenario {
  id: ConstructionBenchmarkScenarioId;
  pieces: readonly PlacedConstructionPiece[];
  candidatePieceId: string;
  candidatePosition: readonly [number, number, number];
  rayOrigin: readonly [number, number, number];
  rayDirection: readonly [number, number, number];
  rayDistanceM: number;
}

const floor: ConstructionPieceDef = {
  id: "bench-floor",
  label: "Benchmark Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [
    { id: "east", localPos: [1, 0.1, 0], direction: [1, 0, 0], group: "floor-edge", accepts: ["floor-edge", "wall-bottom"] },
    { id: "west", localPos: [-1, 0.1, 0], direction: [-1, 0, 0], group: "floor-edge", accepts: ["floor-edge", "wall-bottom"] },
  ],
};

const wall: ConstructionPieceDef = {
  id: "bench-wall",
  label: "Benchmark Wall",
  category: "wall",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [
    { id: "bottom", localPos: [0, -1, 0], direction: [0, -1, 0], group: "wall-bottom", accepts: ["floor-edge", "wall-top"] },
    { id: "top", localPos: [0, 1, 0], direction: [0, 1, 0], group: "wall-top", accepts: ["wall-bottom", "roof-edge"] },
  ],
};

const pillar: ConstructionPieceDef = {
  id: "bench-pillar",
  label: "Benchmark Pillar",
  category: "pillar",
  dimensionsM: [0.4, 2, 0.4],
  canGround: true,
  material: "wood",
  snapPoints: [
    { id: "top", localPos: [0, 1, 0], direction: [0, 1, 0], group: "wall-top", accepts: ["wall-bottom", "floor-edge"] },
  ],
};

const roof: ConstructionPieceDef = {
  id: "bench-roof",
  label: "Benchmark Roof Proxy",
  category: "roof",
  dimensionsM: [2, 0.3, 2],
  canGround: false,
  material: "thatch",
  snapPoints: [
    { id: "edge", localPos: [0, -0.15, 1], direction: [0, -1, 0], group: "roof-edge", accepts: ["wall-top", "roof-edge"] },
  ],
};

export function createConstructionBenchmarkCatalog(): ReadonlyMap<string, ConstructionPieceDef> {
  return new Map([floor, wall, pillar, roof].map((piece) => [piece.id, piece]));
}

function placed(
  id: string,
  typeId: string,
  x: number,
  y: number,
  z: number,
  grounded: boolean,
  parentIds: readonly string[] = [],
): PlacedConstructionPiece {
  return { id, typeId, position: [x, y, z], rotationQuarterTurns: 0, grounded, parentIds };
}

function smallCabin(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  let id = 0;
  for (let z = 0; z < 2; z += 1) {
    for (let x = 0; x < 2; x += 1) pieces.push(placed(`cabin-${id++}`, floor.id, x * 2, 0.1, z * 2, true));
  }
  for (let x = 0; x < 2; x += 1) {
    pieces.push(placed(`cabin-${id++}`, wall.id, x * 2, 1.2, -1, false, ["cabin-0"]));
    pieces.push(placed(`cabin-${id++}`, wall.id, x * 2, 1.2, 3, false, ["cabin-2"]));
  }
  pieces.push(placed(`cabin-${id++}`, roof.id, 0, 2.35, 0, false, ["cabin-4"]));
  pieces.push(placed(`cabin-${id++}`, roof.id, 2, 2.35, 2, false, ["cabin-5"]));
  return pieces;
}

function cantileverBalcony(): PlacedConstructionPiece[] {
  const pieces = [placed("cantilever-pillar", pillar.id, 0, 1, 0, true)];
  for (let index = 0; index < 12; index += 1) {
    pieces.push(placed(`cantilever-${index}`, floor.id, index * 2, 2.1, 0, false, [index === 0 ? "cantilever-pillar" : `cantilever-${index - 1}`]));
  }
  return pieces;
}

function supportedBridge(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  for (let index = 0; index < 24; index += 1) {
    if (index % 6 === 0) pieces.push(placed(`bridge-pillar-${index}`, pillar.id, index * 2, 1, 0, true));
    pieces.push(placed(`bridge-floor-${index}`, floor.id, index * 2, 2.1, 0, false, [`bridge-pillar-${index - index % 6}`]));
  }
  return pieces;
}

function tallTower(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [placed("tower-base", floor.id, 0, 0.1, 0, true)];
  for (let level = 0; level < 24; level += 1) {
    pieces.push(placed(`tower-wall-${level}`, wall.id, 0, 1.2 + level * 2, 0, false, [level === 0 ? "tower-base" : `tower-wall-${level - 1}`]));
  }
  return pieces;
}

function slopedRoofCorners(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  let id = 0;
  for (let z = 0; z < 8; z += 1) {
    for (let x = 0; x < 8; x += 1) pieces.push(placed(`roof-${id++}`, roof.id, x * 2, 8 + Math.abs(3.5 - x) * 0.5, z * 2, false, ["roof-support"]));
  }
  pieces.unshift(placed("roof-support", pillar.id, 7, 4, 7, true));
  return pieces;
}

function unevenTerrainFoundation(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  let id = 0;
  for (let z = 0; z < 12; z += 1) {
    for (let x = 0; x < 12; x += 1) {
      const y = 0.1 + ((x * 17 + z * 31) % 7) * 0.08;
      pieces.push(placed(`foundation-${id++}`, floor.id, x * 2, y, z * 2, true));
    }
  }
  return pieces;
}

function settlement10k(): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  for (let z = 0; z < 100; z += 1) {
    for (let x = 0; x < 100; x += 1) {
      const index = z * 100 + x;
      pieces.push(placed(`settlement-${index}`, floor.id, x * 4, 0.1, z * 4, true));
    }
  }
  return pieces;
}

function scenario(
  id: ConstructionBenchmarkScenarioId,
  pieces: readonly PlacedConstructionPiece[],
): ConstructionBenchmarkScenario {
  return {
    id,
    pieces,
    candidatePieceId: floor.id,
    candidatePosition: [-2, 0.1, 0],
    rayOrigin: [-4, 1.5, 0],
    rayDirection: [1, -0.1, 0],
    rayDistanceM: 20,
  };
}

export function createConstructionBenchmarkScenarios(): readonly ConstructionBenchmarkScenario[] {
  return [
    scenario("small-cabin", smallCabin()),
    scenario("cantilever-balcony", cantileverBalcony()),
    scenario("supported-bridge", supportedBridge()),
    scenario("tall-tower", tallTower()),
    scenario("sloped-roof-corners", slopedRoofCorners()),
    scenario("uneven-terrain-foundation", unevenTerrainFoundation()),
    scenario("settlement-10k", settlement10k()),
  ];
}
