import type { HeightmapSource } from "../../terrain/heightmap_source.js";
import { sampleHeightmapHeightFrom } from "../../terrain/heightmap_source.js";
import {
  DEFAULT_TERRAIN_FIELD_CONFIG,
  resolveTerrainFieldConfig,
  type TerrainFieldConfig,
  type TerrainFieldConfigInput,
} from "../../terrain/terrain.js";
import { BIOME_IDS, type BiomeId } from "../biome_region_field.js";
import type { WorldSource, WorldSourceMetadata } from "../world_source.js";
import type { AzgaarTerrainClass } from "./azgaar_biome_catalog.js";
import { azgaarMacroToHeightmapSource } from "./azgaar_heightmap_adapter.js";
import { AzgaarMacroWorldGenerator } from "./azgaar_macro_world_generator.js";
import type { AzgaarMacroWorldSource } from "./azgaar_macro_world_source.js";

function terrainClassToBiomeId(terrainClass: AzgaarTerrainClass | string): BiomeId {
  switch (terrainClass) {
    case "water":
      return BIOME_IDS.ocean;
    case "forest":
      return BIOME_IDS.forest;
    case "swamp":
      return BIOME_IDS.swamp;
    case "snow":
      return BIOME_IDS.mountain;
    case "desert":
      return BIOME_IDS.plains;
    case "plains":
    default:
      return BIOME_IDS.meadows;
  }
}

export interface AzgaarWorldSourceOptions {
  worldCells: number;
  terrain?: TerrainFieldConfigInput;
  heightmap?: {
    baseM?: number;
    spanM?: number;
    flipZ?: boolean;
    detailM?: number;
  };
  /**
   * When true, sampleHeight uses the faithful AzgaarMacroWorldGenerator in cell space
   * remapped onto [0, worldCells]. Default false uses HeightmapSource (engine sea-level mapping).
   */
  useMacroGeneratorHeights?: boolean;
}

/**
 * WorldSource backed by an imported Azgaar macro atlas.
 * Heights default through HeightmapSource so they share the existing finite-world CPU path;
 * biomes come from the imported atlas via terrainClass → BIOME_IDS.
 */
export class AzgaarWorldSource implements WorldSource {
  readonly metadata: WorldSourceMetadata;
  readonly baseTerrain: AzgaarMacroWorldSource;
  readonly heightmap: HeightmapSource;
  private readonly generator: AzgaarMacroWorldGenerator;
  private readonly useMacroGeneratorHeights: boolean;
  private readonly worldCells: number;
  private readonly biomeByTileId: Map<number, BiomeId>;

  constructor(baseTerrain: AzgaarMacroWorldSource, options: AzgaarWorldSourceOptions) {
    const terrainInput: TerrainFieldConfigInput = options.terrain ?? {
      ...DEFAULT_TERRAIN_FIELD_CONFIG,
      seaLevel: 18,
      islandShape: {
        ...DEFAULT_TERRAIN_FIELD_CONFIG.islandShape,
        oceanRim: false,
        enabled: false,
      },
    };
    const terrain = resolveTerrainFieldConfig(terrainInput);
    this.baseTerrain = baseTerrain;
    this.worldCells = options.worldCells;
    this.useMacroGeneratorHeights = options.useMacroGeneratorHeights === true;
    this.heightmap = azgaarMacroToHeightmapSource(baseTerrain, {
      worldCells: options.worldCells,
      baseM: options.heightmap?.baseM,
      spanM: options.heightmap?.spanM,
      flipZ: options.heightmap?.flipZ,
      detailM: options.heightmap?.detailM ?? (this.useMacroGeneratorHeights ? 0 : 1.2),
      seed: terrain.seed,
    });
    this.generator = new AzgaarMacroWorldGenerator(baseTerrain, {
      seed: terrain.seed,
      version: 1,
      heightScale: 1,
      seaLevel: terrain.seaLevel,
    });
    this.biomeByTileId = new Map(
      baseTerrain.biomes.map((definition) => [
        definition.tileId,
        terrainClassToBiomeId(definition.terrainClass),
      ]),
    );
    this.metadata = {
      seed: terrain.seed,
      seaLevel: terrain.seaLevel,
      bounds: { radiusM: options.worldCells },
      oceanRim: false,
      terrain,
    };
  }

  private toMacroCell(x: number, z: number): { cellX: number; cellZ: number } {
    const { bounds } = this.baseTerrain;
    const span = this.worldCells > 0 ? this.worldCells : 1;
    const cellX = bounds.minCellX + (x / span) * bounds.widthCells;
    const cellZ = bounds.minCellZ + (z / span) * bounds.heightCells;
    return { cellX, cellZ };
  }

  sampleHeight(x: number, z: number): number {
    if (this.useMacroGeneratorHeights) {
      const { cellX, cellZ } = this.toMacroCell(x, z);
      return this.generator.sampleHeight(cellX, cellZ);
    }
    return sampleHeightmapHeightFrom(this.heightmap, x, z);
  }

  sampleBiome(x: number, z: number): BiomeId {
    const { cellX, cellZ } = this.toMacroCell(x, z);
    const tileId = this.generator.sampleTile(Math.floor(cellX), Math.floor(cellZ));
    if (tileId === 0) return BIOME_IDS.ocean;
    return this.biomeByTileId.get(tileId) ?? BIOME_IDS.meadows;
  }

  sampleMaterial(x: number, z: number): number {
    return this.sampleBiome(x, z);
  }

  oceanMask(x: number, z: number): number {
    return this.sampleHeight(x, z) < this.metadata.seaLevel ? 1 : 0;
  }

  get macroGenerator(): AzgaarMacroWorldGenerator {
    return this.generator;
  }
}

export function createAzgaarWorldSource(
  baseTerrain: AzgaarMacroWorldSource,
  options: AzgaarWorldSourceOptions,
): AzgaarWorldSource {
  return new AzgaarWorldSource(baseTerrain, options);
}

export type { TerrainFieldConfig };
