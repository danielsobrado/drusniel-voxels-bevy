import type { SavedBounds2D } from "../save/world_metadata/metadata_schema.js";
import {
  registerSaveInvalidationTarget,
  unregisterSaveInvalidationTarget,
  type SaveInvalidationTarget,
} from "../save/save_far_summary_bridge.js";
import { farTileKeyString } from "./farClipmap.js";
import { chunkKeyToWorldOrigin, floorDiv } from "./keys.js";
import { syncResidentLookupTables } from "./residentLookup.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import type { ResidentChunkEntry, SummaryTileKey } from "./types.js";

const HALF_OPEN_EPSILON_SCALE = 4;

export interface NaadfInvalidationResult {
  farTilesRemoved: number;
  residentsMarked: number;
  activeBuildsCancelled: number;
}

type NormalizedBounds2D = SavedBounds2D;

export function createNaadfSaveInvalidationTarget(state: NaadfWorldState): SaveInvalidationTarget {
  return {
    markSaveInvalidationBounds(bounds) {
      invalidateNaadfBounds(state, bounds);
    },
  };
}

export function registerNaadfSaveInvalidationTarget(state: NaadfWorldState): () => void {
  const target = createNaadfSaveInvalidationTarget(state);
  registerSaveInvalidationTarget(target);
  return () => unregisterSaveInvalidationTarget(target);
}

export function invalidateNaadfBounds(
  state: NaadfWorldState,
  bounds: SavedBounds2D,
): NaadfInvalidationResult {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return emptyResult();

  const touchedFarTileKeys = collectFarTileKeysForBounds(state, normalized);
  let farTilesRemoved = 0;
  for (const tileKey of touchedFarTileKeys) {
    if (state.farTiles.delete(tileKey)) farTilesRemoved++;
    state.farTileLastTouched.delete(tileKey);
  }

  let activeBuildsCancelled = 0;
  if (state.activeFarTileBuild && touchedFarTileKeys.has(state.activeFarTileBuild.tileKey)) {
    state.activeFarTileBuild = null;
    activeBuildsCancelled = 1;
  }

  let residentsMarked = 0;
  for (const entry of state.residents) {
    if (!residentOverlapsBounds(entry, normalized, state.config.world.chunkSizeCells)) continue;
    if (markResidentForRebuild(entry)) residentsMarked++;
  }

  if (residentsMarked > 0) {
    syncResidentLookupTables(state.nearTable, state.hashFallback, state.residents, state.metrics);
  }

  const result = { farTilesRemoved, residentsMarked, activeBuildsCancelled };
  publishInvalidationMetrics(state, result);
  return result;
}

function collectFarTileKeysForBounds(state: NaadfWorldState, bounds: NormalizedBounds2D): Set<string> {
  const keys = new Set<string>();
  if (!state.config.farClipmap.enabled) return keys;

  const tileCells = state.config.farClipmap.tileCells;
  for (let ringIndex = 0; ringIndex < state.config.farClipmap.rings.length; ringIndex++) {
    const ring = state.config.farClipmap.rings[ringIndex]!;
    const tileSizeM = ring.cellM * tileCells;
    const xRange = touchedIndexRange(bounds.minX, bounds.maxX, tileSizeM);
    const zRange = touchedIndexRange(bounds.minZ, bounds.maxZ, tileSizeM);

    for (let z = zRange.min; z <= zRange.max; z++) {
      for (let x = xRange.min; x <= xRange.max; x++) {
        const key: SummaryTileKey = { ring: ringIndex, x, z };
        keys.add(farTileKeyString(key));
      }
    }
  }
  return keys;
}

function markResidentForRebuild(entry: ResidentChunkEntry): boolean {
  let changed = false;
  if (entry.pendingBrick !== null || entry.pendingMipChain !== null) {
    entry.pendingBrick = null;
    entry.pendingMipChain = null;
    changed = true;
  }

  if (entry.brick !== null) {
    if (entry.state !== "building") {
      entry.state = "building";
      changed = true;
    }
    return changed;
  }

  if (entry.state === "ready" || entry.state === "stale") {
    entry.state = "building";
    return true;
  }

  return changed;
}

function residentOverlapsBounds(
  entry: ResidentChunkEntry,
  bounds: NormalizedBounds2D,
  chunkSizeCells: number,
): boolean {
  const origin = chunkKeyToWorldOrigin(entry.key, chunkSizeCells);
  return axisOverlaps(bounds.minX, bounds.maxX, origin.x, origin.x + chunkSizeCells)
    && axisOverlaps(bounds.minZ, bounds.maxZ, origin.z, origin.z + chunkSizeCells);
}

function axisOverlaps(min: number, max: number, footprintMin: number, footprintMax: number): boolean {
  if (min === max) return min >= footprintMin && min < footprintMax;
  return min < footprintMax && footprintMin < max;
}

function touchedIndexRange(min: number, max: number, tileSizeM: number): { min: number; max: number } {
  const first = floorDiv(min, tileSizeM);
  if (min === max) return { min: first, max: first };
  const last = Math.max(first, floorDiv(previousHalfOpenValue(max), tileSizeM));
  return { min: first, max: last };
}

function previousHalfOpenValue(value: number): number {
  const epsilon = Math.max(1, Math.abs(value)) * Number.EPSILON * HALF_OPEN_EPSILON_SCALE;
  return value - epsilon;
}

function normalizeBounds(bounds: SavedBounds2D): NormalizedBounds2D | null {
  if (!Number.isFinite(bounds.minX)
    || !Number.isFinite(bounds.minZ)
    || !Number.isFinite(bounds.maxX)
    || !Number.isFinite(bounds.maxZ)) {
    return null;
  }

  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };
}

function publishInvalidationMetrics(state: NaadfWorldState, result: NaadfInvalidationResult): void {
  state.metrics.invalidationBoundsCount++;
  state.metrics.invalidationFarTilesRemoved += result.farTilesRemoved;
  state.metrics.invalidationResidentsMarked += result.residentsMarked;
  state.metrics.invalidationActiveBuildsCancelled += result.activeBuildsCancelled;
}

function emptyResult(): NaadfInvalidationResult {
  return {
    farTilesRemoved: 0,
    residentsMarked: 0,
    activeBuildsCancelled: 0,
  };
}
