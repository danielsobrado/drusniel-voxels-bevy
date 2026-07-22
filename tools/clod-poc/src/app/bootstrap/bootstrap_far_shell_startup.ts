import {
  InfiniteFarShell,
  type FarShellMetrics,
} from "../../long-view/index.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../config/longViewMaterialsConfig.js";
import { configToUniformData } from "../../farTerrain/farTerrainUniforms.js";
import type { FarSummaryIntegration } from "../../far-summary/integration.js";
import type { NaadfIntegration } from "../../naadf/integration.js";
import type { LongViewConfig } from "./bootstrap_long_view.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { ShadowProxyController, ShadowProxyDebugState } from "../../shadows/index.js";
import type { WorldSource } from "../../world_source/world_source.js";
import type * as THREE from "three";

export interface BootstrapFarShellStartupInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  farClipmapReplaceActive: boolean;
  lvConfig: LongViewConfig | undefined;
  farShellMetrics: FarShellMetrics | undefined;
  useNaadfFarSummary: boolean;
  naadfHeightSamplingMode: NaadfIntegration["config"]["farShell"]["heightSamplingMode"] | undefined;
  naadfIntegration: NaadfIntegration | undefined;
  farSummaryIntegration: FarSummaryIntegration | undefined;
  scene: THREE.Scene;
  worldSource: WorldSource;
  farCarveImprint: ((x: number, z: number, height: number, cellSizeM: number) => number) | null;
  currentLighting: () => EnvironmentLighting;
  farShellController: { setEnabled: (enabled: boolean) => void };
  shadowProxyController: ShadowProxyController | null;
  shadowProxyDebugState: ShadowProxyDebugState | null;
}

export interface BootstrapFarShellStartupResult {
  infiniteFarShell: InfiniteFarShell | undefined;
}

export function runBootstrapFarShellStartup(
  input: BootstrapFarShellStartupInput,
): BootstrapFarShellStartupResult {
  const {
    searchParams,
    queryScene,
    farClipmapReplaceActive,
    lvConfig,
    farShellMetrics,
    useNaadfFarSummary,
    naadfHeightSamplingMode,
    naadfIntegration,
    farSummaryIntegration,
    scene,
    worldSource,
    farCarveImprint,
    currentLighting,
    farShellController,
    shadowProxyController,
    shadowProxyDebugState,
  } = input;

  let infiniteFarShell: InfiniteFarShell | undefined;

  if (!lvConfig || !farShellMetrics) {
    return { infiniteFarShell };
  }

  const heightProvider = useNaadfFarSummary && naadfIntegration
    ? naadfIntegration.getHeightProvider()
    : farSummaryIntegration?.getHeightProvider();
  if (farSummaryIntegration) {
    (window as any).__drusnielFarSummary = farSummaryIntegration;
  } else if (naadfIntegration) {
    (window as any).__drusnielFarSummary = naadfIntegration;
  }
  const farShellCpuHeightsEnabled = searchParams.get("farShellCpuHeights") !== "0";
  const lighting = currentLighting();

  const materialConfig = loadLongViewMaterialsConfig(undefined, parseQueryOverrides(searchParams));
  const parityConfig = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;
  const useParity = materialConfig.enabled && parityConfig !== undefined;
  const farSummaryGpuAtlas = naadfHeightSamplingMode === "gpu"
    ? naadfIntegration?.getFarSummaryGpuAtlasView()
    : undefined;

  if (naadfHeightSamplingMode === "gpu" && !useParity) throw new Error("NAADF GPU height mode requires the WebGPU parity far terrain material");
  if (naadfHeightSamplingMode === "gpu" && !farSummaryGpuAtlas) throw new Error("NAADF GPU height mode requires a far-summary GPU atlas");

  // Traced-carve worlds must displace far-shell vertices from the (imprinted) CPU
  // summary tiles: the GPU render atlas evaluates the base WGSL field, which cannot
  // run the traced polyline carve, so GPU displacement would show uncarved channels.
  const effectiveHeightSamplingMode = farCarveImprint
    ? "cpu"
    : naadfHeightSamplingMode === "gpu" ? "gpu" : naadfHeightSamplingMode;
  if (farShellCpuHeightsEnabled && !heightProvider && effectiveHeightSamplingMode !== "gpu") {
    throw new Error("long-view scene requires NAADF or far-summary height provider");
  }

  infiniteFarShell = new InfiniteFarShell({
    innerMeters: lvConfig.farShell.startMeters,
    outerMeters: lvConfig.farShell.endMeters,
    radialSegments: lvConfig.farShell.radialSegments,
    angularSegments: lvConfig.farShell.angularSegments,
    heightBiasMeters: lvConfig.farShell.heightBiasMeters,
    nearBlendMeters: lvConfig.farShell.nearBlendMeters,
    farFadeMeters: lvConfig.farShell.farFadeMeters,
    macroBlendStartMeters: lvConfig.farShell.macroBlendStartMeters,
    macroBlendEndMeters: lvConfig.farShell.macroBlendEndMeters,
    rebaseSnapMeters: lvConfig.farShell.rebaseSnapMeters,
    lighting: {
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    },
    useParityMaterial: useParity,
    parityConfig,
    seaLevelMeters: worldSource.metadata.seaLevel,
    heightSamplingMode: effectiveHeightSamplingMode,
    farSummaryGpuAtlas: effectiveHeightSamplingMode === "gpu" ? farSummaryGpuAtlas : undefined,
    debugShowMissingFallback: lvConfig.debug.showMissingSummaryFallback,
    metrics: farShellMetrics,
  });

  (window as any).__drusnielInfiniteFarShell = infiniteFarShell;

  // In replace mode the shell mesh is hidden and its per-frame update is skipped, so a
  // height provider would only queue an initial sliced rebuild that never steps —
  // leaving farShellRebuildPending stuck at 1 and blocking the convergence gate.
  if (farShellCpuHeightsEnabled && !farClipmapReplaceActive) infiniteFarShell.setHeightProvider(heightProvider);
  // Keep farSummaryIntegration alive (it feeds the clipmap source via __drusnielFarSummary), but in
  // replace mode do not add the shell mesh — the far clipmap owns the far band on its own.
  if (!farClipmapReplaceActive) {
    scene.add(infiniteFarShell.mesh);
  } else {
    infiniteFarShell.mesh.visible = false;
  }
  farShellController.setEnabled(false);

  shadowProxyController?.setOnSunShadowsChanged((enabled) => {
    infiniteFarShell?.setReceiveSunShadows(enabled);
  });
  if (shadowProxyDebugState?.sunShadowsEnabled) infiniteFarShell.setReceiveSunShadows(true);

  if (queryScene === "infinite-stream-slow-builds" && farSummaryIntegration) {
    farSummaryIntegration.setForceSlowBuilds(true);
    farSummaryIntegration.setBuildDelayMs(100);
  }

  return { infiniteFarShell };
}
