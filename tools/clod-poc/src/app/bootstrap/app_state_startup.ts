import type { ClodPagesConfig } from "../../config.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import { type TerrainTextureLoadOptions } from "../../terrain/material/texture_loader.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { createClodAppState, type ClodAppState } from "../clod_app_state.js";
import { applyEnvironmentQueryOverrides } from "../state/environment_query_overrides.js";
import { parseWeatherQueryContext, type BootstrapQueryContext } from "./query_context.js";
import type { WorldBuildResult } from "./world_build_startup.js";

export interface AppStateStartupInput {
  searchParams: URLSearchParams;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  stagedImport: VoxelProjectArchiveContents | null;
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
  const importedState = stagedImport !== null;
  const stateSearchParams = importedState ? new URLSearchParams() : searchParams;
  const {
    queryWeatherMode,
    weatherDefaults,
    queryWeatherIntensity,
    queryWeatherWindX,
    queryWeatherWindZ,
  } = parseWeatherQueryContext(stateSearchParams);
  const textureLoadOptions: TerrainTextureLoadOptions = { textureMipmapsEnabled, maxAnisotropy };
  const state = createClodAppState({
    cfg,
    clodRuntime,
    searchParams: stateSearchParams,
    stagedImport,
    isWebGpu: importedState ? false : isWebGpu,
    queryPerfMode: importedState ? false : queryPerfMode,
    queryWebGpuSelection,
    queryMaterialTiers,
    queryGrassPerfScene: importedState ? false : queryGrassPerfScene,
    queryTreePerfScene: importedState ? false : queryTreePerfScene,
    queryForestFloorScene: importedState ? false : queryForestFloorScene,
    queryTreeGpuRing: importedState ? false : queryTreeGpuRing,
    queryFarShell,
    isLongView: queryLongViewScene,
    queryGrassRingGrid,
    queryGrassRingCell,
    queryTerrainMaterialSource: importedState ? null : queryTerrainMaterialSource,
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
  if (!importedState) applyEnvironmentQueryOverrides(state, searchParams);
  return { state, textureLoadOptions };
}
