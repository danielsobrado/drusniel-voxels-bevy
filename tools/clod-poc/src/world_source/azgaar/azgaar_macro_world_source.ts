import { createAzgaarBiomeDefinitions, type AzgaarBiomeDefinition } from "./azgaar_biome_catalog.js";
import {
  createMacroAtlasPayload,
  decodeMacroAtlas,
  validateMacroAtlasDimensions,
  type MacroAtlasPayload,
} from "./azgaar_macro_atlas_codec.js";

interface AzgaarGridCell {
  i: number;
  h?: number;
  f?: number;
}

interface AzgaarPackCell extends AzgaarGridCell {
  g?: number;
  biome?: number;
  p?: number[];
}

interface AzgaarRiver {
  i: number;
  width?: number;
  points?: number[][];
  cells?: number[];
}

/** Minimal Azgaar Full JSON fields used by the macro atlas rasterizer. */
export interface AzgaarMacroDocument {
  info?: {
    version?: string | null;
    mapId?: string | null;
    mapName?: string | null;
    width?: number;
    height?: number;
    seed?: string | number | null;
  };
  settings?: {
    mapName?: string;
    distanceScale?: number;
    distanceUnit?: string;
  };
  grid: {
    cellsX: number;
    cellsY: number;
    seed?: string | number | null;
    cells: AzgaarGridCell[];
  };
  pack?: {
    cells?: AzgaarPackCell[];
    rivers?: AzgaarRiver[];
  };
  biomesData?: Parameters<typeof createAzgaarBiomeDefinitions>[0];
}

export interface AzgaarImportOptions {
  physicalWidthMeters?: number;
}

export interface AzgaarImportConfig {
  map: { tileSize: number };
  import?: {
    azgaarAtlasLongEdge?: number;
    azgaarTargetWidth?: number;
    azgaarTargetHeight?: number;
    azgaarOceanTransitionKilometers?: number;
    azgaarVerticalExaggeration?: number;
    azgaarReliefExponent?: number;
  };
  terrain: { minHeight: number; maxHeight: number };
  world: { seaLevel: number };
}

export interface AzgaarMacroWorldSource {
  kind: "azgaar-macro-v1";
  version: 1;
  source: {
    version: string | null;
    mapId: string | null;
    mapName: string;
    seed: string | number | null;
  };
  atlas: {
    width: number;
    height: number;
    heightData: MacroAtlasPayload;
    biomeData: MacroAtlasPayload;
    featureData: MacroAtlasPayload;
  };
  physical: {
    widthMeters: number;
    heightMeters: number;
    distanceScale: number;
    distanceUnit: string;
  };
  bounds: {
    minCellX: number;
    minCellZ: number;
    widthCells: number;
    heightCells: number;
  };
  oceanTransitionCells: number;
  terrain: {
    minHeight: number;
    maxHeight: number;
    seaLevel: number;
    verticalExaggeration: number;
    reliefExponent: number;
  };
  biomes: readonly Readonly<AzgaarBiomeDefinition>[];
  rivers: Array<{ id: number; widthAtlas: number; points: Array<[number, number]> }>;
}

export interface AzgaarImportSummary {
  atlasWidth: number;
  atlasHeight: number;
  physicalWidthMeters: number;
  physicalHeightMeters: number;
  distanceScale: number;
  distanceUnit: string;
  usedCustomUnitFallback: boolean;
  standardBiomeCount: number;
  customBiomeCount: number;
  estimatedRawBytes: number;
}

interface AtlasDimensions {
  width: number;
  height: number;
}

interface PhysicalDimensions {
  widthMeters: number;
  heightMeters: number;
  distanceScale: number;
  distanceUnit: string;
  usedCustomUnitFallback: boolean;
}

const MACRO_SOURCE_KIND = 'azgaar-macro-v1';
const MACRO_SOURCE_VERSION = 1;
const MAX_WORLD_CELLS = 0x7fffffff;

