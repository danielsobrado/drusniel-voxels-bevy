import * as THREE from "three";
import { worldToSunVisibilityTile, sunVisibilityTileBounds, sunVisibilityTileKeyToString } from "./sun_visibility_tile.js";
import { toSunBin, sunBinKey } from "./sun_bins.js";
import { buildLightTile, LIGHT_SAMPLE } from "./light_builder.js";
import type { createTerrainSummaryLightHeightProvider } from "./far_light_height.js";

function fullKey(tile: any, bin: any, revision: number): string {
  return `${sunVisibilityTileKeyToString(tile)}|${sunBinKey(bin)}|${revision}`;
}

function readTileValue(tile: ReturnType<typeof buildLightTile>, x: number, z: number, options: any): number {
  const bounds = sunVisibilityTileBounds(tile.key, options.tile);
  const u = THREE.MathUtils.clamp((x - bounds.minX) / (bounds.maxX - bounds.minX), 0, 0.999999);
  const v = THREE.MathUtils.clamp((z - bounds.minZ) / (bounds.maxZ - bounds.minZ), 0, 0.999999);
  const cellX = Math.floor(u * tile.resolution);
  const cellZ = Math.floor(v * tile.resolution);
  return tile.values[cellZ * tile.resolution + cellX] ?? LIGHT_SAMPLE.missing;
}

export function createSunLightCacheCore(options: any) {
  const entries = new Map<string, { tile: ReturnType<typeof buildLightTile>; lastUsedFrame: number }>();
  const pending = new Map<string, any>();
  const stats = {
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
    currentSunBin: null as any,
  };

  const enqueueTile = (tile: any, sunVec: THREE.Vector3, frameIndex: number, provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>) => {
    const sunBin = toSunBin(sunVec, options.directionBins);
    const terrainRevision = provider.tileRevision(tile);
    const key = fullKey(tile, sunBin, terrainRevision);
    stats.currentSunBin = sunBin;
    if (entries.has(key)) {
      entries.get(key)!.lastUsedFrame = frameIndex;
      stats.hits += 1;
      return key;
    }
    if (!pending.has(key)) pending.set(key, { tile, sunVec: sunVec.clone(), sunBin, terrainRevision });
    stats.misses += 1;
    return key;
  };

  const evictIfNeeded = () => {
    if (entries.size <= options.cache.maxEntries) return;
    const ordered = [...entries.entries()].sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
    while (entries.size > options.cache.maxEntries && ordered.length > 0) {
      const [key] = ordered.shift()!;
      if (entries.delete(key)) stats.evictions += 1;
    }
  };

  const readWorld = (x: number, z: number, sunVec: THREE.Vector3, provider: ReturnType<typeof createTerrainSummaryLightHeightProvider>, frameIndex: number) => {
    if (!options.active) return { kind: "lit", value: 1 } as const;
    const tile = worldToSunVisibilityTile(x, z, options.tile);
    const key = enqueueTile(tile, sunVec, frameIndex, provider);
    const entry = entries.get(key);
    if (!entry) return { kind: "pending", value: options.cache.keepLastKnown ? 0.5 : 1 } as const;
    const value = readTileValue(entry.tile, x, z, options);
    if (value === LIGHT_SAMPLE.missing) stats.missingValues += 1;
    if (value === LIGHT_SAMPLE.lit) return { kind: "lit", value: 1 } as const;
    if (value === LIGHT_SAMPLE.shaded) return { kind: "shaded", value: 0 } as const;
    return { kind: "missing", value: 0.5 } as const;
  };

  return { entries, pending, stats, enqueueTile, evictIfNeeded, readWorld };
}
