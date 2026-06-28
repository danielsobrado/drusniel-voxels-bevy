import * as THREE from "three";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import { DEFAULT_TERRAIN_FIELD_CONFIG, type TerrainFieldConfig } from "../terrain/terrain.js";
import { BIOME_IDS, BiomeRegionField, type BiomeId } from "./biome_region_field.js";
import { sampleIslandMask } from "./island_shape.js";

export interface WorldSourceMetadata {
  seed: number;
  seaLevel: number;
  bounds: "infinite" | { radiusM: number };
  oceanRim: boolean;
  terrain: TerrainFieldConfig;
}

export interface WorldSource {
  readonly metadata: WorldSourceMetadata;
  sampleHeight(x: number, z: number): number;
  sampleBiome(x: number, z: number): BiomeId;
  oceanMask(x: number, z: number): number;
}

export interface FarWorldHeightProvider {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
}

export class ProceduralWorldSource implements WorldSource {
  readonly metadata: WorldSourceMetadata;
  private readonly biomes: BiomeRegionField;

  constructor(terrain: TerrainFieldConfig = DEFAULT_TERRAIN_FIELD_CONFIG) {
    this.metadata = {
      seed: terrain.seed,
      seaLevel: terrain.seaLevel,
      bounds: terrain.islandShape.oceanRim ? { radiusM: terrain.islandShape.worldRadiusM } : "infinite",
      oceanRim: terrain.islandShape.oceanRim,
      terrain,
    };
    this.biomes = new BiomeRegionField({
      seed: terrain.seed,
      seaLevel: terrain.seaLevel,
      islandShape: terrain.islandShape,
    });
  }

  sampleHeight(x: number, z: number): number {
    return surfaceHeightCore(x, z, this.metadata.terrain);
  }

  sampleBiome(x: number, z: number): BiomeId {
    return this.biomes.sample(x, z, this.sampleHeight(x, z)).biome;
  }

  oceanMask(x: number, z: number): number {
    const h = this.sampleHeight(x, z);
    const island = sampleIslandMask(x, z, this.metadata.terrain.islandShape);
    if (h < this.metadata.seaLevel) return 1;
    return Math.max(0, Math.min(1, 1 - island.mask));
  }

  createFarHeightProvider(): FarWorldHeightProvider {
    return {
      sampleHeight: (x, z) => this.sampleHeight(x, z),
      sampleNormal: (x, z) => {
        const e = 2;
        const hL = this.sampleHeight(x - e, z);
        const hR = this.sampleHeight(x + e, z);
        const hD = this.sampleHeight(x, z - e);
        const hU = this.sampleHeight(x, z + e);
        return new THREE.Vector3((hL - hR) / (2 * e), 1, (hD - hU) / (2 * e)).normalize();
      },
    };
  }
}

export class StreamedVoxelWorldSource implements WorldSource {
  readonly metadata: WorldSourceMetadata;

  constructor(metadata: Partial<WorldSourceMetadata> = {}) {
    const terrain = metadata.terrain ?? DEFAULT_TERRAIN_FIELD_CONFIG;
    this.metadata = {
      seed: metadata.seed ?? terrain.seed,
      seaLevel: metadata.seaLevel ?? terrain.seaLevel,
      bounds: metadata.bounds ?? "infinite",
      oceanRim: metadata.oceanRim ?? false,
      terrain,
    };
  }

  sampleHeight(_x: number, _z: number): number {
    throw new Error("StreamedVoxelWorldSource.sampleHeight is not implemented yet");
  }

  sampleBiome(_x: number, _z: number): BiomeId {
    return BIOME_IDS.meadows;
  }

  oceanMask(_x: number, _z: number): number {
    return 0;
  }
}
