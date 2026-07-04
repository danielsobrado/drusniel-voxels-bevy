import * as THREE from "three";
import { resolveWorldProfile } from "../../config/world_profile.js";
import { querySceneToWorldProfileKind, type QueryScene } from "./query_context.js";
import { loadPhase0Config, resolvePhase0StreamingConfig } from "../../phase0/config.js";
import { createProceduralTerrainConfig } from "../../terrain/terrain_config_factory.js";
import { createClodState } from "../state/clod_state.js";
import { createWorld } from "../../world.js";
import { buildRenderer } from "../../renderer/build_renderer.js";
import { createTerrainView } from "../../renderer/terrain_view.js";
import { createInputController } from "../../input/input_controller.js";
import { createPostRendererStartup } from "./post_renderer_startup.js";
import { createFrameLoop } from "../frame_loop/frame_loop.js";
import { resolveStreamingOwnership } from "../../systems/streaming_ownership.js";
import { isLongViewCapableScene } from "../../long-view/scene.js";
import { createDefaultLongViewConfig, longViewConfigToFarSummaryConfig } from "../../long-view/longViewConfig.js";
import { applyLongViewScenePreset } from "../../long-view/scenePresets.js";
import { applyOwnershipToFarShellRange } from "../../long-view/ownership.js";
import { initFarSummaryIntegration, type FarSummaryIntegration } from "../../far-summary/integration.js";
import { createFarShellMetrics, type FarShellMetrics } from "../../long-view/farShellMetrics.js";
import { InfiniteFarShell } from "../../systems/infinite_far_shell.js";
import { loadLongViewMaterialsConfig, parseQueryOverrides } from "../../long-view/materials/config.js";
import { configToUniformData } from "../../long-view/materials/uniforms.js";
import { initNaadfIntegration, type NaadfIntegration } from "../../naadf/integration.js";
import naadfConfigText from "../../../config/naadf.yaml?raw";
import { makeBiomeTextureStreamingController } from "../../renderer/biome_texture_streaming_controller.js";
import { createProceduralTextureConfig, makeBakedMacroTint, selectBiomeMaterialsAround } from "../../renderer/procedural_texture_config.js";
import { FloatingOrigin } from "../../renderer/floating_origin.js";
import type { ClodPocQueryContext } from "./query_context.js";

export interface ClodPocBootstrapResult {
  renderer: ReturnType<typeof buildRenderer>;
  frameLoop: ReturnType<typeof createFrameLoop>;
}

