import type { FarSummaryStats } from "./types.js";

export function createFarSummaryStats(): FarSummaryStats {
  return {
    requestedTiles: 0,
    buildingTiles: 0,
    readyTiles: 0,
    staleTiles: 0,
    evictedTiles: 0,
    cacheHits: 0,
    cacheMisses: 0,
    proceduralFallbacks: 0,
    lowerRingFallbacks: 0,
    conservativeFallbacks: 0,
    tilesBuiltThisFrame: 0,
    tilesCommittedThisFrame: 0,
    buildTimeMs: 0,
    maxBuildTimeMs: 0,
  };
}

export function resetFrameStats(stats: FarSummaryStats): void {
  stats.tilesBuiltThisFrame = 0;
  stats.tilesCommittedThisFrame = 0;
  stats.buildTimeMs = 0;
}

export function accumulateStats(dst: FarSummaryStats, src: FarSummaryStats): void {
  dst.requestedTiles = src.requestedTiles;
  dst.buildingTiles = src.buildingTiles;
  dst.readyTiles = src.readyTiles;
  dst.staleTiles = src.staleTiles;
  dst.evictedTiles = src.evictedTiles;
  dst.cacheHits = src.cacheHits;
  dst.cacheMisses = src.cacheMisses;
  dst.proceduralFallbacks = src.proceduralFallbacks;
  dst.lowerRingFallbacks = src.lowerRingFallbacks;
  dst.conservativeFallbacks = src.conservativeFallbacks;
  dst.tilesBuiltThisFrame = src.tilesBuiltThisFrame;
  dst.tilesCommittedThisFrame = src.tilesCommittedThisFrame;
  dst.buildTimeMs = src.buildTimeMs;
  if (src.maxBuildTimeMs > dst.maxBuildTimeMs) {
    dst.maxBuildTimeMs = src.maxBuildTimeMs;
  }
}
