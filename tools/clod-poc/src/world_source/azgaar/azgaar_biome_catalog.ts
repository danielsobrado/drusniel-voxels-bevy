export type AzgaarTerrainClass = "water" | "desert" | "plains" | "forest" | "snow" | "swamp";

export interface AzgaarBiomeDefinition {
  sourceId: number;
  tileId: number;
  key: string;
  name: string;
  color: string;
  icon: string;
  standard: boolean;
  terrainClass: AzgaarTerrainClass;
  supportsGrass: boolean;
  supportsTrees: boolean;
  habitability: number;
  movementCost: number;
  reliefIconDensity: number;
  reliefIcons: readonly string[];
}

export interface AzgaarBiomesData {
  name?: unknown[];
  color?: unknown[];
  habitability?: unknown[];
  cost?: unknown[];
  iconsDensity?: unknown[];
  icons?: unknown[];
}

interface BiomeDefinitionInput {
  sourceId: number;
  tileId: number;
  name: string;
  color: string;
  icon: string;
  standard: boolean;
  terrainClass: AzgaarTerrainClass;
  supportsGrass: boolean;
  supportsTrees: boolean;
  habitability: number;
  movementCost: number;
  reliefIconDensity: number;
  reliefIcons: readonly string[];
}

type StandardBiomeTuple = readonly [
  name: string,
  color: string,
  icon: string,
  terrainClass: AzgaarTerrainClass,
  supportsGrass: boolean,
  supportsTrees: boolean,
];

const CUSTOM_TILE_ID_START = 32;
const CUSTOM_TILE_ID_END = 254;

const STANDARD_DEFINITIONS = [
  ['Marine', '#466eab', '🌊', 'water', false, false],
  ['Hot desert', '#fbe79f', '🏜️', 'desert', false, false],
  ['Cold desert', '#b5b887', '🏜️', 'desert', false, false],
  ['Savanna', '#d2d082', '🌾', 'plains', true, true],
  ['Grassland', '#c8d68f', '🌿', 'plains', true, false],
  ['Tropical seasonal forest', '#b6d95d', '🌴', 'forest', true, true],
  ['Temperate deciduous forest', '#29bc56', '🌳', 'forest', true, true],
  ['Tropical rainforest', '#7dcb35', '🌴', 'forest', true, true],
  ['Temperate rainforest', '#409c43', '🌲', 'forest', true, true],
  ['Taiga', '#4b6b32', '🌲', 'forest', true, true],
  ['Tundra', '#96784b', '🌱', 'snow', false, false],
  ['Glacier', '#d5e7eb', '🧊', 'snow', false, false],
  ['Wetland', '#0b9131', '🪷', 'swamp', true, true],
] as const satisfies readonly StandardBiomeTuple[];

const STANDARD_HABITABILITY = [0, 4, 10, 22, 30, 50, 100, 80, 90, 12, 4, 0, 12] as const;
const STANDARD_MOVEMENT_COST = [10, 200, 150, 60, 50, 70, 70, 80, 90, 200, 1000, 5000, 150] as const;
const STANDARD_ICON_DENSITY = [0, 3, 2, 120, 120, 120, 120, 150, 150, 100, 5, 0, 250] as const;

function keyForName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function validColor(color: unknown): string | null {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : null;
}

