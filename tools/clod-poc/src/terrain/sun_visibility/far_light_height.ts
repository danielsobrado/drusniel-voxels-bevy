import { getDigEditRevision } from "../terrain.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";

export function createTerrainSummaryLightHeightProvider(field: TerrainSummaryField) {
  const terrainRevision = () => getDigEditRevision();
  const res = field.res;
  const worldSize = field.worldSize;
  const heightMax = field.heightMax;
  const analytic = field.analyticHeightSampler;
  const maxIndex = res - 1;

  const cornerHeight = (lx: number, lz: number): number => {
    const cx = lx < 0 ? 0 : lx > maxIndex ? maxIndex : lx;
    const cz = lz < 0 ? 0 : lz > maxIndex ? maxIndex : lz;
    return heightMax[cz * res + cx];
  };

  /** Allocation-free height sample for the tile-build hot loop; NaN = missing.
   *  A tile build does up to resolution² × ray-steps samples, so this path must
   *  not allocate result objects or consult the edit revision per sample. */
  const heightAt = (x: number, z: number): number => {
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

  return {
    terrainRevision,
    heightAt,
    readHeight(x: number, z: number) {
      const height = heightAt(x, z);
      return Number.isNaN(height)
        ? { height: 0, present: false, revision: terrainRevision() }
        : { height, present: true, revision: terrainRevision() };
    },
    tileRevision(_tile: unknown) {
      return terrainRevision();
    },
  };
}
