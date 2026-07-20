import { readActiveEnvironmentQuery } from "../../environment_query/runtime.js";
import type { ComposedEnvironmentQuery } from "../../environment_query/runtime.js";
import {
  getDigEditRevision,
  getVoxelEditRevision,
  surfaceHeight,
} from "../../terrain/terrain.js";
import { voxelEditStore } from "../../terrain/voxel_edits/voxel_edit_store.js";
import { composeVoxelOverlayDensity } from "../../terrain/voxel_overlay/voxel_overlay.js";
import type { ProbeGiProviders } from "./types.js";

const MAXIMUM_HEIGHT_CACHE_ENTRIES = 4_096;

export function createCanonicalProbeGiProviders(
  queryOverride?: ComposedEnvironmentQuery | null,
): ProbeGiProviders {
  const resolveQuery = (): ComposedEnvironmentQuery | null => queryOverride === undefined
    ? readActiveEnvironmentQuery()
    : queryOverride;
  const heightCache = new Map<string, number | null>();
  let heightCacheRevisionKey = "";
  const revisionParts = (): readonly [number, number, number] => [
    nonNegativeRevision(getDigEditRevision()),
    nonNegativeRevision(getVoxelEditRevision()),
    nonNegativeRevision(voxelEditStore.revision()),
  ];
  const terrainRevision = (): number => combineRevisions(revisionParts());
  const heightAt = (x: number, z: number, hintM: number): number | null => {
    const revisions = revisionParts();
    const revisionKey = revisions.join(":");
    if (revisionKey !== heightCacheRevisionKey) {
      heightCache.clear();
      heightCacheRevisionKey = revisionKey;
    }
    const key = `${x},${z},${hintM}`;
    if (heightCache.has(key)) return heightCache.get(key) ?? null;
    const query = resolveQuery();
    let result: number | null;
    if (query) {
      const sample = query.surfaceHeightBestEffort(x, z, hintM);
      result = sample.meta.valid && sample.height !== null && Number.isFinite(sample.height)
        ? sample.height
        : null;
    } else {
      const height = surfaceHeight(x, z);
      result = Number.isFinite(height) ? height : null;
    }
    if (heightCache.size >= MAXIMUM_HEIGHT_CACHE_ENTRIES) heightCache.clear();
    heightCache.set(key, result);
    return result;
  };

  return {
    terrain: {
      heightAt,
      revision: terrainRevision,
    },
    solid: {
      densityAt(x, y, z, hintM) {
        const baseDensity = (sampleX: number, sampleY: number, sampleZ: number): number => {
          const terrainHeight = heightAt(sampleX, sampleZ, hintM);
          if (terrainHeight === null) return Number.NaN;
          return composeVoxelOverlayDensity(terrainHeight - sampleY, sampleX, sampleY, sampleZ);
        };
        const value = voxelEditStore.sampleDensity(x, y, z, baseDensity);
        return Number.isFinite(value) ? value : null;
      },
    },
  };
}

function nonNegativeRevision(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function combineRevisions(revisions: readonly [number, number, number]): number {
  let hash = 2_166_136_261;
  for (const revision of revisions) {
    hash ^= revision >>> 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
