import type { ClodRuntimeConfig } from "../runtime_config.js";
import {
  createClodErrorComputeAccess,
  initLongViewDiagnostics,
  seedLongViewStats,
} from "./diagnostics_startup.js";
import { runAppStateStartup } from "./app_state_startup.js";
import { createBootstrapUiRefs } from "./bootstrap_refs.js";
import { createTerrainEditContext } from "./terrain_edit_context.js";
import type { BootstrapQueryContext } from "./query_context.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodPagesConfig } from "../../config.js";
import type { RendererStartupResult } from "./renderer_startup.js";
import type { WorldBuildResult } from "./world_build_startup.js";

export interface PostRendererStartupInput {
  info: HTMLElement;
  searchParams: URLSearchParams;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  stagedImport: VoxelProjectArchiveContents | null;
  queries: BootstrapQueryContext;
  world: Pick<
    WorldBuildResult,
    | "grassConfig"
    | "stoneConfig"
    | "treeConfig"
    | "understoryConfig"
    | "forestLightingConfig"
    | "waterConfig"
    | "allNodes"
    | "maxTerrainLevel"
    | "worldCells"
  >;
  renderer: RendererStartupResult;
}

export async function runPostRendererStartup(input: PostRendererStartupInput) {
  const { info, searchParams, clodRuntime, cfg, stagedImport, queries, world, renderer } = input;
  const isLongView = queries.queryLongViewScene;
  const enableAutomationHooks = isLongView || queries.queryBorderOceanScene || searchParams.get("customProps") === "1";
  const terrainEdit = createTerrainEditContext(world.maxTerrainLevel);
  const { longViewHooks, longViewSettleWaiters } = initLongViewDiagnostics({
    isLongView: enableAutomationHooks,
    maxTerrainLevel: world.maxTerrainLevel,
    worldCells: world.worldCells,
    phase0TargetVisibleM: queries.phase0TargetVisibleM,
    camera: renderer.camera,
    controls: renderer.controls,
  });
  seedLongViewStats(longViewHooks, {
    maxTerrainLevel: world.maxTerrainLevel,
    worldCells: world.worldCells,
    phase0TargetVisibleM: queries.phase0TargetVisibleM,
  });
  const clodErrorAccess = createClodErrorComputeAccess({
    app: renderer.app,
    rendererWebGpuDevice: renderer.rendererWebGpuDevice,
    allNodes: world.allNodes,
  });
  if (queries.queryWebGpuSelection) {
    info.textContent = "initializing WebGPU CLOD compute…";
    await clodErrorAccess.ensureClodErrorCompute();
  }
  const appState = runAppStateStartup({
    searchParams,
    clodRuntime,
    cfg,
    stagedImport,
    isWebGpu: renderer.isWebGpu,
    maxAnisotropy: renderer.maxAnisotropy,
    queries,
    configs: world,
  });
  const uiRefs = createBootstrapUiRefs(stagedImport);
  return {
    isLongView,
    terrainEdit,
    longViewHooks,
    longViewSettleWaiters,
    ...clodErrorAccess,
    ...appState,
    uiRefs,
  };
}
