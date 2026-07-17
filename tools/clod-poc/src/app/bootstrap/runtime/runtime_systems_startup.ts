import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import playerEditingConfigText from "../../../../config/player/player_editing.yaml?raw";
import type { ClodPageNode } from "../../../types.js";
import { parseGrassConfig } from "../../../grass.js";
import { parseStoneConfig } from "../../../stones/stone_config.js";
import { parseTreeConfig } from "../../../trees/index.js";
import type { TreeTerrainOcclusionSampler } from "../../../trees/tree_terrain_occlusion.js";
import { parseUnderstoryConfig } from "../../../understory/index.js";
import type { BorderCoastOceanConfig } from "../../../terrain/border_coast_config.js";
import { surfaceHeight } from "../../../terrain/terrain.js";
import type { WaterConfig } from "../../../water/waterConfig.js";
import {
  buildRiverTerrainWetnessMask,
  parseRiverTerrainWetnessMaskResolution,
  type HydrologySystem,
} from "../../../water/index.js";
import type { EnvironmentLighting } from "../../../environment/environment.js";
import { drainVegetationDirty, type VegetationDirtyQueue } from "../../../systems/vegetation_dirty.js";
import type { ClodHooks } from "../../../core/hooks.js";
import type { ClodRuntimeBindings } from "../../clod_runtime_bindings.js";
import type { AppRenderer } from "../renderer_startup.js";
import type { createTerrainMaterialController } from "../../../terrain/material/terrain_material_controller.js";
import type { AppSky } from "../../../scene/app_sky.js";
import { runWaterWeatherStartup, type WaterWeatherStartupResult } from "../../../runtime/water_weather/water_weather_startup.js";
import {
  runVegetationStartup,
  type VegetationStartupResult,
} from "../../../runtime/vegetation/vegetation_startup.js";
import { resolveVegetationGpuBackend } from "../../../runtime/vegetation/vegetation_gpu_backend.js";
import type {
  VegetationStatControllerRefs,
} from "../../../runtime/vegetation/vegetation_types.js";
import {
  runForestLightingStartup,
  type ForestLightingStartupResult,
} from "./forest_lighting_startup.js";
import {
  runCustomPropsStartup,
  resolveCustomPropsEnabled,
  type CustomPropsStartupResult,
} from "../custom_props_startup.js";
import { resolvePropPlacementScene } from "../../../props/prop_placements.js";
import type { CustomPropsSettings, PropPlacementScene } from "../../../props/prop_types.js";
import { createConstructionController, defaultConstructionConfig, type ConstructionController } from "../../../construction/index.js";
import { installConstructionCommitGuard } from "../../../construction/construction_commit_guard.js";
import { resolvePlayerEditAuthorityConfig } from "../../../player/player_edit_authority.js";
import type { VoxelProjectArchiveContents } from "../../../project/voxel_project_archive.js";
import { propPlacementSceneToProjectProps } from "../../../project/project_props.js";
import { projectPropEditStore } from "../../../project/prop_edit_store.js";
import { hasLoadedSavePropAuthority } from "../../../save/save_runtime.js";
import { shouldRestoreDefaultCustomProps } from "./custom_props_authority.js";
import {
  buildRpgDensityComposition,
  publishRpgDensityCompositionCounters,
  type RpgDensityComposition,
} from "../../../qa/rpg_density_scene_composition.js";
import { isRpgDensityScene } from "../../../scenes/rpg_density_scenes.js";

export type { VegetationStatControllerRefs } from "../../../runtime/vegetation/vegetation_types.js";

export interface RuntimeSystemsStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  state: import("../../clod_app_state.js").ClodAppState;
  bindings: ClodRuntimeBindings;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  worldSeed: number;
  unboundedWorld: boolean;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  forestLightingConfig: ReturnType<typeof import("../../../forest_lighting/index.js").parseForestLightingConfig>;
  waterConfig: WaterConfig;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  customPropsConfig: CustomPropsSettings;
  propPlacementScenes: Record<string, PropPlacementScene>;
  stagedImport: VoxelProjectArchiveContents | null;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  isWebGpu: boolean;
  rendererWebGpuDevice: GPUDevice | null;
  hydrologySystem: HydrologySystem | null;
  terrainOcclusionSampler?: TreeTerrainOcclusionSampler;
  searchParams: URLSearchParams;
  materialController: ReturnType<typeof createTerrainMaterialController>;
  skyEnvironment: AppSky;
  currentLighting: () => EnvironmentLighting;
  vegetationDirtyQueue: VegetationDirtyQueue;
  statControllers: VegetationStatControllerRefs;
  getHooks: () => ClodHooks | null;
  shadowProxyController?: import("../../../shadows/shadowProxyController.js").ShadowProxyController | null;
}

