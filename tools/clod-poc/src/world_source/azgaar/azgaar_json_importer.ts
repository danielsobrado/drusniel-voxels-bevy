import { createAzgaarCartographySource } from "./azgaar_cartography_source.js";
import type { AzgaarBiomesData } from "./azgaar_biome_catalog.js";
import {
  buildAzgaarImportSummary,
  createAzgaarMacroWorldSource,
  type AzgaarImportConfig,
  type AzgaarImportOptions,
  type AzgaarMacroDocument,
  type AzgaarMacroWorldSource,
} from "./azgaar_macro_world_source.js";

export const AZGAAR_IMPORTED_WORLD_FORMAT = "azgaar-imported-v1" as const;
export const AZGAAR_IMPORTED_WORLD_VERSION = 1 as const;

interface AzgaarFullJsonGridCell {
  i: number;
  h?: number;
  f?: number;
}

interface AzgaarFullJsonPackCell extends AzgaarFullJsonGridCell {
  g?: number;
  biome?: number;
  p?: number[];
  v?: number[];
  [key: string]: unknown;
}

interface AzgaarFullJsonRiver {
  i: number;
  width?: number;
  points?: number[][];
  cells?: number[];
  [key: string]: unknown;
}

interface AzgaarFullJsonPack extends Record<string, unknown> {
  cells?: AzgaarFullJsonPackCell[];
  rivers?: AzgaarFullJsonRiver[];
  vertices?: unknown[];
}

export interface AzgaarFullJsonDocument {
  info?: {
    description?: string;
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
    [key: string]: unknown;
  };
  grid?: {
    cells?: AzgaarFullJsonGridCell[];
    cellsX?: number;
    cellsY?: number;
    seed?: string | number | null;
  };
  pack?: AzgaarFullJsonPack;
  biomesData?: AzgaarBiomesData;
  notes?: unknown[];
}

type ValidatedAzgaarDocument = AzgaarFullJsonDocument & AzgaarMacroDocument;

export interface AzgaarCampaign {
  source: {
    type: "azgaar-full-json";
    version: string | null;
    mapId: string | null;
    mapName: string;
    seed: string | number | null;
    importedAt: string;
    sourceWidth: number | null;
    sourceHeight: number | null;
    target: Record<string, unknown>;
  };
  cartography?: ReturnType<typeof createAzgaarCartographySource>;
  states: unknown[];
  provinces: unknown[];
  cultures: unknown[];
  religions: unknown[];
  burgs: unknown[];
  rivers: unknown[];
  routes: unknown[];
  markers: unknown[];
  zones: unknown[];
  features: unknown[];
  goods: unknown[];
  markets: unknown[];
  deals: unknown[];
  measurers: unknown[];
  notes: unknown[];
}

