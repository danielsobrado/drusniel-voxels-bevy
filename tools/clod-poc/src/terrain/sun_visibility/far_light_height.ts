import { getDigEditRevision } from "../terrain.js";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";

function gridIndex(res: number, x: number, z: number): number {
  return z * res + x;
}

export function createTerrainSummaryLightHeightProvider(field: TerrainSummaryField) {
  const terrainRevision = () => getDigEditRevision();
  return {
    terrainRevision,
    readHeight(x: number, z: number) {
      const revision = terrainRevision();
      const inside = x >= 0 && z >= 0 && x <= field.worldSize && z <= field.worldSize;
      if (!inside && !field.analyticHeightSampler) return { height: 0, present: false, revision };
      if (!inside && field.analyticHeightSampler) {
        return { height: field.analyticHeightSampler(x, z), present: true, revision };
      }
      const fx = (x / field.worldSize) * field.res - 0.5;
      const fz = (z / field.worldSize) * field.res - 0.5;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const h = (lx: number, lz: number) => {
        const cx = Math.min(field.res - 1, Math.max(0, lx));
        const cz = Math.min(field.res - 1, Math.max(0, lz));
        return field.heightMax[gridIndex(field.res, cx, cz)];
      };
      return {
        height: h(ix, iz) * (1 - tx) * (1 - tz) + h(ix + 1, iz) * tx * (1 - tz) + h(ix, iz + 1) * (1 - tx) * tz + h(ix + 1, iz + 1) * tx * tz,
        present: true,
        revision,
      };
    },
    tileRevision(_tile: unknown) {
      return terrainRevision();
    },
  };
}
