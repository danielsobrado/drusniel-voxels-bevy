// @ts-nocheck
import { createAzgaarBiomeDefinitions, type AzgaarBiomeDefinition } from "./azgaar_biome_catalog.js";
import {
  createMacroAtlasPayload,
  decodeMacroAtlas,
  validateMacroAtlasDimensions,
  type MacroAtlasPayload,
} from "./azgaar_macro_atlas_codec.js";

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
    cells: Array<{ i: number; h?: number; f?: number }>;
  };
  pack?: {
    cells?: Array<{
      i: number;
      g?: number;
      h?: number;
      biome?: number;
      f?: number;
      p?: number[];
    }>;
    rivers?: Array<{
      i: number;
      width?: number;
      points?: number[][];
      cells?: number[];
    }>;
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
  rivers: Array<{ id: number; widthAtlas: number; points: number[][] }>;
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

const MACRO_SOURCE_KIND = 'azgaar-macro-v1';
const MACRO_SOURCE_VERSION = 1;

const UNIT_METERS = Object.freeze({
  km: 1000,
  mi: 1609.344,
  lg: 4828.032,
  vr: 1066.8,
  nmi: 1852,
  nlg: 5556,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolvePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function validateGridDimensions(grid) {
  const cellsX = grid?.cellsX;
  const cellsY = grid?.cellsY;
  if (!Number.isSafeInteger(cellsX) || cellsX < 1 || !Number.isSafeInteger(cellsY) || cellsY < 1) {
    throw new Error('Azgaar Full JSON must include positive safe grid dimensions.');
  }
  const cellCount = cellsX * cellsY;
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > 0x7fffffff) {
    throw new Error('Azgaar grid dimensions exceed supported bounds.');
  }
}

function resolveAtlasDimensions(document, config) {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Azgaar Full JSON must include positive map dimensions.');
  }
  const configuredLongEdge = config.import?.azgaarAtlasLongEdge;
  if (Number.isSafeInteger(configuredLongEdge) && configuredLongEdge > 0) {
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
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Azgaar import requires a positive atlas long edge or target dimensions.');
  }
  return { width, height };
}

function resolvePhysicalDimensions(document, options = {}) {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
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
    usedCustomUnitFallback: !(distanceUnit in UNIT_METERS),
  };
}

function buildGridCellLookup(grid) {
  return new Map(grid.cells.map((cell) => [cell.i, cell]));
}

function sourceGridCellAt(document, lookup, normalizedX, normalizedY) {
  const column = clamp(Math.floor(normalizedX * document.grid.cellsX), 0, document.grid.cellsX - 1);
  const row = clamp(Math.floor(normalizedY * document.grid.cellsY), 0, document.grid.cellsY - 1);
  const id = row * document.grid.cellsX + column;
  return lookup.get(id) ?? document.grid.cells[clamp(id, 0, document.grid.cells.length - 1)];
}

function buildPackByGrid(pack) {
  const result = new Map();
  for (const cell of pack?.cells ?? []) {
    if (!Number.isInteger(cell?.g)) continue;
    const previous = result.get(cell.g);
    if (!previous || Number(cell.h ?? 0) > Number(previous.h ?? 0)) {
      result.set(cell.g, cell);
    }
  }
  return result;
}

function createRiverData(document, atlasWidth, atlasHeight, physicalWidthMeters) {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  const packById = new Map((document.pack?.cells ?? []).map((cell) => [cell.i, cell]));
  const distanceScale = Number(document.settings?.distanceScale ?? 1);
  const unitMeters = UNIT_METERS[document.settings?.distanceUnit] ?? 1000;
  const metersPerAtlasPixel = physicalWidthMeters / atlasWidth;
  return (document.pack?.rivers ?? []).flatMap((river) => {
    const points = Array.isArray(river.points) && river.points.length > 1
      ? river.points
      : (river.cells ?? []).flatMap((cellId) => {
        const point = packById.get(cellId)?.p;
        return Array.isArray(point) ? [point] : [];
      });
    if (points.length < 2) return [];
    return [{
      id: river.i,
      widthAtlas: Math.max(
        1 / 256,
        Number(river.width ?? 0.1) * distanceScale * unitMeters / metersPerAtlasPixel,
      ),
      points: points.map(([x, y]) => [
        x / sourceWidth * atlasWidth,
        y / sourceHeight * atlasHeight,
      ]),
    }];
  });
}

export function buildAzgaarImportSummary(document, config, options = {}): AzgaarImportSummary {
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

export function createAzgaarMacroWorldSource(document, config, options = {}): AzgaarMacroWorldSource {
  if (!Number.isFinite(config.map?.tileSize) || config.map.tileSize <= 0) {
    throw new Error('Azgaar tile size must be positive.');
  }
  validateGridDimensions(document.grid);
  if (!Array.isArray(document.grid?.cells) || document.grid.cells.length < 1) {
    throw new Error('Azgaar Full JSON must include non-empty grid cells.');
  }

  const summary = buildAzgaarImportSummary(document, config, options);
  const length = summary.atlasWidth * summary.atlasHeight;
  const heights = new Uint8Array(length);
  const biomes = new Uint8Array(length);
  const features = new Uint16Array(length);
  const observedBiomeIds = new Set();
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
      biomes[index] = clamp(Number(packCell?.biome ?? 0), 0, 255);
      observedBiomeIds.add(biomes[index]);
      features[index] = clamp(Number(packCell?.f ?? gridCell.f ?? 0), 0, 0xffff);
    }
  }

  const widthCells = Math.max(1, Math.round(summary.physicalWidthMeters / config.map.tileSize));
  const heightCells = Math.max(1, Math.round(summary.physicalHeightMeters / config.map.tileSize));
  if (!Number.isSafeInteger(widthCells) || !Number.isSafeInteger(heightCells)) {
    throw new Error('Azgaar world dimensions exceed supported bounds.');
  }
  const transitionKm = Number(config.import?.azgaarOceanTransitionKilometers ?? 50);
  if (!Number.isFinite(transitionKm) || transitionKm < 0) {
    throw new Error('Azgaar ocean transition distance must be non-negative.');
  }
  const oceanTransitionCells = Math.max(
    1,
    Math.round(transitionKm * 1000 / config.map.tileSize),
  );
  if (!Number.isSafeInteger(oceanTransitionCells)) {
    throw new Error('Azgaar ocean transition distance exceeds supported bounds.');
  }

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
