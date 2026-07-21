import { getDigEditRevision, getVoxelEditSnapshot } from "../terrain.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import {
  createLargePropOcclusionHeightSampler,
  type LargePropOcclusionHeightPayload,
} from "../../props/large_prop_occlusion_height.js";

export interface TerrainChangedRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Diffs voxel-edit deltas between calls so light-cache invalidation can be
 *  scoped to the regions that actually changed. The global dig revision also
 *  bumps on world rebuilds and snapshot reloads that leave every voxel intact;
 *  those must not rebuild the far light cache. Returns null when the change set
 *  is unknown (edits were removed or reloaded) and only a full refresh is safe. */
export function createTerrainEditChangeTracker() {
  const initial = getVoxelEditSnapshot();
  let lastRevision = initial.revision;
  let lastDeltaCount = initial.deltas.length;
  return {
    consumeChangedRegions(): TerrainChangedRegion[] | null {
      const snapshot = getVoxelEditSnapshot();
      const removedOrReloaded = snapshot.deltas.length < lastDeltaCount || snapshot.revision < lastRevision;
      let regions: TerrainChangedRegion[] | null = null;
      if (!removedOrReloaded) {
        const byRevision = new Map<number, TerrainChangedRegion>();
        for (const delta of snapshot.deltas) {
          if (delta.revision <= lastRevision) continue;
          const region = byRevision.get(delta.revision);
          if (region) {
            region.minX = Math.min(region.minX, delta.x);
            region.minZ = Math.min(region.minZ, delta.z);
            region.maxX = Math.max(region.maxX, delta.x);
            region.maxZ = Math.max(region.maxZ, delta.z);
          } else {
            byRevision.set(delta.revision, { minX: delta.x, minZ: delta.z, maxX: delta.x, maxZ: delta.z });
          }
        }
        regions = [...byRevision.values()];
      }
      lastRevision = snapshot.revision;
      lastDeltaCount = snapshot.deltas.length;
      return regions;
    },
  };
}

/** Allocation-free height sampler over a summary heightMax grid; NaN = missing.
 *  A tile build does up to resolution² × ray-steps samples, so this path must
 *  not allocate result objects or consult the edit revision per sample.
 *  Pure function of its inputs so the sun-light build worker samples heights
 *  bit-identically to the main thread from a transferred heightMax snapshot. */
export function createSunLightHeightSampler(
  res: number,
  worldSize: number,
  heightMax: ArrayLike<number>,
  analytic: ((x: number, z: number) => number) | undefined,
): (x: number, z: number) => number {
  const maxIndex = res - 1;

  const cornerHeight = (lx: number, lz: number): number => {
    const cx = lx < 0 ? 0 : lx > maxIndex ? maxIndex : lx;
    const cz = lz < 0 ? 0 : lz > maxIndex ? maxIndex : lz;
    return heightMax[cz * res + cx]!;
  };

  return (x: number, z: number): number => {
    const inside = x >= 0 && z >= 0 && x <= worldSize && z <= worldSize;
    if (!inside) return analytic ? analytic(x, z) : Number.NaN;
    const fx = (x / worldSize) * res - 0.5;
    const fz = (z / worldSize) * res - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    return cornerHeight(ix, iz) * (1 - tx) * (1 - tz)
      + cornerHeight(ix + 1, iz) * tx * (1 - tz)
      + cornerHeight(ix, iz + 1) * (1 - tx) * tz
      + cornerHeight(ix + 1, iz + 1) * tx * tz;
  };
}

export function createTerrainSummaryLightHeightProvider(field: TerrainSummaryField) {
  const terrainRevision = () => getDigEditRevision();
  const terrainHeightAt = createSunLightHeightSampler(
    field.res,
    field.worldSize,
    field.heightMax,
    field.analyticHeightSampler,
  );
  let propOcclusionRevision = 0;
  let compositeHeightAt = terrainHeightAt;

  const setPropOcclusion = (payload: LargePropOcclusionHeightPayload | null): void => {
    propOcclusionRevision = payload?.revision ?? 0;
    compositeHeightAt = createLargePropOcclusionHeightSampler(payload, terrainHeightAt);
  };

  return {
    terrainRevision,
    propOcclusionRevision: () => propOcclusionRevision,
    setPropOcclusion,
    heightAt(x: number, z: number) {
      return compositeHeightAt(x, z);
    },
    readHeight(x: number, z: number) {
      const height = compositeHeightAt(x, z);
      return Number.isNaN(height)
        ? { height: 0, present: false, revision: terrainRevision() }
        : { height, present: true, revision: terrainRevision() };
    },
    tileRevision(_tile: unknown) {
      return terrainRevision();
    },
  };
}