export function bootstrapClodPoc(queries: ClodPocQueryContext, searchParams: URLSearchParams): ClodPocBootstrapResult {
  const queryScene: QueryScene | null = queries.queryScene;
  const worldProfile = resolveWorldProfile({ kind: querySceneToWorldProfileKind(queryScene) });
  const phase0Config = queries.phase0Config;
  const resolvedPhase0Streaming = resolvePhase0StreamingConfig(phase0Config.phase0.streaming, queries.phase0TargetVisibleM);
  const phase0Streaming = queries.phase0Streaming ?? resolvedPhase0Streaming;
  const terrainConfig = createProceduralTerrainConfig({
    seed: queries.seed,
    profile: worldProfile,
    worldSizeChunks: queries.worldSizeChunks,
    phase0Config,
  });
  const state = createClodState({
    queryScene,
    worldSizeChunks: queries.worldSizeChunks,
    phase0Streaming,
  });
  const world = createWorld({
    cfg: state.cfg,
    seed: queries.seed,
    terrainConfig,
  });
  const renderer = buildRenderer({
    canvas: queries.canvas,
    state,
    world,
    queryContext: queries,
  });
  const floatingOrigin = new FloatingOrigin(renderer.scene, renderer.camera);
  const terrainView = createTerrainView({
    renderer,
    state,
    world,
    floatingOrigin,
    queryContext: queries,
  });
  const input = createInputController({
    canvas: queries.canvas,
    camera: renderer.camera,
    state,
    terrainView,
    queryContext: queries,
  });
  const postRenderer = createPostRendererStartup({
    renderer,
    state,
    world,
    terrainView,
    input,
    queryContext: queries,
    floatingOrigin,
  });

  const activeBiomeMaterials = selectBiomeMaterialsAround({
    worldSource: world.worldSource,
    centerX: 0,
    centerZ: 0,
    radiusM: 1024,
    maxBiomes: 4,
  });
  const initialProceduralTextureConfig = createProceduralTextureConfig(activeBiomeMaterials);
  world.proceduralTextureConfig = initialProceduralTextureConfig;
  world.proceduralTerrain = terrainConfig;
  world.bakedMacroTint = makeBakedMacroTint(initialProceduralTextureConfig);

  let terrainTextureWindowSwaps = 0;
  const biomeTextureStreaming = postRenderer.state.terrainMaterialSource === "procedural"
    ? makeBiomeTextureStreamingController({
        worldSource: world.worldSource,
        baseConfig: initialProceduralTextureConfig,
        updateDistanceM: 96,
        radiusM: 1024,
        maxBiomes: 4,
        onUpdate: (activeBiomeMaterials) => {
          const nextConfig = createProceduralTextureConfig(activeBiomeMaterials);
          const nextTerrain = createProceduralTerrainConfig({
            seed: queries.seed,
            profile: worldProfile,
            worldSizeChunks: queries.worldSizeChunks,
            phase0Config,
            activeBiomeMaterials,
          });
          const nextMacroTint = makeBakedMacroTint(nextConfig);
          world.proceduralTextureConfig = nextConfig;
          world.proceduralTerrain = nextTerrain;
          world.bakedMacroTint = nextMacroTint;
          terrainTextureWindowSwaps++;
          terrainView.materialController.setProceduralTerrain(nextTerrain, nextConfig, nextMacroTint);
          terrainView.applyTerrainTextures();
          if (postRenderer.longViewHooks?.stats) {
            postRenderer.longViewHooks.stats.counters.terrainTextureWindowSwaps = terrainTextureWindowSwaps;
            postRenderer.longViewHooks.stats.counters.terrainTextureActiveBiomes = activeBiomeMaterials.length;
          }
        },
      })
    : null;

  if (postRenderer.state.terrainMaterialSource === "procedural") {
    const initialWorldCamera = floatingOrigin.getWorldCamera(renderer.camera);
    biomeTextureStreaming?.update({ x: initialWorldCamera.position.x, z: initialWorldCamera.position.z, frameIndex: 0 });
  }

  let farSummaryIntegration: FarSummaryIntegration | undefined;
  let naadfIntegration: NaadfIntegration | undefined;

  const isNaadfCapable = queries.queryNaadfScene;
  const streamingOwnership = resolveStreamingOwnership({
    streaming: queries.phase0Streaming,
    targetVisibleM: queries.phase0TargetVisibleM,
    targetFutureVisibleM: queries.phase0Config.phase0.target_future_visible_m,
    pageSizeM: world.cfg.page.chunks_per_page * world.cfg.page.chunk_size,
    streamingScene: queryScene?.startsWith("infinite-") ?? false,
  });

  if (isNaadfCapable) {
    naadfIntegration = initNaadfIntegration({
      yamlText: naadfConfigText,
      sceneName: queryScene,
      threeScene: renderer.scene,
      forceEnable: queries.queryNaadfScene,
    }) ?? undefined;
  }

  const useNaadfFarSummary = Boolean(
    naadfIntegration?.config.farShell.useNaadfSummary
    && (queryScene?.startsWith("infinite-naadf-") ?? false),
  );
  const naadfHeightSamplingMode = useNaadfFarSummary
    ? naadfIntegration?.config.farShell.heightSamplingMode
    : undefined;

  let infiniteFarShell: InfiniteFarShell | undefined;
  let farShellMetrics: FarShellMetrics | undefined;

  if (isLongViewCapableScene(queryScene)) {
    const lvConfig = createDefaultLongViewConfig();
    applyLongViewScenePreset(lvConfig, queryScene, naadfIntegration);

    applyOwnershipToFarShellRange(lvConfig.farShell, streamingOwnership);

    farShellMetrics = createFarShellMetrics();
    farShellMetrics.farShellEnabled = true;
    farShellMetrics.farShellInnerM = lvConfig.farShell.startMeters;
    farShellMetrics.farShellOuterM = lvConfig.farShell.endMeters;
    farShellMetrics.farShellGridRes = lvConfig.farShell.radialSegments;

    if (!useNaadfFarSummary) {
      const seaLevel = world.worldSource.metadata.seaLevel;
      farSummaryIntegration = initFarSummaryIntegration({
        terrainSampler: {
          sampleHeight: (x: number, z: number) => world.worldSource.sampleHeight(x, z),
          sampleCanopyCoverage: (x, z) => naadfIntegration?.getCanopySampler().sampleCanopyCoverage(x, z) ?? 0,
          sampleWaterCoverageForHeight: (_x, _z, height) => height < seaLevel ? 1 : 0,
        },
        scene: renderer.scene,
        camera: renderer.camera,
        farShellController: terrainView.farShellController,
        farShellMetrics,
        config: longViewConfigToFarSummaryConfig(lvConfig),
      });
    }

    const heightProvider = useNaadfFarSummary && naadfIntegration
      ? naadfIntegration.getHeightProvider()
      : farSummaryIntegration?.getHeightProvider();
    const lighting = terrainView.currentLighting();

    const materialConfig = loadLongViewMaterialsConfig(undefined, parseQueryOverrides(searchParams));
    const parityConfig = materialConfig.enabled ? configToUniformData(materialConfig) : undefined;
    const useParity = materialConfig.enabled && parityConfig !== undefined;
    const farSummaryGpuAtlas = naadfHeightSamplingMode === "gpu"
      ? naadfIntegration?.getFarSummaryGpuAtlasView()
      : undefined;

    if (naadfHeightSamplingMode === "gpu" && !useParity) {
      throw new Error("NAADF GPU height mode requires the WebGPU parity far terrain material");
    }
    if (naadfHeightSamplingMode === "gpu" && !farSummaryGpuAtlas) {
      throw new Error("NAADF GPU height mode requires a far-summary GPU atlas");
    }

    const effectiveHeightSamplingMode = naadfHeightSamplingMode === "gpu"
      ? "gpu"
      : naadfHeightSamplingMode;
    if (!heightProvider && effectiveHeightSamplingMode !== "gpu") {
      throw new Error("long-view scene requires NAADF or far-summary height provider");
    }

    infiniteFarShell = new InfiniteFarShell({
      innerMeters: lvConfig.farShell.startMeters,
      outerMeters: lvConfig.farShell.endMeters,
      radialSegments: lvConfig.farShell.radialSegments,
      angularSegments: lvConfig.farShell.angularSegments,
      heightProvider,
      materialConfig: useParity ? materialConfig : undefined,
      uniformData: useParity ? parityConfig : undefined,
      gpuAtlas: farSummaryGpuAtlas,
      scene: renderer.scene,
      camera: renderer.camera,
      lighting,
      metrics: farShellMetrics,
    });
  }

  const frameLoop = createFrameLoop({
    renderer,
    state,
    world,
    terrainView,
    input,
    postRenderer,
    farSummaryIntegration,
    infiniteFarShell,
    farShellMetrics,
    floatingOrigin,
  });

  return { renderer, frameLoop };
}