export interface AzgaarImportedWorld {
  format: typeof AZGAAR_IMPORTED_WORLD_FORMAT;
  version: typeof AZGAAR_IMPORTED_WORLD_VERSION;
  baseTerrain: AzgaarMacroWorldSource;
  campaign: AzgaarCampaign;
  importWarnings: string[];
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function isPoint(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isGridCell(value: unknown, cellCount: number): value is AzgaarFullJsonGridCell {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.i)
    && (value.i as number) >= 0
    && (value.i as number) < cellCount
    && isOptionalFiniteNumber(value.h)
    && isOptionalFiniteNumber(value.f);
}

function isPackCell(value: unknown): value is AzgaarFullJsonPackCell {
  if (!isRecord(value) || !Number.isSafeInteger(value.i) || (value.i as number) < 0) return false;
  if (value.g !== undefined && (!Number.isSafeInteger(value.g) || (value.g as number) < 0)) return false;
  if (!isOptionalFiniteNumber(value.h)
      || !isOptionalFiniteNumber(value.biome)
      || !isOptionalFiniteNumber(value.f)) {
    return false;
  }
  if (value.p !== undefined && !isPoint(value.p)) return false;
  if (value.v !== undefined && !isIntegerArray(value.v)) return false;
  return true;
}

function isRiver(value: unknown): value is AzgaarFullJsonRiver {
  if (!isRecord(value) || !Number.isSafeInteger(value.i) || (value.i as number) < 0) return false;
  if (!isOptionalFiniteNumber(value.width)) return false;
  if (value.cells !== undefined && !isIntegerArray(value.cells)) return false;
  if (value.points !== undefined) {
    if (!Array.isArray(value.points) || !value.points.every(isPoint)) return false;
  }
  return true;
}

function hasValidGrid(document: AzgaarFullJsonDocument): document is ValidatedAzgaarDocument {
  const cells = document.grid?.cells;
  const cellsX = document.grid?.cellsX;
  const cellsY = document.grid?.cellsY;
  if (
    !Array.isArray(cells)
    || cells.length === 0
    || typeof cellsX !== "number"
    || typeof cellsY !== "number"
    || !Number.isSafeInteger(cellsX)
    || !Number.isSafeInteger(cellsY)
    || cellsX < 1
    || cellsY < 1
  ) {
    return false;
  }
  const cellCount = cellsX * cellsY;
  if (!Number.isSafeInteger(cellCount) || cellCount > 0x7fffffff) return false;
  return cells.every((cell) => isGridCell(cell, cellCount));
}

function hasValidPack(document: AzgaarFullJsonDocument): boolean {
  const cells = document.pack?.cells;
  if (cells !== undefined && (!Array.isArray(cells) || !cells.every(isPackCell))) return false;
  const rivers = document.pack?.rivers;
  return rivers === undefined || (Array.isArray(rivers) && rivers.every(isRiver));
}

function assertAzgaarDocument(
  document: AzgaarFullJsonDocument,
): asserts document is ValidatedAzgaarDocument {
  const description = String(document.info?.description ?? "").toLowerCase();
  if (!description.includes("azgaar's fantasy map generator")) {
    throw new Error("The selected JSON is not an Azgaar Full JSON export.");
  }
  if (!hasValidGrid(document)) {
    throw new Error(
      "Azgaar Full JSON must include valid non-empty grid cells and supported positive grid dimensions.",
    );
  }
  if (!hasValidPack(document)) {
    throw new Error("Azgaar Full JSON contains invalid packed cells or rivers.");
  }
}

function cloneCampaignArray(value: unknown): unknown[] {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function createCampaign(
  document: ValidatedAzgaarDocument,
  baseTerrain: AzgaarMacroWorldSource,
  summary: ReturnType<typeof buildAzgaarImportSummary>,
  cartography: ReturnType<typeof createAzgaarCartographySource> | null,
): AzgaarCampaign {
  return {
    source: {
      type: "azgaar-full-json",
      version: document.info?.version ?? null,
      mapId: document.info?.mapId ?? null,
      mapName: document.info?.mapName ?? String(document.settings?.mapName ?? "Azgaar world"),
      seed: document.info?.seed ?? document.grid.seed ?? null,
      importedAt: new Date().toISOString(),
      sourceWidth: document.info?.width ?? null,
      sourceHeight: document.info?.height ?? null,
      target: {
        ...baseTerrain.bounds,
        atlasWidth: summary.atlasWidth,
        atlasHeight: summary.atlasHeight,
        physicalWidthMeters: summary.physicalWidthMeters,
        physicalHeightMeters: summary.physicalHeightMeters,
        boundary: "ocean",
      },
    },
    ...(cartography ? { cartography } : {}),
    states: cloneCampaignArray(document.pack?.states),
    provinces: cloneCampaignArray(document.pack?.provinces),
    cultures: cloneCampaignArray(document.pack?.cultures),
    religions: cloneCampaignArray(document.pack?.religions),
    burgs: cloneCampaignArray(document.pack?.burgs),
    rivers: cloneCampaignArray(document.pack?.rivers),
    routes: cloneCampaignArray(document.pack?.routes),
    markers: cloneCampaignArray(document.pack?.markers),
    zones: cloneCampaignArray(document.pack?.zones),
    features: cloneCampaignArray(document.pack?.features),
    goods: cloneCampaignArray(document.pack?.goods),
    markets: cloneCampaignArray(document.pack?.markets),
    deals: cloneCampaignArray(document.pack?.deals),
    measurers: cloneCampaignArray(document.pack?.measurers),
    notes: cloneCampaignArray(document.notes),
  };
}

export function isAzgaarFullJson(document: unknown): document is ValidatedAzgaarDocument {
  if (!isRecord(document)) return false;
  const candidate = document as AzgaarFullJsonDocument;
  return String(candidate.info?.description ?? "")
    .toLowerCase()
    .includes("azgaar's fantasy map generator")
    && hasValidGrid(candidate)
    && hasValidPack(candidate);
}

export function importAzgaarFullJson(
  document: AzgaarFullJsonDocument,
  config: AzgaarImportConfig,
  options: AzgaarImportOptions = {},
): AzgaarImportedWorld {
  assertAzgaarDocument(document);
  const summary = buildAzgaarImportSummary(document, config, options);
  const baseTerrain = createAzgaarMacroWorldSource(document, config, options);
  const cartography = Array.isArray(document.pack?.vertices)
    ? createAzgaarCartographySource(document)
    : null;
  return {
    format: AZGAAR_IMPORTED_WORLD_FORMAT,
    version: AZGAAR_IMPORTED_WORLD_VERSION,
    baseTerrain,
    campaign: createCampaign(document, baseTerrain, summary, cartography),
    importWarnings: [
      `Azgaar macro atlas ${summary.atlasWidth}×${summary.atlasHeight}; `
        + `${Math.round(summary.physicalWidthMeters / 1000)}×`
        + `${Math.round(summary.physicalHeightMeters / 1000)} km; `
        + `${(summary.estimatedRawBytes / 1024 / 1024).toFixed(1)} MiB raw.`,
      "Terrain is generated and streamed on demand; edits remain sparse.",
      "Labels, heraldry, and political overlays are preserved as campaign metadata.",
      ...(summary.usedCustomUnitFallback
        ? [`Unknown distance unit "${summary.distanceUnit}" was interpreted as kilometers.`]
        : []),
    ],
    savedAt: new Date().toISOString(),
  };
}
