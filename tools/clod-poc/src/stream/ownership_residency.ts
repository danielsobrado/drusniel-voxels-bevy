import { packLiveKey, parseLiveChunkKey } from "./live_chunk_keys.js";
import { packPageKey, parsePageKey } from "./page_plan.js";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";

export interface OwnershipResidencyFeeds {
  liveReady(): ReadonlySet<number>;
  clodReady(): ReadonlySet<number>;
}

export interface RendererOwnershipResidencyFeedInput {
  liveReadyPageKeys(): Iterable<string>;
  clodReadyPageKeys(): Iterable<string>;
  liveChunksPerPage: number;
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

function parseRendererPageKey(key: string): { level: number; x: number; z: number } {
  const [levelText, coordText] = key.split(":");
  const [xText, zText] = (coordText ?? "").split(",");
  const levelRaw = levelText?.startsWith("L") ? levelText.slice(1) : levelText;
  const level = Number(levelRaw);
  const x = Number(xText);
  const z = Number(zText);
  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(z)) {
    throw new Error(`Invalid renderer page key ${key}`);
  }
  return { level, x, z };
}

export function createRendererOwnershipResidencyFeeds(
  input: RendererOwnershipResidencyFeedInput,
): OwnershipResidencyFeeds {
  const liveChunksPerPage = Math.max(1, Math.floor(input.liveChunksPerPage));
  return {
    liveReady() {
      const ready = new Set<number>();
      for (const key of input.liveReadyPageKeys()) {
        const page = parseRendererPageKey(key);
        if (page.level !== 0) continue;
        const baseX = page.x * liveChunksPerPage;
        const baseZ = page.z * liveChunksPerPage;
        for (let dx = 0; dx < liveChunksPerPage; dx++) {
          for (let dz = 0; dz < liveChunksPerPage; dz++) {
            ready.add(packLiveKey(baseX + dx, baseZ + dz));
          }
        }
      }
      return ready;
    },
    clodReady() {
      const ready = new Set<number>();
      for (const key of input.clodReadyPageKeys()) {
        const page = parseRendererPageKey(key);
        ready.add(packPageKey(page.level, page.x, page.z));
      }
      return ready;
    },
  };
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