export interface RuntimeSystemsStartupResult extends VegetationStartupResult, WaterWeatherStartupResult,
  ForestLightingStartupResult {
  updateLighting: () => void;
  drainVegetationDirtyQueue: () => void;
  customProps: CustomPropsStartupResult | null;
  constructionController: ConstructionController | null;
}

function withConstructionGuardDispose(
  controller: ConstructionController,
  disposeGuard: () => void,
): ConstructionController {
  return {
    colliderSet: controller.colliderSet,
    update: () => controller.update(),
    stats: () => controller.stats(),
    setTerrainConformHandler: (handler) => controller.setTerrainConformHandler(handler),
    reevaluateSupportForTerrainEdit: (aabb) => controller.reevaluateSupportForTerrainEdit(aabb),
    dispose: () => {
      disposeGuard();
      controller.dispose();
    },
  };
}

function persistenceSafeDensityComposition(composition: RpgDensityComposition): RpgDensityComposition {
  const wallGroups = new Map<string, Array<{ id: string; index: number }>>();
  const wallPattern = /^(.*:wall:\d+:(?:west|east)):(\d+)$/;
  for (const placed of composition.pieces) {
    const match = wallPattern.exec(placed.id);
    if (!match) continue;
    const group = wallGroups.get(match[1]!) ?? [];
    group.push({ id: placed.id, index: Number(match[2]) });
    wallGroups.set(match[1]!, group);
  }
  const omittedIds = new Set(
    composition.pieces
      .filter((placed) => placed.id.includes(":pillar:"))
      .map((placed) => placed.id),
  );
  for (const group of wallGroups.values()) {
    group.sort((a, b) => a.index - b.index);
    if (group.length > 0) omittedIds.add(group[0]!.id);
    if (group.length > 1) omittedIds.add(group[group.length - 1]!.id);
  }

  const pieces = composition.pieces.filter((placed) => !omittedIds.has(placed.id));
  const buildings = composition.buildings.map((building) => ({
    ...building,
    pieceCount: pieces.filter((placed) => placed.id.startsWith(`${building.id}:`)).length,
  }));
  const maxPiecesPerBuilding = buildings.reduce((max, building) => Math.max(max, building.pieceCount), 0);
  return {
    ...composition,
    pieces,
    buildings,
    summary: {
      ...composition.summary,
      constructionPiecesTotal: pieces.length,
      averagePiecesPerBuilding: buildings.length === 0 ? 0 : pieces.length / buildings.length,
      maxPiecesPerBuilding,
    },
  };
}

function prepareRpgDensityComposition(input: RuntimeSystemsStartupInput): RpgDensityComposition | null {
  const sceneId = input.searchParams.get("rpgDensityScene");
  if (!isRpgDensityScene(sceneId)) return null;
  const composition = persistenceSafeDensityComposition(buildRpgDensityComposition({
    sceneId,
    seed: input.worldSeed,
    surfaceHeightAt: surfaceHeight,
  }));
  input.propPlacementScenes[sceneId] = composition.propScene;
  input.searchParams.set("customPropScene", sceneId);
  if (!input.searchParams.has("customProps")) input.searchParams.set("customProps", "1");
  if (!input.searchParams.has("construction")) input.searchParams.set("construction", "1");
  publishRpgDensityCompositionCounters(input.getHooks()?.stats?.counters, composition);
  return composition;
}

function benchmarkConstructionStorageKey(composition: RpgDensityComposition): string {
  return `drusniel.clod-poc.benchmark.${composition.sceneId}.${composition.seed}.v1`;
}

