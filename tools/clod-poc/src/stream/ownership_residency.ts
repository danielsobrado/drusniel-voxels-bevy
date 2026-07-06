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

export interface OwnershipResidencyMissingOptions {
  liveChunkSizeM?: number;
  liveRequiredRadiusM?: number;
  clodRequiredRootLevel?: number;
  clodCoverageMaxLevel?: number;
}

interface PageCoord {
  level: number;
  x: number;
  z: number;
}

export function packedLiveKeySet(keys: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const key of keys) {
    const coord = parseLiveChunkKey(key);
    out.add(packLiveKey(coord.x, coord.z));
  }
  return out;
}

export function packedLiveKeySetWithinRadius(
  keys: readonly string[],
  center: { x: number; z: number },
  chunkSizeM: number,
  radiusM?: number,
): Set<number> {
  if (!Number.isFinite(radiusM)) return packedLiveKeySet(keys);
  const chunkSize = Math.max(1, Number.isFinite(chunkSizeM) ? chunkSizeM : 1);
  const radius = Math.max(0, radiusM ?? 0);
  const out = new Set<number>();
  for (const key of keys) {
    const coord = parseLiveChunkKey(key);
    const cx = (coord.x + 0.5) * chunkSize;
    const cz = (coord.z + 0.5) * chunkSize;
    if (Math.hypot(cx - center.x, cz - center.z) <= radius) out.add(packLiveKey(coord.x, coord.z));
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

function parseRendererPageKey(key: string): PageCoord {
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

function hasResidentAncestor(page: PageCoord, loaded: ReadonlySet<number>, maxLevel: number): boolean {
  for (let level = page.level + 1; level <= maxLevel; level++) {
    const scale = 2 ** (level - page.level);
    if (loaded.has(packPageKey(level, Math.floor(page.x / scale), Math.floor(page.z / scale)))) return true;
  }
  return false;
}

function loadedDescendantCoverageCells(page: PageCoord, loaded: ReadonlySet<number>): number {
  if (page.level <= 0) return 0;
  const span = 2 ** page.level;
  const covered = new Set<number>();
  const minX = page.x * span;
  const minZ = page.z * span;
  const maxX = minX + span;
  const maxZ = minZ + span;

  for (let level = 0; level < page.level; level++) {
    const scale = 2 ** level;
    const startX = Math.floor(minX / scale);
    const endX = Math.ceil(maxX / scale);
    const startZ = Math.floor(minZ / scale);
    const endZ = Math.ceil(maxZ / scale);
    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        if (!loaded.has(packPageKey(level, x, z))) continue;
        const childMinX = x * scale;
        const childMinZ = z * scale;
        const childMaxX = childMinX + scale;
        const childMaxZ = childMinZ + scale;
        for (let cx = Math.max(minX, childMinX); cx < Math.min(maxX, childMaxX); cx++) {
          for (let cz = Math.max(minZ, childMinZ); cz < Math.min(maxZ, childMaxZ); cz++) {
            covered.add((cz - minZ) * span + (cx - minX));
          }
        }
      }
    }
  }

  return covered.size;
}

export function pageCoveredByResidentClodHierarchy(page: PageCoord, loaded: ReadonlySet<number>, maxLevel: number): boolean {
  if (loaded.has(packPageKey(page.level, page.x, page.z))) return true;
  if (hasResidentAncestor(page, loaded, maxLevel)) return true;
  if (page.level <= 0) return false;
  const span = 2 ** page.level;
  return loadedDescendantCoverageCells(page, loaded) === span * span;
}

export function countMissingPagesWithHierarchyCoverage(
  required: readonly string[],
  loaded: ReadonlySet<number>,
  options: { requiredRootLevel?: number; coverageMaxLevel?: number } = {},
): number {
  const pages = required
    .map(parsePageKey)
    .filter((page) => options.requiredRootLevel === undefined || page.level === options.requiredRootLevel);
  const maxLevel = options.coverageMaxLevel ?? pages.reduce((max, page) => Math.max(max, page.level), 0);
  let missing = 0;
  for (const page of pages) {
    if (!pageCoveredByResidentClodHierarchy(page, loaded, maxLevel)) missing++;
  }
  return missing;
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
  options: OwnershipResidencyMissingOptions = {},
): OwnershipResidencyMissingCounts {
  const liveRequired = packedLiveKeySetWithinRadius(
    snapshot.live.required,
    snapshot.center,
    options.liveChunkSizeM ?? 1,
    options.liveRequiredRadiusM,
  );
  return {
    liveMissing: countMissingPacked(liveRequired, feeds.liveReady()),
    clodMissing: countMissingPagesWithHierarchyCoverage(snapshot.visualPages.required, feeds.clodReady(), {
      requiredRootLevel: options.clodRequiredRootLevel,
      coverageMaxLevel: options.clodCoverageMaxLevel,
    }),
  };
}
