import { createAzgaarCartographySource } from "./azgaar_cartography_source.js";
import {
  buildAzgaarImportSummary,
  createAzgaarMacroWorldSource,
  type AzgaarImportConfig,
  type AzgaarImportOptions,
  type AzgaarMacroWorldSource,
} from "./azgaar_macro_world_source.js";

export const AZGAAR_IMPORTED_WORLD_FORMAT = "azgaar-imported-v1" as const;
export const AZGAAR_IMPORTED_WORLD_VERSION = 1 as const;

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
  settings?: Record<string, unknown>;
  grid?: {
    cells?: unknown[];
    cellsX?: number;
    cellsY?: number;
    seed?: string | number | null;
  };
  pack?: Record<string, unknown>;
  biomesData?: Record<string, unknown>;
  notes?: unknown[];
}

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

function assertAzgaarDocument(document: AzgaarFullJsonDocument): void {
  const description = String(document?.info?.description ?? "").toLowerCase();
  if (!description.includes("azgaar's fantasy map generator")) {
    throw new Error("The selected JSON is not an Azgaar Full JSON export.");
  }
  if (
    !Array.isArray(document?.grid?.cells)
    || !Number.isInteger(document.grid!.cellsX)
    || !Number.isInteger(document.grid!.cellsY)
  ) {
    throw new Error("Azgaar Full JSON must include grid cells and grid dimensions.");
  }
}

function cloneCampaignArray(value: unknown): unknown[] {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function createCampaign(
  document: AzgaarFullJsonDocument,
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
      seed: document.info?.seed ?? document.grid?.seed ?? null,
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

export function isAzgaarFullJson(document: unknown): document is AzgaarFullJsonDocument {
  const doc = document as AzgaarFullJsonDocument;
  return String(doc?.info?.description ?? "")
    .toLowerCase()
    .includes("azgaar's fantasy map generator")
    && Array.isArray(doc?.grid?.cells);
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
