import { getDigEditRevision } from "../terrain.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";

export function createTerrainSummaryLightHeightProvider(field: TerrainSummaryField) {
  const terrainRevision = () => getDigEditRevision();
  const res = field.res;
  const worldSize = field.worldSize;
  const heightMax = field.heightMax;
  const analytic = field.analyticHeightSampler;
  const maxIdx = res - 1;

  // Allocation-free sample for the ray-march hot loop; NaN means "no data".
  // A tile build can issue >250k samples, so this path must not allocate or
  // re-read the edit revision per sample.
  const heightAt = (x: number, z: number): number => {
    if (x < 0 || z < 0 || x > worldSize || z > worldSize) {
      return analytic ? analytic(x, z) : Number.NaN;
    }
    const fx = (x / worldSize) * res - 0.5;
    const fz = (z / worldSize) * res - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const x0 = ix < 0 ? 0 : ix > maxIdx ? maxIdx : ix;
    const x1 = ix + 1 < 0 ? 0 : ix + 1 > maxIdx ? maxIdx : ix + 1;
    const z0 = iz < 0 ? 0 : iz > maxIdx ? maxIdx : iz;
    const z1 = iz + 1 < 0 ? 0 : iz + 1 > maxIdx ? maxIdx : iz + 1;
    const h00 = heightMax[z0 * res + x0];
    const h10 = heightMax[z0 * res + x1];
    const h01 = heightMax[z1 * res + x0];
    const h11 = heightMax[z1 * res + x1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  };

  return {
    terrainRevision,
    heightAt,
    readHeight(x: number, z: number) {
      const revision = terrainRevision();
      const height = heightAt(x, z);
      if (Number.isNaN(height)) return { height: 0, present: false, revision };
      return { height, present: true, revision };
    },
    tileRevision(_tile: unknown) {
      return terrainRevision();
    },
  };
}
