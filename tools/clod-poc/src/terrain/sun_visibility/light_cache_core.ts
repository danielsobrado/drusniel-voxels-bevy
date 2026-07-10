import * as THREE from "three";
import { worldToSunVisibilityTile, sunVisibilityTileBounds, sunVisibilityTileKeyToString, type SunVisibilityTileKey } from "./sun_visibility_tile.js";
import { toSunBin, sunBinKey, type SunDirectionBin } from "./sun_bins.js";
import { LIGHT_SAMPLE, type LightTile, type LightTileBuildRequest } from "./light_builder.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";
import type { SunLightOptions } from "./sun_light_options.js";

interface SunLightCacheStats {
  active: boolean;
  entries: number;
  pendingTiles: number;
  hits: number;
  misses: number;
  missingValues: number;
  evictions: number;
  refreshes: number;
  tilesBuiltTotal: number;
  tilesBuiltThisFrame: number;
  buildMsLastFrame: number;
  buildMsAvg: number;
  currentSunBin: SunDirectionBin | null;
}

/** Entries are keyed by tile and sun bin only. Terrain changes invalidate by
 *  explicit deletion (invalidateRegions/markAllStale in the runtime) rather
 *  than by embedding a revision in the key, so a global revision bump that did
 *  not touch a tile leaves its entry reachable. */
function fullKey(tile: SunVisibilityTileKey, bin: SunDirectionBin): string {
  return `${sunVisibilityTileKeyToString(tile)}|${sunBinKey(bin)}`;
}

function readTileValue(tile: LightTile, x: number, z: number, options: SunLightOptions): number {
  const bounds = sunVisibilityTileBounds(tile.key, options.tile);
  const u = THREE.MathUtils.clamp((x - bounds.minX) / (bounds.maxX - bounds.minX), 0, 0.999999);
  const v = THREE.MathUtils.clamp((z - bounds.minZ) / (bounds.maxZ - bounds.minZ), 0, 0.999999);
  const cellX = Math.floor(u * tile.resolution);
  const cellZ = Math.floor(v * tile.resolution);
  return tile.values[cellZ * tile.resolution + cellX] ?? LIGHT_SAMPLE.missing;
}

function valueToLookup(value: number) {
  if (value === LIGHT_SAMPLE.lit) return { kind: "lit", value: 1 } as const;
  if (value === LIGHT_SAMPLE.shaded) return { kind: "shaded", value: 0 } as const;
  return { kind: "missing", value: 0.5 } as const;
}

export function createSunLightCacheCore(options: SunLightOptions) {
  const entries = new Map<string, { tile: LightTile; lastUsedFrame: number }>();
  const pending = new Map<string, LightTileBuildRequest>();
  const stats: SunLightCacheStats = {
    active: options.active,
    entries: 0,
    pendingTiles: 0,
    hits: 0,
    misses: 0,
    missingValues: 0,
    evictions: 0,
    refreshes: 0,
    tilesBuiltTotal: 0,
    tilesBuiltThisFrame: 0,
    buildMsLastFrame: 0,
    buildMsAvg: 0,
    currentSunBin: null,
  };

  const enqueueTile = (
    tile: SunVisibilityTileKey,
    sunVec: THREE.Vector3,
    frameIndex: number,
    provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>,
  ) => {
    const sunBin = toSunBin(sunVec, options.directionBins);
    const terrainRevision = provider.tileRevision(tile);
    const key = fullKey(tile, sunBin);
    stats.currentSunBin = sunBin;
    const entry = entries.get(key);
    if (entry) {
      entry.lastUsedFrame = frameIndex;
      stats.hits += 1;
      return key;
    }
    if (!pending.has(key)) {
      pending.set(key, { tile, sunVec: sunVec.clone(), sunBin, terrainRevision, frameIndex });
      stats.misses += 1;
    }
    return key;
  };

  const evictIfNeeded = () => {
    stats.active = options.active;
    if (entries.size <= options.cache.maxEntries) return;
    const ordered = [...entries.entries()].sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
    while (entries.size > options.cache.maxEntries && ordered.length > 0) {
      const [key] = ordered.shift()!;
      if (entries.delete(key)) stats.evictions += 1;
    }
  };

  const peekWorld = (x: number, z: number, sunVec: THREE.Vector3, _provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>) => {
    if (!options.active) return { kind: "lit", value: 1 } as const;
    const tile = worldToSunVisibilityTile(x, z, options.tile);
    const sunBin = toSunBin(sunVec, options.directionBins);
    const entry = entries.get(fullKey(tile, sunBin));
    if (!entry) return { kind: "pending", value: options.cache.keepLastKnown ? 0.5 : 1 } as const;
    return valueToLookup(readTileValue(entry.tile, x, z, options));
  };

  const readWorld = (x: number, z: number, sunVec: THREE.Vector3, provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>, frameIndex: number) => {
    stats.active = options.active;
    if (!options.active) return { kind: "lit", value: 1 } as const;
    const tile = worldToSunVisibilityTile(x, z, options.tile);
    const key = enqueueTile(tile, sunVec, frameIndex, provider);
    const entry = entries.get(key);
    if (!entry) return { kind: "pending", value: options.cache.keepLastKnown ? 0.5 : 1 } as const;
    const value = readTileValue(entry.tile, x, z, options);
    if (value === LIGHT_SAMPLE.missing) stats.missingValues += 1;
    return valueToLookup(value);
  };

  return { entries, pending, stats, enqueueTile, evictIfNeeded, peekWorld, readWorld };
}
