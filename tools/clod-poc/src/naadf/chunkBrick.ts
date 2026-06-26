import type { ChunkBrick, ChunkKey } from "./types.js";
import type { TerrainSource } from "./terrainSource.js";
import { chunkKeyToWorldOrigin } from "./keys.js";

export function buildChunkBrick(
  key: ChunkKey,
  sizeCells: number,
  source: TerrainSource,
  revision: number,
): ChunkBrick {
  const origin = chunkKeyToWorldOrigin(key, sizeCells);
  const count = sizeCells * sizeCells;
  const heights = new Float32Array(count);
  const materials = new Uint16Array(count);
  const canopyCoverage = new Float32Array(count);
  const waterCoverage = new Float32Array(count);

  for (let lz = 0; lz < sizeCells; lz++) {
    for (let lx = 0; lx < sizeCells; lx++) {
      const wx = origin.x + lx + 0.5;
      const wz = origin.z + lz + 0.5;
      const idx = lz * sizeCells + lx;
      const s = source.sample(wx, wz);
      heights[idx] = Number.isFinite(s.height) ? s.height : 0;
      materials[idx] = s.material;
      canopyCoverage[idx] = s.canopyCoverage;
      waterCoverage[idx] = s.waterCoverage;
    }
  }

  return {
    key,
    originX: origin.x,
    originZ: origin.z,
    sizeCells,
    heights,
    materials,
    canopyCoverage,
    waterCoverage,
    revision,
  };
}