function fallbackCustomColor(sourceId: number): string {
  let value = Math.imul(sourceId + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  const red = 64 + ((value >>> 16) & 0x7f);
  const green = 64 + ((value >>> 8) & 0x7f);
  const blue = 64 + (value & 0x7f);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function createDefinition(input: BiomeDefinitionInput): Readonly<AzgaarBiomeDefinition> {
  return Object.freeze({
    ...input,
    key: input.standard ? `azgaar_${keyForName(input.name)}` : `azgaar_custom_${input.sourceId}`,
    reliefIcons: Object.freeze([...input.reliefIcons]),
  });
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function stringList(value: unknown, fallback: readonly string[] = []): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export const AZGAAR_STANDARD_BIOMES: readonly Readonly<AzgaarBiomeDefinition>[] = Object.freeze(
  STANDARD_DEFINITIONS.map((
    [name, color, icon, terrainClass, supportsGrass, supportsTrees],
    sourceId,
  ) => createDefinition({
    sourceId,
    tileId: sourceId,
    name,
    color,
    icon,
    standard: true,
    terrainClass,
    supportsGrass,
    supportsTrees,
    habitability: STANDARD_HABITABILITY[sourceId] ?? 0,
    movementCost: STANDARD_MOVEMENT_COST[sourceId] ?? 0,
    reliefIconDensity: STANDARD_ICON_DENSITY[sourceId] ?? 0,
    reliefIcons: [],
  })),
);

function customSourceIds(
  biomesData: AzgaarBiomesData,
  observedSourceIds: Iterable<number>,
): number[] {
  const ids = new Set<number>();
  const names = Array.isArray(biomesData.name) ? biomesData.name : [];
  const colors = Array.isArray(biomesData.color) ? biomesData.color : [];
  const metadataLength = Math.max(names.length, colors.length);
  for (let sourceId = AZGAAR_STANDARD_BIOMES.length; sourceId < metadataLength; sourceId += 1) {
    if (
      (typeof names[sourceId] === 'string' && names[sourceId].trim() !== '')
      || validColor(colors[sourceId])
    ) {
      ids.add(sourceId);
    }
  }
  for (const sourceId of observedSourceIds) {
    if (Number.isInteger(sourceId) && sourceId >= AZGAAR_STANDARD_BIOMES.length) {
      ids.add(sourceId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

export function createAzgaarBiomeDefinitions(
  biomesData: AzgaarBiomesData = {},
  observedSourceIds: Iterable<number> = [],
): readonly Readonly<AzgaarBiomeDefinition>[] {
  const names = Array.isArray(biomesData.name) ? biomesData.name : [];
  const colors = Array.isArray(biomesData.color) ? biomesData.color : [];
  const habitability = Array.isArray(biomesData.habitability) ? biomesData.habitability : [];
  const movementCost = Array.isArray(biomesData.cost) ? biomesData.cost : [];
  const iconDensity = Array.isArray(biomesData.iconsDensity) ? biomesData.iconsDensity : [];
  const icons = Array.isArray(biomesData.icons) ? biomesData.icons : [];

  const standard = AZGAAR_STANDARD_BIOMES.map((definition) => createDefinition({
    ...definition,
    name: nonEmptyString(names[definition.sourceId], definition.name),
    color: validColor(colors[definition.sourceId]) ?? definition.color,
    habitability: nonNegativeNumber(habitability[definition.sourceId], definition.habitability),
    movementCost: nonNegativeNumber(movementCost[definition.sourceId], definition.movementCost),
    reliefIconDensity: nonNegativeInteger(
      iconDensity[definition.sourceId],
      definition.reliefIconDensity,
    ),
    reliefIcons: stringList(icons[definition.sourceId], definition.reliefIcons),
  }));

  const customIds = customSourceIds(biomesData, observedSourceIds);
  if (customIds.some((sourceId) => sourceId > 255)) {
    throw new Error('Azgaar biome source ids must fit in an unsigned byte (0–255).');
  }
  if (customIds.length > CUSTOM_TILE_ID_END - CUSTOM_TILE_ID_START + 1) {
    throw new Error(
      `Azgaar map defines ${customIds.length} custom biomes; at most `
      + `${CUSTOM_TILE_ID_END - CUSTOM_TILE_ID_START + 1} are supported.`,
    );
  }

  const custom = customIds.map((sourceId, index) => createDefinition({
    sourceId,
    tileId: CUSTOM_TILE_ID_START + index,
    name: nonEmptyString(names[sourceId], `Custom biome ${sourceId}`),
    color: validColor(colors[sourceId]) ?? fallbackCustomColor(sourceId),
    icon: '🗺️',
    standard: false,
    terrainClass: 'plains',
    supportsGrass: true,
    supportsTrees: false,
    habitability: nonNegativeNumber(habitability[sourceId], 0),
    movementCost: nonNegativeNumber(movementCost[sourceId], 0),
    reliefIconDensity: nonNegativeInteger(iconDensity[sourceId], 0),
    reliefIcons: stringList(icons[sourceId]),
  }));

  return Object.freeze([...standard, ...custom]);
}

export const AZGAAR_CUSTOM_TILE_ID_RANGE = Object.freeze({
  minimum: CUSTOM_TILE_ID_START,
  maximum: CUSTOM_TILE_ID_END,
});
