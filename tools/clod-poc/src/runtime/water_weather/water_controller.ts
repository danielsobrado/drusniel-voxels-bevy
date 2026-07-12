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
import { createHydrologyTileRemoteBuilder } from "../../water/hydrology_tile_worker_client.js";
import { getTerrainFieldConfig } from "../../terrain/terrain.js";
import { RiverBankResidueOverlay } from "../../water/riverBankResidueOverlay.js";
import { RiverCascadeParticleOverlay } from "../../water/riverCascadeParticleOverlay.js";
import type { WaterDebugPoseHooks, WaterControllerDeps, WaterController } from "./water_controller_types.js";
import { readShoreSurfSettings, deepOceanClipmapExclusionDistance } from "./water_controller_params.js";
import { installWaterDebugApi, logWaterDevInit } from "./water_controller_debug.js";

export type { WaterControllerUiState, WaterDebugPoseHooks, WaterControllerDeps, WaterController } from "./water_controller_types.js";
export { readShoreSurfSettings, deepOceanClipmapExclusionDistance } from "./water_controller_params.js";
export { installWaterDebugApi, logWaterDevInit } from "./water_controller_debug.js";

export async function createWaterController(deps: WaterControllerDeps): Promise<WaterController> {
  const pageSignaturesBefore = pageMeshSignatures(deps.nodes);
  const field = new WaterField(deps.waterConfig, { surfaceHeight: deps.surfaceHeight }, deps.hydrologySystem, deps.worldCells);
  const shoreSurfSettings = readShoreSurfSettings(deps.searchParams, deps.borderCoastOceanConfig);
  const clipmapExclusionDistance = deepOceanClipmapExclusionDistance(deps.searchParams, deps.borderCoastOceanConfig);
  field.setShoreSurfBand(shoreSurfSettings);
  field.setClipmapExclusionBand({
    enabled: clipmapExclusionDistance > 0,
    distance: clipmapExclusionDistance,
  });
  const useHighQualityWebGpuWater = deps.searchParams.get("waterHq") === "1" || deps.searchParams.get("waterQuality") === "high";
  const waterMaterialFactory = deps.isWebGpu
    ? useHighQualityWebGpuWater
      ? (await import("../../water/waterNodeMaterial.js")).createWaterNodeMaterialImpl
      : (await import("../../water/waterPerfNodeMaterial.js")).createWaterPerfNodeMaterial
    : createWaterShaderMaterial;
  // When hydrology can answer outside the startup world (infinite-islands), the clipmap
  // and water shaders must not clamp water to [0, worldCells]²: cellsX/Z = 0 is the
  // designed "unbounded" sentinel (finiteWorldBounds checks `> 0`). Otherwise the camera
  // spawn region beyond the original world renders no water at all.
  const infiniteWorldWater = deps.hydrologySystem?.supportsInfiniteWorldSamples() === true;
  const clipmap = new WaterClipmap({
    scene: deps.scene,
    config: deps.waterConfig,
    field,
    createMaterial: waterMaterialFactory,
    sunDirection: deps.getSunDirection().clone(),
    cameraPosition: deps.camera.position as THREE.Vector3,
    worldBounds: infiniteWorldWater
      ? { cellsX: 0, cellsZ: 0 }
      : { cellsX: deps.worldCells, cellsZ: deps.worldCells },
    staticTopology: deps.waterConfig.staticTopology
      && deps.searchParams.get("waterStaticClipmap") !== "0",
  });
  const residueOverlay = new RiverBankResidueOverlay(deps.scene, field);
  const cascadeParticles = new RiverCascadeParticleOverlay(deps.scene, field);

  // A hydrology tile built synchronously inside a clipmap refill costs 100–250 ms of
  // main-thread CPU (a frame spike during traversal). The build worker keeps the tiles
  // the fine rings will need resident ahead of the camera; the synchronous path stays
  // as the bit-identical fallback. Prefetch must cover the largest ring that samples
  // through the tile cache (cellSize <= the cache's coarse bypass threshold).
  const tileBypassCellSize = deps.hydrologySystem?.tileCoarseBypassCellSize() ?? null;
  const hydrologyRemote = tileBypassCellSize !== null ? createHydrologyTileRemoteBuilder() : null;
  let hydrologyPrefetchRadiusM = 0;
  if (hydrologyRemote && deps.hydrologySystem) {
    hydrologyRemote.configure({
      terrainFieldConfig: getTerrainFieldConfig(),
      fakeBodies: deps.waterConfig.fakeBodies,
      tileSizeM: deps.waterConfig.hydrology.infinite.tileSizeM,
      tileRes: deps.waterConfig.hydrology.infinite.tileRes,
      drySentinelDepthM: deps.waterConfig.hydrology.waterSurface.drySentinelDepth,
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
      ...deps.waterConfig.visual,
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
    ...deps.waterConfig.visual,
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
    debugState,
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
      // Adopt worker-built tiles and queue the next ring of prefetches before the
      // clipmap refill samples, so refills this frame already find tiles resident.
      if (hydrologyPrefetchRadiusM > 0) {
        deps.hydrologySystem?.prefetchTiles(cameraPosition.x, cameraPosition.z, hydrologyPrefetchRadiusM);
      }
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
    },
  };

  return controller;
}
