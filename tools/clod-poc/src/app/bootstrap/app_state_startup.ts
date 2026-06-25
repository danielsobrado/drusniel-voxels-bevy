import type { ClodPagesConfig } from "../../config.js";
import type { ProjectArchiveContents } from "../../project/project_archive.js";
import { type TerrainTextureLoadOptions } from "../../terrain/material/texture_loader.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { createClodAppState, type ClodAppState } from "../clod_app_state.js";
import { parseWeatherQueryContext, type BootstrapQueryContext } from "./query_context.js";
import type { WorldBuildResult } from "./world_build_startup.js";

export interface AppStateStartupInput {
  searchParams: URLSearchParams;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  stagedImport: ProjectArchiveContents | null;
  isWebGpu: boolean;
  maxAnisotropy: number;
  queries: BootstrapQueryContext;
  configs: Pick<
    WorldBuildResult,
    "grassConfig" | "stoneConfig" | "treeConfig" | "understoryConfig" | "forestLightingConfig" | "waterConfig"
  >;
}

export interface AppStateStartupResult {
  state: ClodAppState;
  textureLoadOptions: TerrainTextureLoadOptions;
}

export function runAppStateStartup(input: AppStateStartupInput): AppStateStartupResult {
  const {
    searchParams,
    clodRuntime,
    cfg,
    stagedImport,
    isWebGpu,
    maxAnisotropy,
    queries,
    configs,
  } = input;
  const {
    queryPerfMode,
    queryWebGpuSelection,
    queryMaterialTiers,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryForestFloorScene,
    queryTreeGpuRing,
    queryFarShell,
    queryLongViewScene,
    queryGrassRingGrid,
    queryGrassRingCell,
    queryTerrainMaterialSource,
    textureMipmapsEnabled,
  } = queries;
  const {
    queryWeatherMode,
    weatherDefaults,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
  } = parseWeatherQueryContext(searchParams);
  const textureLoadOptions: TerrainTextureLoadOptions = { textureMipmapsEnabled, maxAnisotropy };
  const state = createClodAppState({
    cfg,
    clodRuntime,
    searchParams,
    stagedImport,
    isWebGpu,
    queryPerfMode,
    queryWebGpuSelection,
    queryMaterialTiers,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryForestFloorScene,
    queryTreeGpuRing,
    queryFarShell,
    isLongView: queryLongViewScene,
    queryGrassRingGrid,
    queryGrassRingCell,
    queryTerrainMaterialSource,
    queryWeatherMode,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
    weatherDefaults,
    grassConfig: configs.grassConfig,
    stoneConfig: configs.stoneConfig,
    treeConfig: configs.treeConfig,
    understoryConfig: configs.understoryConfig,
    forestLightingConfig: configs.forestLightingConfig,
    waterConfig: configs.waterConfig,
    digHoldIntervalMs: clodRuntime.digging.holdIntervalMs,
  });
  return { state, textureLoadOptions };
}
