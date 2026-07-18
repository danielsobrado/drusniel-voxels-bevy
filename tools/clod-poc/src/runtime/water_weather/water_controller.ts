import * as THREE from "three";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../../stones/stone_validation.js";
import {
  WATER_DEBUG_MODES,
  WaterClipmap,
  WaterField,
  type WaterDebugState,
} from "../../water/index.js";
import { defaultWaterDebugState } from "../../water/waterDebug.js";
import { createWaterShaderMaterial } from "../../water/waterMaterial.js";
import { resolveWaterQualityTier } from "../../water/water_quality_overrides.js";
import { createHydrologyTileRemoteBuilder } from "../../water/hydrology_tile_worker_client.js";
import {
  WaterHydrologyAtlasRuntime,
  waterAtlasLevelCellSizes,
  waterAtlasTilesPerSide,
} from "../../water/waterHydrologyAtlasRuntime.js";
import { resolveWaterReflectionPolicy } from "../../water/waterReflectionPolicy.js";
import { getDigEditRevision, getTerrainFieldConfig } from "../../terrain/terrain.js";
import { RiverBankResidueOverlay } from "../../water/riverBankResidueOverlay.js";
import { RiverCascadeParticleOverlay } from "../../water/riverCascadeParticleOverlay.js";
import {
  EditedWaterAuthoritySource,
  createCanonicalWaterAuthority,
  createHydrologyWaterSource,
  createLegacyWaterFieldSource,
} from "../../water/water_authority.js";
import type {
  WaterDebugPoseHooks,
  WaterControllerDeps,
  WaterController,
  WaterRuntimeFeatures,
} from "./water_controller_types.js";
import { readShoreSurfSettings, deepOceanClipmapExclusionDistance } from "./water_controller_params.js";
import { installWaterDebugApi, logWaterDevInit } from "./water_controller_debug.js";

export type {
  WaterControllerUiState,
  WaterDebugPoseHooks,
  WaterControllerDeps,
  WaterController,
  WaterRuntimeFeatures,
} from "./water_controller_types.js";
export { readShoreSurfSettings, deepOceanClipmapExclusionDistance } from "./water_controller_params.js";
export { installWaterDebugApi, logWaterDevInit } from "./water_controller_debug.js";

