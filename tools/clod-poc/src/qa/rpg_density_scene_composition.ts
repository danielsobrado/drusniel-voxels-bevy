import type { ConstructionMaterial, PlacedConstructionPiece } from "../construction/types.js";
import type { PropInstance, PropPlacementScene } from "../props/prop_types.js";
import {
  RPG_PLAYER_BASE_CENTER,
  RPG_PLAYER_BASE_SCENE,
  RPG_VILLAGE_CENTER,
  RPG_VILLAGE_SCENE,
  isRpgDensityScene,
  rpgDensitySceneCenter,
  type RpgDensitySceneCenter,
  type RpgDensitySceneId,
} from "../scenes/rpg_density_scenes.js";

export {
  RPG_PLAYER_BASE_CENTER,
  RPG_PLAYER_BASE_SCENE,
  RPG_VILLAGE_CENTER,
  RPG_VILLAGE_SCENE,
  isRpgDensityScene,
  rpgDensitySceneCenter,
};
export type { RpgDensitySceneId };
export type RpgDensityCenter = RpgDensitySceneCenter;

export interface RpgDensityBuildingSummary {
  readonly id: string;
  readonly pieceCount: number;
}

export interface RpgDensityCompositionSummary {
  readonly sceneId: RpgDensitySceneId;
  readonly seed: number;
  readonly center: RpgDensityCenter;
  readonly buildingCount: number;
  readonly constructionPiecesTotal: number;
  readonly averagePiecesPerBuilding: number;
  readonly maxPiecesPerBuilding: number;
  readonly placedProps: number;
}

export interface RpgDensityComposition {
  readonly sceneId: RpgDensitySceneId;
  readonly seed: number;
  readonly center: RpgDensityCenter;
  readonly pieces: readonly PlacedConstructionPiece[];
  readonly propScene: PropPlacementScene;
  readonly buildings: readonly RpgDensityBuildingSummary[];
  readonly summary: RpgDensityCompositionSummary;
}

export interface BuildRpgDensityCompositionInput {
  readonly sceneId: RpgDensitySceneId;
  readonly seed: number;
  readonly surfaceHeightAt: (x: number, z: number) => number;
}

const FLOOR_ID = "wood-floor-2x2";
const WALL_ID = "wood-wall-2x2";
const FENCE_ID = "wood-fence-2x1";
const PILLAR_ID = "wood-pillar-2m";
const CELL_SIZE_M = 2;
const FLOOR_HALF_HEIGHT_M = 0.1;
const STORY_HEIGHT_M = 2.2;
const WALL_HALF_DEPTH_M = 0.1;
const PILLAR_HALF_WIDTH_M = 0.2;
const VILLAGE_BUILDING_COUNT = 40;
const VILLAGE_PROP_COUNT = 400;
const PLAYER_BASE_PROP_COUNT = 100;
const VILLAGE_GRID_SPACING_M = 28;
const PROP_ASSET_IDS = ["crate_a", "rock_large_01", "stone_ruin_wall"] as const;
const BUILDING_MATERIALS: readonly ConstructionMaterial[] = ["wood", "brick", "stone", "concrete"];
const ROOF_MATERIALS: readonly ConstructionMaterial[] = ["tiles", "thatch", "wood"];

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    const normalized = Number.isFinite(seed) ? Math.trunc(seed) : 0;
    this.state = (normalized ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))]!;
  }
}

interface BuildingInput {
  readonly id: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly terrainY: number;
  readonly widthCells: number;
  readonly depthCells: number;
  readonly stories: number;
  readonly wallMaterial: ConstructionMaterial;
  readonly roofMaterial: ConstructionMaterial;
  readonly fenceSegments: number;
}

function finiteHeight(surfaceHeightAt: (x: number, z: number) => number, x: number, z: number): number {
  const height = surfaceHeightAt(x, z);
  return Number.isFinite(height) ? height : 0;
}

function piece(
  id: string,
  typeId: string,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  material: ConstructionMaterial,
  grounded: boolean,
  connectionIds: readonly string[] = [],
): PlacedConstructionPiece {
  return {
    id,
    typeId,
    position: [position[0], position[1], position[2]],
    rotationQuarterTurns,
    material,
    grounded,
    connectionIds: [...new Set(connectionIds)].filter((connectionId) => connectionId !== id).sort(),
  };
}

