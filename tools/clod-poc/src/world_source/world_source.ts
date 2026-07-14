import * as THREE from "three";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import {
  DEFAULT_TERRAIN_FIELD_CONFIG,
  resolveTerrainFieldConfig,
  surfaceHeight,
  type TerrainFieldConfig,
  type TerrainFieldConfigInput,
} from "../terrain/terrain.js";
import { BiomeRegionField, type BiomeId } from "./biome_region_field.js";
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
  sampleMaterial(x: number, z: number): number;
  oceanMask(x: number, z: number): number;
}

export interface FarWorldHeightProvider {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
}

function terrainDefaultBounds(terrain: TerrainFieldConfig): WorldSourceMetadata["bounds"] {
  return terrain.islandShape.oceanRim ? { radiusM: terrain.islandShape.worldRadiusM } : "infinite";
}

function resolveMetadataTerrain(metadata: Partial<WorldSourceMetadata>): TerrainFieldConfig {
  const base = metadata.terrain ?? DEFAULT_TERRAIN_FIELD_CONFIG;
  const seed = metadata.seed ?? base.seed;
  const seaLevel = metadata.seaLevel ?? base.seaLevel;
  const oceanRim = metadata.oceanRim ?? base.islandShape.oceanRim;
  return resolveTerrainFieldConfig({
    ...base,
    seed,
    seaLevel,
    islandShape: {
      ...base.islandShape,
      oceanRim,
      seed,
      seaLevel,
    },
  });
}

function notImplemented(method: string): never {
  throw new Error(`StreamedVoxelWorldSource.${method} is not implemented yet`);
}

export class ProceduralWorldSource implements WorldSource {
  readonly metadata: WorldSourceMetadata;
  private readonly biomes: BiomeRegionField;

  constructor(terrain: TerrainFieldConfigInput = DEFAULT_TERRAIN_FIELD_CONFIG) {
    const resolvedTerrain = resolveTerrainFieldConfig(terrain);
    this.metadata = {
      seed: resolvedTerrain.seed,
      seaLevel: resolvedTerrain.seaLevel,
      bounds: terrainDefaultBounds(resolvedTerrain),
      oceanRim: resolvedTerrain.islandShape.oceanRim,
      terrain: resolvedTerrain,
    };
    this.biomes = new BiomeRegionField({
      seed: resolvedTerrain.seed,
      seaLevel: resolvedTerrain.seaLevel,
      islandShape: resolvedTerrain.islandShape,
    });
  }

  sampleHeight(x: number, z: number): number {
    return surfaceHeightCore(x, z, this.metadata.terrain);
  }

  sampleBiome(x: number, z: number): BiomeId {
    return this.biomes.sample(x, z, this.sampleHeight(x, z)).biome;
  }

  sampleMaterial(x: number, z: number): number {
    return this.sampleBiome(x, z);
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

/**
 * Runtime world authority. Unlike ProceduralWorldSource, this source follows the
 * installed heightfield/hydrology authority, so far terrain, biomes, materials,
 * props, collision queries, and near terrain classify the same surface.
 */
export class CanonicalWorldSource extends ProceduralWorldSource {
  override sampleHeight(x: number, z: number): number {
    return surfaceHeight(x, z);
  }
}

export class StreamedVoxelWorldSource implements WorldSource {
  readonly metadata: WorldSourceMetadata;

  constructor(metadata: Partial<WorldSourceMetadata> = {}) {
    const terrain = resolveMetadataTerrain(metadata);
    this.metadata = {
      seed: terrain.seed,
      seaLevel: terrain.seaLevel,
      bounds: metadata.bounds ?? terrainDefaultBounds(terrain),
      oceanRim: terrain.islandShape.oceanRim,
      terrain,
    };
  }

  sampleHeight(_x: number, _z: number): number {
    return notImplemented("sampleHeight");
  }

  sampleBiome(_x: number, _z: number): BiomeId {
    return notImplemented("sampleBiome");
  }

  sampleMaterial(_x: number, _z: number): number {
    return notImplemented("sampleMaterial");
  }

  oceanMask(_x: number, _z: number): number {
    return notImplemented("oceanMask");
  }
}