export async function createWaterController(deps: WaterControllerDeps): Promise<WaterController> {
  const pageSignaturesBefore = pageMeshSignatures(deps.nodes);
  const field = new WaterField(deps.waterConfig, { surfaceHeight: deps.surfaceHeight }, deps.hydrologySystem, deps.worldCells);
  const editedWater = new EditedWaterAuthoritySource();
  const generatedWater = deps.hydrologySystem
    ? createHydrologyWaterSource(deps.hydrologySystem, getDigEditRevision)
    : createLegacyWaterFieldSource(field, getDigEditRevision, 0.05, deps.waterConfig);
  const authority = createCanonicalWaterAuthority([editedWater, generatedWater]);
  const shoreSurfSettings = readShoreSurfSettings(deps.searchParams, deps.borderCoastOceanConfig);
  const clipmapExclusionDistance = deepOceanClipmapExclusionDistance(deps.searchParams, deps.borderCoastOceanConfig);
  field.setShoreSurfBand(shoreSurfSettings);
  field.setClipmapExclusionBand({
    enabled: clipmapExclusionDistance > 0,
    distance: clipmapExclusionDistance,
  });
  const waterQuality = resolveWaterQualityTier(deps.searchParams);
  const useHighQualityWebGpuWater = deps.isWebGpu && waterQuality === "high";
  const requestedReflection = useHighQualityWebGpuWater
    ? { ...deps.waterConfig.visual.reflection, mode: "ssr" as const, ssrEnabled: true }
    : deps.waterConfig.visual.reflection;
  const reflectionPolicy = resolveWaterReflectionPolicy(
    requestedReflection,
    deps.isWebGpu ? "webgpu" : "webgl",
  );
  const clipmapVisual = useHighQualityWebGpuWater
    ? {
        ...deps.waterConfig.visual,
        reflection: {
          ...requestedReflection,
          ssrEnabled: reflectionPolicy.ssrActive,
        },
      }
    : deps.waterConfig.visual;
  const waterMaterialFactory = deps.isWebGpu
    ? useHighQualityWebGpuWater
      ? (await import("../../water/waterNodeMaterial.js")).createWaterNodeMaterialImpl
      : (await import("../../water/waterPerfNodeMaterial.js")).createWaterPerfNodeMaterial
    : createWaterShaderMaterial;
  const clipmapWaterConfig = useHighQualityWebGpuWater
    ? {
        ...deps.waterConfig,
        visual: clipmapVisual,
      }
    : deps.waterConfig;
  const infiniteWorldWater = deps.hydrologySystem?.supportsInfiniteWorldSamples() === true;

  const tileBypassCellSize = deps.hydrologySystem?.tileCoarseBypassCellSize() ?? null;
  const tileRemoteAuthority = deps.hydrologySystem?.tileRemoteAuthority() ?? null;
  const hydrologyRemote = tileBypassCellSize !== null && tileRemoteAuthority
    ? createHydrologyTileRemoteBuilder()
    : null;
  let hydrologyPrefetchRadiusM = 0;
  if (hydrologyRemote && deps.hydrologySystem) {
    const fakeBodies = deps.hydrologySystem.unifiedStartupActive()
      ? { ...deps.waterConfig.fakeBodies, carveTerrain: false }
      : deps.waterConfig.fakeBodies;
    hydrologyRemote.configure({
      terrainFieldConfig: getTerrainFieldConfig(),
      fakeBodies,
      tileSizeM: deps.waterConfig.hydrology.infinite.tileSizeM,
      tileRes: deps.waterConfig.hydrology.infinite.tileRes,
      drySentinelDepthM: deps.waterConfig.hydrology.waterSurface.drySentinelDepth,
      hydrologyGraph: tileRemoteAuthority!.graph,
      hydrologyCarve: tileRemoteAuthority!.carve,
    });
    deps.hydrologySystem.attachTileRemote(hydrologyRemote);
    for (const cellSize of deps.waterConfig.cellSizes) {
      if (cellSize <= tileBypassCellSize!) {
        hydrologyPrefetchRadiusM = Math.max(
          hydrologyPrefetchRadiusM,
          (cellSize * deps.waterConfig.cellsPerLevel) / 2,
        );
      }
    }
  }

  // Atlas-driven levels (Phase W2, WebGPU + static topology only): a water-owned
  // streaming-atlas window follows the camera, and the rings it can cover fetch their
  // vertex data from it in the vertex stage — zero CPU refill samples on those levels.
  // Gated on the tile build worker being up: the atlas fills exclusively from
  // worker-built tiles, so without the remote those levels would never get water.
  const staticTopologyEnabled = deps.waterConfig.staticTopology
    && deps.searchParams.get("waterStaticClipmap") !== "0";
  const atlasSource = deps.isWebGpu
    && staticTopologyEnabled
    && hydrologyRemote !== null
    && deps.searchParams.get("waterAtlasClipmap") !== "0"
    ? deps.hydrologySystem?.tileAtlasSource() ?? null
    : null;
  const atlasLevelCellSizes = waterAtlasLevelCellSizes(
    deps.waterConfig.cellSizes,
    tileBypassCellSize ?? 0,
  );
  const atlasLevelHalfSpans = atlasLevelCellSizes
    .map((cellSize) => (cellSize * deps.waterConfig.cellsPerLevel) / 2);
  const atlasMaxSnapOffsetM = atlasLevelCellSizes.reduce(
    (maxOffset, cellSize) => Math.max(maxOffset, cellSize * deps.waterConfig.snapCells),
    0,
  );
  const waterAtlas = atlasSource && atlasLevelHalfSpans.length > 0
    ? new WaterHydrologyAtlasRuntime(
        atlasSource,
        waterAtlasTilesPerSide(
          Math.max(...atlasLevelHalfSpans),
          atlasSource.tileSizeM,
          atlasMaxSnapOffsetM,
        ),
      )
    : null;
  // The far clipmap already owns unified water beyond its inner radius. When the
  // WebGPU atlas is active, keep only its near rings and avoid CPU refills for the
  // overlapping coarse L4/L5 rings. WebGL and the atlas kill switch retain all rings.
  // Built from clipmapWaterConfig so the tier-resolved visual (active SSR) survives.
  const clipmapConfig = waterAtlas
    ? { ...clipmapWaterConfig, cellSizes: atlasLevelCellSizes }
    : clipmapWaterConfig;
  const maxClipmapCellSize = clipmapConfig.cellSizes.reduce(
    (maxCellSize, cellSize) => Math.max(maxCellSize, cellSize),
    0,
  );
  const clipmapOuterHalfSpanM = maxClipmapCellSize * clipmapConfig.cellsPerLevel * 0.5;
  const clipmapMaxSnapOffsetM = maxClipmapCellSize * clipmapConfig.snapCells;
  const runtimeFeatures: WaterRuntimeFeatures = {
    highQualityMaterial: useHighQualityWebGpuWater,
    ssr: useHighQualityWebGpuWater
      && reflectionPolicy.ssrActive
      && clipmapWaterConfig.visual.reflection.maxSteps > 0,
    refraction: useHighQualityWebGpuWater
      && clipmapWaterConfig.visual.refraction.enabled
      && clipmapWaterConfig.visual.refraction.strength > 0,
    caustics: useHighQualityWebGpuWater
      && clipmapWaterConfig.caustics.enabled
      && clipmapWaterConfig.caustics.gain > 0,
    atlasDrivenLevelCount: waterAtlas ? atlasLevelCellSizes.length : 0,
    clipmapOuterHalfSpanM,
    clipmapGuaranteedHalfSpanM: Math.max(0, clipmapOuterHalfSpanM - clipmapMaxSnapOffsetM),
  };
  const clipmap = new WaterClipmap({
    scene: deps.scene,
    config: clipmapConfig,
    field,
    createMaterial: waterMaterialFactory,
    sunDirection: deps.getSunDirection().clone(),
    cameraPosition: deps.camera.position as THREE.Vector3,
    worldBounds: infiniteWorldWater
      ? { cellsX: 0, cellsZ: 0 }
      : { cellsX: deps.worldCells, cellsZ: deps.worldCells },
    staticTopology: staticTopologyEnabled,
    atlasRuntime: waterAtlas,
  });
  const residueOverlay = new RiverBankResidueOverlay(deps.scene, field);
  const cascadeParticles = new RiverCascadeParticleOverlay(deps.scene, field);

  const ui = deps.getUiState();
  clipmap.setVisible(ui.waterEnabled);
  residueOverlay.setVisible(ui.waterEnabled);
  cascadeParticles.setVisible(ui.waterEnabled);
  clipmap.setClipmapTint(ui.waterClipmapTint);
  clipmap.setWireframe(ui.waterWireframe);
  assertPageMeshSignaturesUnchanged(pageSignaturesBefore, pageMeshSignatures(deps.nodes));

  const devLogged = { value: false };
  const debugState: WaterDebugState = {
    ...defaultWaterDebugState({
      ...clipmapWaterConfig.visual,
      depthWrite: ui.waterDepthWrite,
    }),
    enabled: ui.waterEnabled,
    mode: ui.waterDebugMode,
    clipmapTint: ui.waterClipmapTint,
    wireframe: ui.waterWireframe,
    depthWrite: ui.waterDepthWrite,
    shoreSurfEnabled: shoreSurfSettings.enabled,
    shoreSurfStartDistance: shoreSurfSettings.startDistance,
    shoreSurfFullDistance: shoreSurfSettings.fullSurfDistance,
    shoreSurfMaxDepth: shoreSurfSettings.maxShallowDepth,
    riverSource: deps.waterConfig.source,
  };

  const makeVisual = () => ({
    ...clipmapWaterConfig.visual,
    depthWrite: deps.getUiState().waterDepthWrite,
  });

  const applyShoreSurfDebugState = () => {
    field.setShoreSurfBand({
      enabled: debugState.shoreSurfEnabled,
      startDistance: debugState.shoreSurfStartDistance,
      fullSurfDistance: debugState.shoreSurfFullDistance,
      maxShallowDepth: debugState.shoreSurfMaxDepth,
    });
    clipmap.update(0, deps.camera.position as THREE.Vector3);
  };

  const controller: WaterController = {
    field,
    clipmap,
    authority,
    editedWater,
    debugState,
    runtimeFeatures,
    makeVisual,
    setVisible(enabled) {
      clipmap.setVisible(enabled);
      residueOverlay.setVisible(enabled);
      cascadeParticles.setVisible(enabled);
    },
    setDebugMode(mode) {
      clipmap.setDebugMode(WATER_DEBUG_MODES[mode]);
    },
    setClipmapTint(enabled) {
      clipmap.setClipmapTint(enabled);
    },
    setWireframe(enabled) {
      clipmap.setWireframe(enabled);
    },
    setShoreSurfEnabled(enabled) {
      debugState.shoreSurfEnabled = enabled;
      applyShoreSurfDebugState();
    },
    setShoreSurfStartDistance(distance) {
      debugState.shoreSurfStartDistance = Math.max(1, distance);
      applyShoreSurfDebugState();
    },
    setShoreSurfFullDistance(distance) {
      debugState.shoreSurfFullDistance = Math.max(0, distance);
      applyShoreSurfDebugState();
    },
    setShoreSurfMaxDepth(depth) {
      debugState.shoreSurfMaxDepth = Math.max(0.01, depth);
      applyShoreSurfDebugState();
    },
    updateVisual(visual) {
      clipmap.updateVisual(visual);
    },
    updateSunDirection(direction) {
      clipmap.updateSunDirection(direction);
    },
    update(deltaSeconds, cameraPosition) {
      if (hydrologyPrefetchRadiusM > 0) {
        deps.hydrologySystem?.prefetchTiles(cameraPosition.x, cameraPosition.z, hydrologyPrefetchRadiusM);
      }
      waterAtlas?.update(cameraPosition.x, cameraPosition.z);
      clipmap.update(deltaSeconds, cameraPosition);
      residueOverlay.update(deltaSeconds, cameraPosition);
      cascadeParticles.update(deltaSeconds, cameraPosition);
    },
    getCascadeParticleStats() {
      return cascadeParticles.getStats();
    },
    installDebugApi(hooks: WaterDebugPoseHooks) {
      installWaterDebugApi(deps, field, clipmap, cascadeParticles, debugState, applyShoreSurfDebugState, hooks);
    },
    logDevInitOnce() {
      logWaterDevInit(clipmap, deps, field, cascadeParticles, devLogged);
    },
    dispose() {
      deps.hydrologySystem?.attachTileRemote(null);
      hydrologyRemote?.dispose();
      cascadeParticles.dispose();
      residueOverlay.dispose();
      clipmap.dispose();
      waterAtlas?.dispose();
    },
  };

  return controller;
}
