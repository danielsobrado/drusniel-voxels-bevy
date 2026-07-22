import type * as THREE from "three";
import materialsYaml from "../../../config/long_view_materials.yaml?raw";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import { shouldSkipLegacyCanopy, type CanopyShellConfig } from "../../canopy/canopy_config.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import { createFarShellController } from "../../systems/far_shell_controller.js";
import type { ClodAppState } from "../clod_app_state.js";
import type { ShadowProxyDebugState } from "../../shadows/index.js";
import type { WorldModeConfig } from "../world_mode.js";

export interface TerrainViewFarShellStartupInput {
  scene: THREE.Scene;
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  isLongView: boolean;
  queryFarShell: boolean;
  queryCanopy: boolean;
  state: ClodAppState;
  searchParams: URLSearchParams;
  worldMode: WorldModeConfig;
  getLighting: () => EnvironmentLighting;
  shadowProxyDebugState: ShadowProxyDebugState | null;
  getCanopyConfig: () => CanopyShellConfig;
  useDeterministicCanopy: boolean;
  longViewHooks: ClodHooks | null;
}

export interface TerrainViewFarShellStartupResult {
  farShellController: ReturnType<typeof createFarShellController>;
}

export function runTerrainViewFarShellStartup(
  input: TerrainViewFarShellStartupInput,
): TerrainViewFarShellStartupResult {
  const {
    scene,
    terrainSummary,
    worldSizeCells,
    isLongView,
    queryFarShell,
    queryCanopy,
    state,
    searchParams,
    worldMode,
    getLighting,
    shadowProxyDebugState,
    getCanopyConfig,
    useDeterministicCanopy,
    longViewHooks,
  } = input;

  const materialConfig = loadLongViewMaterialsConfig(materialsYaml, parseQueryOverrides(searchParams));
  const parityUniformData = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;

  const farShellController = createFarShellController({
    scene,
    terrainSummary,
    worldSizeCells,
    isLongView,
    queryFarShell,
    queryCanopy,
    getLighting,
    getSettings: () => ({
      enabled: state.farShellEnabled,
      radiusFactor: state.farShellRadiusFactor,
      heightBias: state.farShellHeightBias,
      heightDrop: state.farShellHeightDrop,
    }),
    receiveSunShadows: () => Boolean(isLongView && shadowProxyDebugState?.sunShadowsEnabled),
    useDebugLambertReceiver: () => Boolean(shadowProxyDebugState?.debugLambertFarShellReceiver),
    useParityMaterial: () => materialConfig.enabled,
    getParityConfig: () => parityUniformData,
    skipLegacyCanopy: shouldSkipLegacyCanopy(getCanopyConfig(), useDeterministicCanopy),
    onTriangleCount: (counter, count) => {
      if (longViewHooks?.stats) longViewHooks.stats.counters[counter] = count;
    },
  });

  // The legacy far shell is built from the finite startup terrainSummary and is centered on the
  // startup world (worldSizeCells/2), so for an infinite-island world it paints a small finite ring
  // near the origin that disagrees with, and z-fights, the player-centered far terrain. It renders
  // only when it is the resolved far owner (finite worlds); for every other owner it stays off so
  // there is never a legacy finite shell competing with an infinite far renderer. `debugLegacyFarShell=1`
  // forces it on for diagnosis.
  const debugForceLegacyFarShell = searchParams.get("debugLegacyFarShell") === "1";
  const disableLegacyFarShell = !debugForceLegacyFarShell
    && worldMode.farOwner !== "legacy_far_shell";

  if (disableLegacyFarShell) {
    farShellController.setEnabled(false);
  } else if (state.farShellEnabled) {
    farShellController.rebuild();
  } else {
    farShellController.setEnabled(false);
  }

  return { farShellController };
}
