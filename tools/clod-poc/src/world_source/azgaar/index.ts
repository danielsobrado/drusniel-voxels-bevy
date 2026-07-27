export {
  AZGAAR_STANDARD_BIOMES,
  AZGAAR_CUSTOM_TILE_ID_RANGE,
  createAzgaarBiomeDefinitions,
  type AzgaarBiomeDefinition,
  type AzgaarBiomesData,
  type AzgaarTerrainClass,
} from "./azgaar_biome_catalog.js";

export {
  AZGAAR_MACRO_SOURCE_KIND,
  buildAzgaarImportSummary,
  createAzgaarMacroWorldSource,
  createMacroAtlasPayload,
  decodeMacroAtlas,
  type AzgaarImportConfig,
  type AzgaarImportOptions,
  type AzgaarMacroWorldSource,
  type MacroAtlasPayload,
} from "./azgaar_macro_world_source.js";

export {
  AZGAAR_CARTOGRAPHY_KIND,
  AZGAAR_CARTOGRAPHY_ENCODING,
  createAzgaarCartographySource,
  decodeAzgaarCartographySource,
  isAzgaarCartographySource,
} from "./azgaar_cartography_source.js";

export {
  AZGAAR_IMPORTED_WORLD_FORMAT,
  AZGAAR_IMPORTED_WORLD_VERSION,
  importAzgaarFullJson,
  isAzgaarFullJson,
  type AzgaarCampaign,
  type AzgaarFullJsonDocument,
  type AzgaarImportedWorld,
} from "./azgaar_json_importer.js";

export {
  AzgaarMacroWorldGenerator,
  type AzgaarProceduralMetadata,
} from "./azgaar_macro_world_generator.js";

export { AzgaarImportWorkerClient } from "./azgaar_import_worker_client.js";

export {
  azgaarMacroToHeightmapSource,
  type AzgaarHeightmapAdaptOptions,
} from "./azgaar_heightmap_adapter.js";

export {
  AzgaarWorldSource,
  createAzgaarWorldSource,
  type AzgaarWorldSourceOptions,
} from "./azgaar_world_source.js";

export {
  defaultAzgaarImportConfig,
  loadAzgaarFullJsonDocument,
  loadAzgaarFullJsonUrl,
  type LoadAzgaarMapOptions,
  type LoadedAzgaarMap,
} from "./azgaar_map_loader.js";
