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
  const resolveQuery = (): ComposedEnvironmentQuery | null => queryOverride ?? readActiveEnvironmentQuery();
  const heightCache = new Map<string, number | null>();
  let heightCacheRevision = Number.NaN;
  const terrainRevision = (): number => Math.max(
    getDigEditRevision(),
    getVoxelEditRevision(),
    voxelEditStore.revision(),
  );
  const heightAt = (x: number, z: number, hintM: number): number | null => {
    const revision = terrainRevision();
    if (revision !== heightCacheRevision) {
      heightCache.clear();
      heightCacheRevision = revision;
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
