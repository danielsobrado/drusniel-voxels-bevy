import { packLiveKey, parseLiveChunkKey } from "./live_chunk_keys.js";
import { packPageKey, parsePageKey } from "./page_plan.js";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";

export interface OwnershipResidencyFeeds {
  liveReady(): ReadonlySet<number>;
  clodReady(): ReadonlySet<number>;
}

export interface OwnershipResidencyMissingCounts {
  liveMissing: number;
  clodMissing: number;
}

export function packedLiveKeySet(keys: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const key of keys) {
    const coord = parseLiveChunkKey(key);
    out.add(packLiveKey(coord.x, coord.z));
  }
  return out;
}

export function packedPageKeySet(keys: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const key of keys) {
    const coord = parsePageKey(key);
    out.add(packPageKey(coord.level, coord.x, coord.z));
  }
  return out;
}

export function countMissingPacked(required: ReadonlySet<number>, ready: ReadonlySet<number>): number {
  let missing = 0;
  for (const key of required) if (!ready.has(key)) missing++;
  return missing;
}

export function createSnapshotOwnershipResidencyFeeds(
  snapshot: TerrainOwnershipRuntimeSnapshot,
): OwnershipResidencyFeeds {
  const live = packedLiveKeySet(snapshot.live.loaded);
  const clod = packedPageKeySet(snapshot.visualPages.loaded);
  return {
    liveReady: () => live,
    clodReady: () => clod,
  };
}

export function countSnapshotResidencyMissing(
  snapshot: TerrainOwnershipRuntimeSnapshot,
  feeds: OwnershipResidencyFeeds = createSnapshotOwnershipResidencyFeeds(snapshot),
): OwnershipResidencyMissingCounts {
  return {
    liveMissing: countMissingPacked(packedLiveKeySet(snapshot.live.required), feeds.liveReady()),
    clodMissing: countMissingPacked(packedPageKeySet(snapshot.visualPages.required), feeds.clodReady()),
  };
}
