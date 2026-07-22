import naadfConfigText from "../../../config/naadf_poc.yaml?raw";
import { initFarSummaryIntegration, type FarSummaryIntegration } from "../../far-summary/integration.js";
import {
  applyFarSummaryOceanFallback,
  createFarSummaryCanopySource,
  sampleFarSummaryHydrology,
} from "../../far-summary/unified-sources.js";
import type { FarTerrainSampler } from "../../far-summary/summary-tile-builder.js";
import { initNaadfIntegration, type NaadfIntegration } from "../../naadf/integration.js";
import {
  createDefaultLongViewConfig,
  createFarShellMetrics,
  longViewConfigToFarSummaryConfig,
  type FarShellMetrics,
} from "../../long-view/index.js";
import { applyOwnershipToFarShellRange, type StreamingOwnershipRadii } from "../../streaming/streaming_ownership.js";
import {
  applyLongViewScenePreset,
  farSummaryCanopyEnabled,
  isLongViewCapableScene,
  type LongViewConfig,
} from "./bootstrap_long_view.js";
import type { WorldSource } from "../../world_source/world_source.js";
import type { HydrologySystem } from "../../water/index.js";
import type { CanopyShellConfig } from "../../canopy/canopy_config.js";
import type * as THREE from "three";

export interface BootstrapFarSummaryStartupInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  queryNaadfScene: boolean;
  streamingOwnership: StreamingOwnershipRadii;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rendererWebGpuDevice: GPUDevice | null;
  worldSource: WorldSource;
  hydrologySystem: HydrologySystem | null;
  farCarveImprint: ((x: number, z: number, height: number, cellSizeM: number) => number) | null;
  getCanopyConfig: () => CanopyShellConfig;
}

export interface BootstrapFarSummaryStartupResult {
  naadfIntegration: NaadfIntegration | undefined;
  farSummaryIntegration: FarSummaryIntegration | undefined;
  useNaadfFarSummary: boolean;
  naadfHeightSamplingMode: NaadfIntegration["config"]["farShell"]["heightSamplingMode"] | undefined;
  lvConfig: LongViewConfig | undefined;
  farShellMetrics: FarShellMetrics | undefined;
}

export function runBootstrapFarSummaryStartup(
  input: BootstrapFarSummaryStartupInput,
): BootstrapFarSummaryStartupResult {
  const {
    searchParams,
    queryScene,
    queryNaadfScene,
    streamingOwnership,
    scene,
    camera,
    rendererWebGpuDevice,
    worldSource,
    hydrologySystem,
    farCarveImprint,
    getCanopyConfig,
  } = input;

  let farSummaryIntegration: FarSummaryIntegration | undefined;
  let naadfIntegration: NaadfIntegration | undefined;

  if (queryNaadfScene) {
    naadfIntegration = initNaadfIntegration({
      yamlText: naadfConfigText,
      sceneName: queryScene,
      threeScene: scene,
      forceEnable: queryNaadfScene,
    }) ?? undefined;
  }

  const useNaadfFarSummary = Boolean(
    naadfIntegration?.config.farShell.useNaadfSummary
    && (queryScene?.startsWith("infinite-naadf-") ?? false),
  );
  const naadfHeightSamplingMode = useNaadfFarSummary
    ? naadfIntegration?.config.farShell.heightSamplingMode
    : undefined;

  let lvConfig: LongViewConfig | undefined;
  let farShellMetrics: FarShellMetrics | undefined;

  if (isLongViewCapableScene(queryScene)) {
    lvConfig = createDefaultLongViewConfig();
    applyLongViewScenePreset(lvConfig, queryScene, naadfIntegration);
    applyOwnershipToFarShellRange(lvConfig.farShell, streamingOwnership);

    farShellMetrics = createFarShellMetrics();
    farShellMetrics.farShellEnabled = true;
    farShellMetrics.farShellInnerM = lvConfig.farShell.startMeters;
    farShellMetrics.farShellOuterM = lvConfig.farShell.endMeters;
    farShellMetrics.farShellGridRes = lvConfig.farShell.radialSegments;

    if (!useNaadfFarSummary) {
      const seaLevel = worldSource.metadata.seaLevel;
      const farSummaryConfig = longViewConfigToFarSummaryConfig(lvConfig);
      const farSummaryTerrainSampler: FarTerrainSampler = {
        sampleHeight: (x: number, z: number) => worldSource.sampleHeight(x, z),
        sampleMaterial: (x: number, z: number) => worldSource.sampleMaterial(x, z),
        sampleCanopyCoverage: (x, z) => naadfIntegration?.getCanopySampler().sampleCanopyCoverage(x, z) ?? 0,
        sampleWaterCoverageForHeight: (_x, _z, height) => height < seaLevel ? 1 : 0,
      };
      // Traced worlds: bake the hydrology carve into far-summary heights (CPU builds via
      // the height grid, GPU-committed tiles via the commit imprint) so far terrain shows
      // the same channels the near authority carves.
      if (farCarveImprint) farSummaryTerrainSampler.carveHeightImprint = farCarveImprint;
      if (searchParams.get("farSummaryLayout") === "2") {
        const graphHydrologyEnabled = searchParams.get("continentHydrology") !== "0"
          && searchParams.get("continent_hydrology") !== "0";
        const sampleWater = hydrologySystem && graphHydrologyEnabled
          ? (x: number, z: number, cellSizeM = 1, terrainHeight?: number) => applyFarSummaryOceanFallback(
            sampleFarSummaryHydrology(hydrologySystem, x, z, cellSizeM),
            Number.isFinite(terrainHeight) ? terrainHeight! : farSummaryTerrainSampler.sampleHeight(x, z),
            seaLevel,
          )
          : undefined;
        farSummaryTerrainSampler.sampleWaterSummary = sampleWater;
        if (farSummaryCanopyEnabled(searchParams)) {
          farSummaryTerrainSampler.sampleCanopySummary = createFarSummaryCanopySource({
            getConfig: getCanopyConfig,
            sampleHeight: farSummaryTerrainSampler.sampleHeight,
            sampleMaterial: farSummaryTerrainSampler.sampleMaterial,
          });
        }
      }
      farSummaryIntegration = initFarSummaryIntegration({
        terrainSampler: farSummaryTerrainSampler,
        terrainFieldConfig: worldSource.metadata.terrain,
        sharedDevice: rendererWebGpuDevice,
        scene,
        camera,
        farShellMetrics,
        config: farSummaryConfig,
      });
    }
  }

  return {
    naadfIntegration,
    farSummaryIntegration,
    useNaadfFarSummary,
    naadfHeightSamplingMode,
    lvConfig,
    farShellMetrics,
  };
}