export async function runRuntimeSystemsStartup(
  input: RuntimeSystemsStartupInput,
): Promise<RuntimeSystemsStartupResult> {
  const {
    app,
    scene,
    camera,
    controls,
    state,
    bindings,
    lod0Nodes,
    worldCells,
    worldSeed,
    unboundedWorld,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    waterConfig,
    borderCoastOceanConfig,
    customPropsConfig,
    propPlacementScenes,
    stagedImport,
    queryGrassRingGrid,
    queryGrassRingCell,
    isWebGpu,
    rendererWebGpuDevice,
    hydrologySystem,
    terrainOcclusionSampler,
    searchParams,
    materialController,
    skyEnvironment,
    currentLighting,
    vegetationDirtyQueue,
    statControllers,
    getHooks,
  } = input;
  const densityComposition = prepareRpgDensityComposition(input);

  const vegetation = runVegetationStartup({
    app,
    scene,
    controls,
    state,
    lod0Nodes,
    worldCells,
    worldSeed,
    unboundedWorld,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    isWebGpu,
    rendererWebGpuDevice,
    hydrologySystem,
    terrainOcclusionSampler,
    currentLighting,
    statControllers,
    searchParams,
  });
  await vegetation.impostorBakePromise;
  const gpuBackend = resolveVegetationGpuBackend(app.renderer, isWebGpu);

  const {
    grassController,
    grassSystem,
    stoneController,
    treeController,
    understoryController,
    treeSystem,
    understorySystem,
  } = vegetation;

  const forestLighting = runForestLightingStartup({
    worldCells,
    forestLightingConfig,
    state,
    treeSystem,
    understorySystem,
    statControllers,
  });

  const waterWeather = await runWaterWeatherStartup({
    scene,
    camera,
    state,
    waterConfig,
    borderCoastOceanConfig,
    worldCells,
    hydrologySystem,
    searchParams,
    currentLighting,
    lod0Nodes,
    isWebGpu,
  });

  const { waterController } = waterWeather;
  if (isWebGpu && waterConfig.enabled) {
    const riverTerrainWetnessMask = buildRiverTerrainWetnessMask({
      field: waterController.field,
      worldCells,
      resolution: parseRiverTerrainWetnessMaskResolution(searchParams.get("riverWetnessMaskRes")),
    });
    materialController.setRiverTerrainWetnessMask(riverTerrainWetnessMask);
  }

  const updateLighting = () => {
    skyEnvironment?.updateSettings({
      sunAzimuthDeg: state.sunAzimuthDeg,
      sunElevationDeg: state.sunElevationDeg,
      sunIntensity: state.sunIntensity,
      skyIntensity: state.skyIntensity,
      groundIntensity: state.groundIntensity,
      exposure: state.exposure,
      horizonSoftness: state.horizonSoftness,
      sunDiskIntensity: state.sunDiskIntensity,
      sunGlowIntensity: state.sunGlowIntensity,
      hazeIntensity: state.hazeIntensity,
    });
    const lighting = currentLighting();
    materialController.forEachMaterial((mat) => materialController.applyLighting(mat, lighting));
    grassController.updateLighting({
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    });
    const stoneLighting = {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
    stoneController.updateLighting(stoneLighting);
    treeController.updateLighting(lighting);
    understoryController.updateLighting(lighting);
    waterController.updateSunDirection(lighting.sunDirection);
    waterWeather.deepOceanMaterial?.updateSunDirection(lighting.sunDirection);
    waterWeather.deepOceanMaterial?.updateHorizonColor(lighting.skyLight);
    input.shadowProxyController?.syncSunLight();
  };

  const drainVegetationDirtyQueue = (): void => {
    drainVegetationDirty({
      queue: vegetationDirtyQueue,
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
      markGrassDirty: () => {
        grassSystem.markPatchesDirty();
        bindings.refreshGrassStats();
      },
      markTreesDirty: () => {
        treeController.markPatchesDirty();
        bindings.refreshTreeStats();
      },
      markUnderstoryDirty: () => {
        understoryController.markPatchesDirty();
        bindings.refreshUnderstoryStats();
      },
    });
  };

  const importedProps = stagedImport?.manifest.props ?? [];
  const hasImportedProps = importedProps.length > 0;
  const customPropsEnabled = searchParams.get("customProps") === "0"
    ? false
    : densityComposition !== null
      || hasImportedProps
      || searchParams.get("propEditor") === "1"
      || resolveCustomPropsEnabled(searchParams, customPropsConfig);
  let customProps: CustomPropsStartupResult | null = null;
  if (customPropsEnabled) {
    try {
      if (hasImportedProps) {
        projectPropEditStore.restore(importedProps);
      } else if (densityComposition && !hasLoadedSavePropAuthority()) {
        projectPropEditStore.restore(propPlacementSceneToProjectProps(densityComposition.propScene));
      } else if (shouldRestoreDefaultCustomProps({
        hasImportedProps,
        hasProjectProps: projectPropEditStore.hasProps(),
        hasLoadedSavePropAuthority: hasLoadedSavePropAuthority(),
      })) {
        const scenePreset = resolvePropPlacementScene(searchParams, propPlacementScenes, propPlacementScenes.smoke!);
        projectPropEditStore.restore(propPlacementSceneToProjectProps(scenePreset));
      }
      customProps = await runCustomPropsStartup({
        scene,
        camera,
        customPropsConfig,
        placementScene: projectPropEditStore.toPlacementScene(hasImportedProps ? "archive" : "active"),
        enabled: true,
        searchParams,
        getHooks,
        propEditStore: projectPropEditStore,
        gpuDevice: rendererWebGpuDevice,
        gpuBackend,
      });
    } catch (error) {
      console.error("[custom-props] failed to initialize", error);
    }
  } else {
    projectPropEditStore.clear();
  }

  let constructionController: ConstructionController | null = null;
  const constructionParam = searchParams.get("construction");
  const constructionEnabled = constructionParam === "1"
    ? true
    : constructionParam === "0"
      ? false
      : densityComposition !== null || defaultConstructionConfig.enabled;
  if (constructionEnabled) {
    const seededStorageKey = densityComposition ? benchmarkConstructionStorageKey(densityComposition) : null;
    try {
      const editAuthority = resolvePlayerEditAuthorityConfig(playerEditingConfigText, searchParams);
      const maxRayDistanceM = editAuthority.allowFarCommit
        ? defaultConstructionConfig.placement.maxRayDistanceM
        : Math.min(
            defaultConstructionConfig.placement.maxRayDistanceM,
            editAuthority.allowFarPreview ? editAuthority.buildPreviewRadiusM : editAuthority.buildCommitRadiusM,
          );
      const constructionUnboundedWorld = unboundedWorld;
      const constructionConfig = {
        ...defaultConstructionConfig,
        placement: {
          ...defaultConstructionConfig.placement,
          maxRayDistanceM,
          storageKey: seededStorageKey ?? defaultConstructionConfig.placement.storageKey,
          unboundedWorld: constructionUnboundedWorld,
        },
      };
      const constructionWorldCells = constructionUnboundedWorld ? Number.MAX_SAFE_INTEGER / 4 : worldCells;
      const counters = getHooks()?.stats?.counters ?? null;
      if (counters) {
        counters["player_build_preview_limit_m"] = maxRayDistanceM;
        counters["player_build_commit_limit_m"] = editAuthority.allowFarCommit
          ? maxRayDistanceM
          : editAuthority.buildCommitRadiusM;
        counters["player_build_unbounded_world"] = constructionUnboundedWorld ? 1 : 0;
      }
      const getBuildAuthorityOrigin = () => ({ x: camera.position.x, z: camera.position.z });
      const getBuildAuthorityCounters = () => getHooks()?.stats?.counters ?? null;
      const disposeGuard = installConstructionCommitGuard({
        domElement: app.renderer.domElement,
        camera,
        worldCells: constructionWorldCells,
        unboundedWorld: constructionUnboundedWorld,
        placement: constructionConfig.placement,
        editAuthority,
        getAuthorityOrigin: getBuildAuthorityOrigin,
        getCounters: getBuildAuthorityCounters,
        onRejected: (reason) => console.info(`[construction] placement rejected: ${reason}`),
      });
      if (seededStorageKey && densityComposition) {
        localStorage.setItem(seededStorageKey, JSON.stringify(densityComposition.pieces));
      }
      try {
        constructionController = withConstructionGuardDispose(createConstructionController({
          scene,
          camera,
          rendererDomElement: app.renderer.domElement,
          worldCells: constructionWorldCells,
          config: constructionConfig,
          editAuthority,
          getAuthorityOrigin: getBuildAuthorityOrigin,
          getAuthorityCounters: getBuildAuthorityCounters,
        }), disposeGuard);
      } catch (error) {
        disposeGuard();
        throw error;
      } finally {
        if (seededStorageKey) localStorage.removeItem(seededStorageKey);
      }
    } catch (error) {
      console.error("[construction] failed to initialize", error);
      if (seededStorageKey) localStorage.removeItem(seededStorageKey);
    }
  }

  return {
    ...vegetation,
    ...waterWeather,
    ...forestLighting,
    updateLighting,
    drainVegetationDirtyQueue,
    customProps,
    constructionController,
  };
}