function floorPieceId(buildingId: string, level: number, x: number, z: number): string {
  return `${buildingId}:floor:${level}:${x}:${z}`;
}

function wallPieceId(buildingId: string, story: number, side: string, index: number): string {
  return `${buildingId}:wall:${story}:${side}:${index}`;
}

function buildModularBuilding(input: BuildingInput): PlacedConstructionPiece[] {
  const pieces: PlacedConstructionPiece[] = [];
  const firstX = input.centerX - ((input.widthCells - 1) * CELL_SIZE_M) / 2;
  const firstZ = input.centerZ - ((input.depthCells - 1) * CELL_SIZE_M) / 2;
  const northZ = firstZ - CELL_SIZE_M / 2 - WALL_HALF_DEPTH_M;
  const southZ = firstZ + (input.depthCells - 1) * CELL_SIZE_M + CELL_SIZE_M / 2 + WALL_HALF_DEPTH_M;
  const westX = firstX - CELL_SIZE_M / 2 - WALL_HALF_DEPTH_M;
  const eastX = firstX + (input.widthCells - 1) * CELL_SIZE_M + CELL_SIZE_M / 2 + WALL_HALF_DEPTH_M;

  for (let level = 0; level <= input.stories; level++) {
    const y = input.terrainY + FLOOR_HALF_HEIGHT_M + level * STORY_HEIGHT_M;
    const material = level === input.stories ? input.roofMaterial : input.wallMaterial;
    for (let x = 0; x < input.widthCells; x++) {
      for (let z = 0; z < input.depthCells; z++) {
        const id = floorPieceId(input.id, level, x, z);
        const connections: string[] = [];
        if (x > 0) connections.push(floorPieceId(input.id, level, x - 1, z));
        if (z > 0) connections.push(floorPieceId(input.id, level, x, z - 1));
        if (level > 0) connections.push(floorPieceId(input.id, level - 1, x, z));
        pieces.push(piece(
          id,
          FLOOR_ID,
          [firstX + x * CELL_SIZE_M, y, firstZ + z * CELL_SIZE_M],
          0,
          material,
          level === 0,
          connections,
        ));
      }
    }
  }

  for (let story = 0; story < input.stories; story++) {
    const y = input.terrainY + 1.2 + story * STORY_HEIGHT_M;
    for (let x = 0; x < input.widthCells; x++) {
      pieces.push(piece(
        wallPieceId(input.id, story, "north", x),
        WALL_ID,
        [firstX + x * CELL_SIZE_M, y, northZ],
        0,
        input.wallMaterial,
        false,
        [floorPieceId(input.id, story, x, 0)],
      ));
      pieces.push(piece(
        wallPieceId(input.id, story, "south", x),
        WALL_ID,
        [firstX + x * CELL_SIZE_M, y, southZ],
        0,
        input.wallMaterial,
        false,
        [floorPieceId(input.id, story, x, input.depthCells - 1)],
      ));
    }
    for (let z = 0; z < input.depthCells; z++) {
      pieces.push(piece(
        wallPieceId(input.id, story, "west", z),
        WALL_ID,
        [westX, y, firstZ + z * CELL_SIZE_M],
        1,
        input.wallMaterial,
        false,
        [floorPieceId(input.id, story, 0, z)],
      ));
      pieces.push(piece(
        wallPieceId(input.id, story, "east", z),
        WALL_ID,
        [eastX, y, firstZ + z * CELL_SIZE_M],
        1,
        input.wallMaterial,
        false,
        [floorPieceId(input.id, story, input.widthCells - 1, z)],
      ));
    }

    const corners = [
      [westX - PILLAR_HALF_WIDTH_M, northZ - PILLAR_HALF_WIDTH_M],
      [eastX + PILLAR_HALF_WIDTH_M, northZ - PILLAR_HALF_WIDTH_M],
      [westX - PILLAR_HALF_WIDTH_M, southZ + PILLAR_HALF_WIDTH_M],
      [eastX + PILLAR_HALF_WIDTH_M, southZ + PILLAR_HALF_WIDTH_M],
    ] as const;
    for (let index = 0; index < corners.length; index++) {
      const [x, z] = corners[index]!;
      pieces.push(piece(
        `${input.id}:pillar:${story}:${index}`,
        PILLAR_ID,
        [x, y, z],
        0,
        input.wallMaterial,
        story === 0,
        story === 0 ? [] : [`${input.id}:pillar:${story - 1}:${index}`],
      ));
    }
  }

  const yardRadiusX = input.widthCells + 3;
  const yardRadiusZ = input.depthCells + 3;
  for (let index = 0; index < input.fenceSegments; index++) {
    const side = index % 4;
    const sideIndex = Math.floor(index / 4);
    const offset = (sideIndex - Math.floor(input.fenceSegments / 8)) * CELL_SIZE_M;
    const x = side < 2 ? input.centerX + offset : input.centerX + (side === 2 ? -yardRadiusX : yardRadiusX);
    const z = side < 2 ? input.centerZ + (side === 0 ? -yardRadiusZ : yardRadiusZ) : input.centerZ + offset;
    pieces.push(piece(
      `${input.id}:fence:${index}`,
      FENCE_ID,
      [x, input.terrainY + 0.5, z],
      side < 2 ? 0 : 1,
      "wood",
      true,
    ));
  }

  return pieces;
}