const UNIT_METERS: Readonly<Record<string, number>> = Object.freeze({
  km: 1000,
  mi: 1609.344,
  lg: 4828.032,
  vr: 1066.8,
  nmi: 1852,
  nlg: 5556,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolvePositive(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function validateGridDimensions(grid: AzgaarMacroDocument["grid"]): void {
  const { cellsX, cellsY } = grid;
  if (!Number.isSafeInteger(cellsX) || cellsX < 1 || !Number.isSafeInteger(cellsY) || cellsY < 1) {
    throw new Error('Azgaar Full JSON must include positive safe grid dimensions.');
  }
  const cellCount = cellsX * cellsY;
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > MAX_WORLD_CELLS) {
    throw new Error('Azgaar grid dimensions exceed supported bounds.');
  }
  if (!Array.isArray(grid.cells) || grid.cells.length < 1) {
    throw new Error('Azgaar Full JSON must include non-empty grid cells.');
  }
  for (const cell of grid.cells) {
    if (!Number.isSafeInteger(cell.i) || cell.i < 0 || cell.i >= cellCount) {
      throw new Error('Azgaar Full JSON contains an invalid grid cell id.');
    }
  }
}

function validateImportConfig(config: AzgaarImportConfig): void {
  if (!Number.isFinite(config.map.tileSize) || config.map.tileSize <= 0) {
    throw new Error('Azgaar tile size must be positive.');
  }
  if (
    !Number.isFinite(config.terrain.minHeight)
    || !Number.isFinite(config.terrain.maxHeight)
    || config.terrain.minHeight >= config.terrain.maxHeight
  ) {
    throw new Error('Azgaar terrain height range is invalid.');
  }
  if (!Number.isFinite(config.world.seaLevel)) {
    throw new Error('Azgaar sea level must be finite.');
  }
  const transitionKm = config.import?.azgaarOceanTransitionKilometers;
  if (transitionKm !== undefined && (!Number.isFinite(transitionKm) || transitionKm < 0)) {
    throw new Error('Azgaar ocean transition distance must be non-negative.');
  }
}

function resolveAtlasDimensions(
  document: AzgaarMacroDocument,
  config: AzgaarImportConfig,
): AtlasDimensions {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Azgaar Full JSON must include positive map dimensions.');
  }

  const configuredLongEdge = config.import?.azgaarAtlasLongEdge;
  if (
    typeof configuredLongEdge === 'number'
    && Number.isSafeInteger(configuredLongEdge)
    && configuredLongEdge > 0
  ) {
    if (sourceWidth >= sourceHeight) {
      return {
        width: configuredLongEdge,
        height: Math.max(1, Math.round(configuredLongEdge * sourceHeight / sourceWidth)),
      };
    }
    return {
      width: Math.max(1, Math.round(configuredLongEdge * sourceWidth / sourceHeight)),
      height: configuredLongEdge,
    };
  }

  const width = config.import?.azgaarTargetWidth;
  const height = config.import?.azgaarTargetHeight;
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isSafeInteger(width)
    || width < 1
    || !Number.isSafeInteger(height)
    || height < 1
  ) {
    throw new Error('Azgaar import requires a positive atlas long edge or target dimensions.');
  }
  return { width, height };
}

function resolvePhysicalDimensions(
  document: AzgaarMacroDocument,
  options: AzgaarImportOptions,
): PhysicalDimensions {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Azgaar Full JSON must include positive map dimensions.');
  }

  const distanceScale = Number(document.settings?.distanceScale ?? 1);
  if (!Number.isFinite(distanceScale) || distanceScale <= 0) {
    throw new Error('Azgaar distance scale must be positive.');
  }
  const distanceUnit = String(document.settings?.distanceUnit ?? 'km');
  const unitMeters = UNIT_METERS[distanceUnit] ?? 1000;
  const defaultWidthMeters = sourceWidth * distanceScale * unitMeters;
  const physicalWidthMeters = Number(options.physicalWidthMeters ?? defaultWidthMeters);
  if (!Number.isFinite(physicalWidthMeters) || physicalWidthMeters <= 0) {
    throw new Error('Azgaar physical width override must be positive.');
  }
  const physicalHeightMeters = physicalWidthMeters * sourceHeight / sourceWidth;
  if (!Number.isFinite(physicalHeightMeters) || physicalHeightMeters <= 0) {
    throw new Error('Azgaar physical height must be positive.');
  }
  return {
    widthMeters: physicalWidthMeters,
    heightMeters: physicalHeightMeters,
    distanceScale,
    distanceUnit,
    usedCustomUnitFallback: UNIT_METERS[distanceUnit] === undefined,
  };
}

function buildGridCellLookup(
  grid: AzgaarMacroDocument["grid"],
): Map<number, AzgaarGridCell> {
  return new Map(grid.cells.map((cell) => [cell.i, cell]));
}

