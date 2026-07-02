import type { WorldSource } from "../world_source/world_source.js";

export interface TerrainSummaryField {
  res: number;
  worldSize: number;
  farReduceFactor: number;
  heightMin: Float32Array;
  heightMax: Float32Array;
  normalX: Float32Array;
  normalY: Float32Array;
  normalZ: Float32Array;
  coverage: Float32Array;
  biomeId?: Uint8Array;
  analyticHeightSampler?: (x: number, z: number) => number;
  analyticBiomeSampler?: (x: number, z: number) => number;
}

export interface TerrainSummaryBuildOptions {
  worldSource?: Pick<WorldSource, "sampleHeight" | "sampleBiome">;
}