function villageBuildingPositions(): readonly RpgDensityCenter[] {
  const positions: RpgDensityCenter[] = [];
  for (const gridZ of [-3, -2, -1, 1, 2, 3]) {
    for (const gridX of [-4, -3, -2, -1, 1, 2, 3, 4]) {
      positions.push({
        x: RPG_VILLAGE_CENTER.x + gridX * VILLAGE_GRID_SPACING_M,
        z: RPG_VILLAGE_CENTER.z + gridZ * VILLAGE_GRID_SPACING_M,
      });
    }
  }
  return positions.slice(0, VILLAGE_BUILDING_COUNT);
}

function buildVillagePieces(
  rng: SeededRandom,
  surfaceHeightAt: (x: number, z: number) => number,
): { pieces: PlacedConstructionPiece[]; buildings: RpgDensityBuildingSummary[] } {
  const pieces: PlacedConstructionPiece[] = [];
  const buildings: RpgDensityBuildingSummary[] = [];
  for (const [index, center] of villageBuildingPositions().entries()) {
    const id = `rpg-village:building:${index}`;
    const buildingPieces = buildModularBuilding({
      id,
      centerX: center.x,
      centerZ: center.z,
      terrainY: finiteHeight(surfaceHeightAt, center.x, center.z),
      widthCells: rng.int(3, 5),
      depthCells: rng.int(3, 5),
      stories: rng.next() < 0.28 ? 2 : 1,
      wallMaterial: rng.pick(BUILDING_MATERIALS),
      roofMaterial: rng.pick(ROOF_MATERIALS),
      fenceSegments: 8,
    });
    pieces.push(...buildingPieces);
    buildings.push({ id, pieceCount: buildingPieces.length });
  }
  return { pieces, buildings };
}

function buildPlayerBasePieces(surfaceHeightAt: (x: number, z: number) => number): {
  pieces: PlacedConstructionPiece[];
  buildings: RpgDensityBuildingSummary[];
} {
  const id = "rpg-player-base:main";
  const main = buildModularBuilding({
    id,
    centerX: RPG_PLAYER_BASE_CENTER.x,
    centerZ: RPG_PLAYER_BASE_CENTER.z,
    terrainY: finiteHeight(surfaceHeightAt, RPG_PLAYER_BASE_CENTER.x, RPG_PLAYER_BASE_CENTER.z),
    widthCells: 10,
    depthCells: 10,
    stories: 2,
    wallMaterial: "wood",
    roofMaterial: "tiles",
    fenceSegments: 24,
  });
  return { pieces: main, buildings: [{ id, pieceCount: main.length }] };
}