function sourceGridCellAt(
  document: AzgaarMacroDocument,
  lookup: ReadonlyMap<number, AzgaarGridCell>,
  normalizedX: number,
  normalizedY: number,
): AzgaarGridCell {
  const column = clamp(
    Math.floor(normalizedX * document.grid.cellsX),
    0,
    document.grid.cellsX - 1,
  );
  const row = clamp(
    Math.floor(normalizedY * document.grid.cellsY),
    0,
    document.grid.cellsY - 1,
  );
  const id = row * document.grid.cellsX + column;
  const fallback = document.grid.cells[clamp(id, 0, document.grid.cells.length - 1)];
  const cell = lookup.get(id) ?? fallback;
  if (!cell) {
    throw new Error(`Azgaar grid cell ${id} is unavailable.`);
  }
  return cell;
}

function buildPackByGrid(
  pack: AzgaarMacroDocument["pack"],
): Map<number, AzgaarPackCell> {
  const result = new Map<number, AzgaarPackCell>();
  for (const cell of pack?.cells ?? []) {
    const gridId = cell.g;
    if (typeof gridId !== 'number' || !Number.isSafeInteger(gridId) || gridId < 0) continue;
    const previous = result.get(gridId);
    if (!previous || Number(cell.h ?? 0) > Number(previous.h ?? 0)) {
      result.set(gridId, cell);
    }
  }
  return result;
}

