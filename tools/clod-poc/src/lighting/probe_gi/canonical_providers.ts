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

export function createCanonicalProbeGiProviders(
  queryOverride?: ComposedEnvironmentQuery | null,
): ProbeGiProviders {
  const resolveQuery = (): ComposedEnvironmentQuery | null => queryOverride ?? readActiveEnvironmentQuery();
  const heightAt = (x: number, z: number, hintM: number): number | null => {
    const query = resolveQuery();
    if (query) {
      const sample = query.surfaceHeightBestEffort(x, z, hintM);
      return sample.meta.valid && sample.height !== null && Number.isFinite(sample.height)
        ? sample.height
        : null;
    }
    const height = surfaceHeight(x, z);
    return Number.isFinite(height) ? height : null;
  };

  return {
    terrain: {
      heightAt,
      revision: () => {
        const query = resolveQuery();
        if (query) {
          const revision = query.surfaceHeightBestEffort(0, 0, 64).meta.revision;
          if (Number.isFinite(revision) && revision >= 0) return Math.floor(revision);
        }
        return Math.max(getDigEditRevision(), getVoxelEditRevision(), voxelEditStore.revision());
      },
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