function scatterProps(
  sceneId: RpgDensitySceneId,
  rng: SeededRandom,
  center: RpgDensityCenter,
  count: number,
  surfaceHeightAt: (x: number, z: number) => number,
): PropPlacementScene {
  const instances: PropInstance[] = [];
  const village = sceneId === RPG_VILLAGE_SCENE;
  const minRadius = village ? 55 : 30;
  const maxRadius = village ? 190 : 90;

  for (let index = 0; index < count; index++) {
    let x = center.x;
    let z = center.z;
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const radius = minRadius + rng.next() * (maxRadius - minRadius);
      const candidateX = center.x + Math.cos(angle) * radius;
      const candidateZ = center.z + Math.sin(angle) * radius;
      const roadClear = !village || (Math.abs(candidateX - center.x) > 9 && Math.abs(candidateZ - center.z) > 9);
      const baseClear = village || Math.abs(candidateX - center.x) > 24 || Math.abs(candidateZ - center.z) > 24;
      if (!roadClear || !baseClear) continue;
      x = candidateX;
      z = candidateZ;
      break;
    }
    const assetId = PROP_ASSET_IDS[index % PROP_ASSET_IDS.length]!;
    instances.push({
      assetId,
      position: [x, finiteHeight(surfaceHeightAt, x, z), z],
      rotationY: rng.next() * Math.PI * 2,
      scale: assetId === "rock_large_01" ? 0.8 + rng.next() * 0.8 : 0.85 + rng.next() * 0.35,
      seed: (rng.next() * 0x7fff_ffff) | 0,
      variationId: rng.int(0, 3),
      flags: 0,
      revision: 0,
    });
  }

  return { schemaVersion: 1, sceneId: `${sceneId}:${rng.next().toFixed(8)}`, instances };
}

function buildSummary(
  sceneId: RpgDensitySceneId,
  seed: number,
  center: RpgDensityCenter,
  pieces: readonly PlacedConstructionPiece[],
  buildings: readonly RpgDensityBuildingSummary[],
  placedProps: number,
): RpgDensityCompositionSummary {
  const maxPiecesPerBuilding = buildings.reduce((max, building) => Math.max(max, building.pieceCount), 0);
  return {
    sceneId,
    seed,
    center,
    buildingCount: buildings.length,
    constructionPiecesTotal: pieces.length,
    averagePiecesPerBuilding: buildings.length === 0 ? 0 : pieces.length / buildings.length,
    maxPiecesPerBuilding,
    placedProps,
  };
}

export function buildRpgDensityComposition(input: BuildRpgDensityCompositionInput): RpgDensityComposition {
  const rng = new SeededRandom(input.seed ^ (input.sceneId === RPG_VILLAGE_SCENE ? 0x51f15e : 0x7b45d3));
  const center = rpgDensitySceneCenter(input.sceneId);
  const construction = input.sceneId === RPG_VILLAGE_SCENE
    ? buildVillagePieces(rng, input.surfaceHeightAt)
    : buildPlayerBasePieces(input.surfaceHeightAt);
  const propScene = scatterProps(
    input.sceneId,
    rng,
    center,
    input.sceneId === RPG_VILLAGE_SCENE ? VILLAGE_PROP_COUNT : PLAYER_BASE_PROP_COUNT,
    input.surfaceHeightAt,
  );
  return {
    sceneId: input.sceneId,
    seed: input.seed,
    center,
    pieces: construction.pieces,
    propScene,
    buildings: construction.buildings,
    summary: buildSummary(
      input.sceneId,
      input.seed,
      center,
      construction.pieces,
      construction.buildings,
      propScene.instances.length,
    ),
  };
}

export function publishRpgDensityCompositionCounters(
  counters: Record<string, number> | null | undefined,
  composition: RpgDensityComposition,
): void {
  if (!counters) return;
  counters["rpg_density_scene_active"] = 1;
  counters["rpg_density_scene_kind"] = composition.sceneId === RPG_VILLAGE_SCENE ? 1 : 2;
  counters["rpg_density_seed"] = composition.seed;
  counters["rpg_density_center_x"] = composition.center.x;
  counters["rpg_density_center_z"] = composition.center.z;
  counters["rpg_density_buildings"] = composition.summary.buildingCount;
  counters["rpg_density_construction_pieces_total"] = composition.summary.constructionPiecesTotal;
  counters["rpg_density_average_pieces_per_building"] = composition.summary.averagePiecesPerBuilding;
  counters["rpg_density_max_pieces_per_building"] = composition.summary.maxPiecesPerBuilding;
  counters["rpg_density_placed_props"] = composition.summary.placedProps;
}
