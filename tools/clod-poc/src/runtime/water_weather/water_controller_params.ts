import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import { DEFAULT_SHORE_SURF_BAND_SETTINGS, type ShoreSurfBandSettings } from "../../water/index.js";

export function readPositiveParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readNonNegativeParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readShoreSurfSettings(
  searchParams: URLSearchParams,
  borderCoast?: BorderCoastOceanConfig,
): ShoreSurfBandSettings {
  const fromBorder: Partial<ShoreSurfBandSettings> = borderCoast?.enabled
    ? {
        enabled: true,
        startDistance: borderCoast.coast.oceanStartCells,
        fullSurfDistance: borderCoast.coast.oceanFullDepthCells,
        level: borderCoast.ocean.surfaceY,
        maxShallowDepth: Math.min(2.5, borderCoast.ocean.minDepth),
      }
    : {};
  const urlEnabled = searchParams.get("shoreSurf") === "1";
  const urlDisabled = searchParams.get("shoreSurf") === "0";
  const surfEnabled = Boolean(fromBorder.enabled);
  return {
    ...DEFAULT_SHORE_SURF_BAND_SETTINGS,
    ...fromBorder,
    enabled: !urlDisabled && (urlEnabled || surfEnabled),
    startDistance: readPositiveParam(
      searchParams,
      "shoreSurfStart",
      fromBorder.startDistance ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.startDistance,
    ),
    fullSurfDistance: readNonNegativeParam(
      searchParams,
      "shoreSurfFull",
      fromBorder.fullSurfDistance ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.fullSurfDistance,
    ),
    maxShallowDepth: readPositiveParam(
      searchParams,
      "shoreSurfDepth",
      fromBorder.maxShallowDepth ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.maxShallowDepth,
    ),
  };
}

export function deepOceanClipmapExclusionDistance(
  searchParams: URLSearchParams,
  borderCoast?: BorderCoastOceanConfig,
): number {
  if (searchParams.get("clipmapBorderWater") === "1") return 0;
  if (!borderCoast?.enabled || !borderCoast.deepOcean.enabled) return 0;
  return Math.max(0, borderCoast.coast.oceanStartCells);
}