function point(value: number[] | undefined): [number, number] | null {
  if (!value || value.length < 2) return null;
  const x = value[0];
  const y = value[1];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function riverPoints(
  river: AzgaarRiver,
  packById: ReadonlyMap<number, AzgaarPackCell>,
): Array<[number, number]> {
  const direct = (river.points ?? [])
    .map((value) => point(value))
    .filter((value): value is [number, number] => value !== null);
  if (direct.length > 1) return direct;

  return (river.cells ?? [])
    .map((cellId) => point(packById.get(cellId)?.p))
    .filter((value): value is [number, number] => value !== null);
}

function createRiverData(
  document: AzgaarMacroDocument,
  atlasWidth: number,
  atlasHeight: number,
  physicalWidthMeters: number,
): AzgaarMacroWorldSource["rivers"] {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return [];

  const packById = new Map<number, AzgaarPackCell>(
    (document.pack?.cells ?? []).map((cell) => [cell.i, cell]),
  );
  const distanceScale = Number(document.settings?.distanceScale ?? 1);
  const distanceUnit = document.settings?.distanceUnit ?? 'km';
  const unitMeters = UNIT_METERS[distanceUnit] ?? 1000;
  const metersPerAtlasPixel = physicalWidthMeters / atlasWidth;

  const result: AzgaarMacroWorldSource["rivers"] = [];
  for (const river of document.pack?.rivers ?? []) {
    if (!Number.isSafeInteger(river.i) || river.i < 0) continue;
    const points = riverPoints(river, packById);
    if (points.length < 2) continue;
    const width = Number(river.width ?? 0.1);
    const widthAtlas = Number.isFinite(width)
      ? Math.max(1 / 256, width * distanceScale * unitMeters / metersPerAtlasPixel)
      : 1 / 256;
    result.push({
      id: river.i,
      widthAtlas,
      points: points.map(([x, y]) => [
        x / sourceWidth * atlasWidth,
        y / sourceHeight * atlasHeight,
      ]),
    });
  }
  return result;
}

function checkedWorldCells(meters: number, tileSize: number, label: string): number {
  const cells = Math.max(1, Math.round(meters / tileSize));
  if (!Number.isSafeInteger(cells) || cells > MAX_WORLD_CELLS) {
    throw new Error(`Azgaar ${label} exceeds supported world bounds.`);
  }
  return cells;
}

export function buildAzgaarImportSummary(
  document: AzgaarMacroDocument,
  config: AzgaarImportConfig,
  options: AzgaarImportOptions = {},
): AzgaarImportSummary {
  validateImportConfig(config);
  validateGridDimensions(document.grid);
  const atlas = resolveAtlasDimensions(document, config);
  const physical = resolvePhysicalDimensions(document, options);
  const biomeDefinitions = createAzgaarBiomeDefinitions(document.biomesData);
  const sampleCount = validateMacroAtlasDimensions(atlas.width, atlas.height);
  return Object.freeze({
    atlasWidth: atlas.width,
    atlasHeight: atlas.height,
    physicalWidthMeters: Math.round(physical.widthMeters),
    physicalHeightMeters: Math.round(physical.heightMeters),
    distanceScale: physical.distanceScale,
    distanceUnit: physical.distanceUnit,
    usedCustomUnitFallback: physical.usedCustomUnitFallback,
    standardBiomeCount: biomeDefinitions.filter((biome) => biome.standard).length,
    customBiomeCount: biomeDefinitions.filter((biome) => !biome.standard).length,
    estimatedRawBytes: sampleCount * 4,
  });
}

export function createAzgaarMacroWorldSource(
  document: AzgaarMacroDocument,
  config: AzgaarImportConfig,
  options: AzgaarImportOptions = {},
): AzgaarMacroWorldSource {
  const summary = buildAzgaarImportSummary(document, config, options);
  const length = summary.atlasWidth * summary.atlasHeight;
  const heights = new Uint8Array(length);
  const biomes = new Uint8Array(length);
  const features = new Uint16Array(length);
  const observedBiomeIds = new Set<number>();
  const lookup = buildGridCellLookup(document.grid);
  const packByGrid = buildPackByGrid(document.pack);

  for (let y = 0; y < summary.atlasHeight; y += 1) {
    const normalizedY = (y + 0.5) / summary.atlasHeight;
    for (let x = 0; x < summary.atlasWidth; x += 1) {
      const normalizedX = (x + 0.5) / summary.atlasWidth;
      const gridCell = sourceGridCellAt(document, lookup, normalizedX, normalizedY);
      const packCell = packByGrid.get(gridCell.i);
      const index = y * summary.atlasWidth + x;
      heights[index] = clamp(Math.round(Number(packCell?.h ?? gridCell.h ?? 0)), 0, 100);
      biomes[index] = clamp(Math.round(Number(packCell?.biome ?? 0)), 0, 255);
      observedBiomeIds.add(biomes[index] ?? 0);
      features[index] = clamp(Math.round(Number(packCell?.f ?? gridCell.f ?? 0)), 0, 0xffff);
    }
  }

  const widthCells = checkedWorldCells(
    summary.physicalWidthMeters,
    config.map.tileSize,
    'width',
  );
  const heightCells = checkedWorldCells(
    summary.physicalHeightMeters,
    config.map.tileSize,
    'height',
  );
  const transitionKm = config.import?.azgaarOceanTransitionKilometers ?? 50;
  const oceanTransitionCells = checkedWorldCells(
    transitionKm * 1000,
    config.map.tileSize,
    'ocean transition distance',
  );

  return {
    kind: MACRO_SOURCE_KIND,
    version: MACRO_SOURCE_VERSION,
    source: {
      version: document.info?.version ?? null,
      mapId: document.info?.mapId ?? null,
      mapName: document.info?.mapName ?? document.settings?.mapName ?? 'Azgaar world',
      seed: document.info?.seed ?? document.grid.seed ?? null,
    },
    atlas: {
      width: summary.atlasWidth,
      height: summary.atlasHeight,
      ...createMacroAtlasPayload({ heights, biomes, features }),
    },
    physical: {
      widthMeters: summary.physicalWidthMeters,
      heightMeters: summary.physicalHeightMeters,
      distanceScale: summary.distanceScale,
      distanceUnit: summary.distanceUnit,
    },
    bounds: {
      minCellX: -Math.floor(widthCells / 2),
      minCellZ: -Math.floor(heightCells / 2),
      widthCells,
      heightCells,
    },
    oceanTransitionCells,
    terrain: {
      minHeight: config.terrain.minHeight,
      maxHeight: config.terrain.maxHeight,
      seaLevel: config.world.seaLevel,
      verticalExaggeration: resolvePositive(config.import?.azgaarVerticalExaggeration, 1),
      reliefExponent: resolvePositive(config.import?.azgaarReliefExponent, 1),
    },
    biomes: createAzgaarBiomeDefinitions(document.biomesData, observedBiomeIds),
    rivers: createRiverData(
      document,
      summary.atlasWidth,
      summary.atlasHeight,
      summary.physicalWidthMeters,
    ),
  };
}

export { createMacroAtlasPayload, decodeMacroAtlas };
export type { MacroAtlasPayload };
export const AZGAAR_MACRO_SOURCE_KIND = MACRO_SOURCE_KIND;
