import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createWebGlAppRenderer,
  createWebGpuAppRenderer,
  parseRendererBackend,
} from "../../rendering/renderer_backend.js";
import { getRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import { installRealtimeSunShadows } from "../../rendering/realtime_sun_shadows.js";
import { createRenderResolutionRuntime, type RenderResolutionRuntime } from "../../rendering/render_resolution_runtime.js";
import { failLoud } from "../../core/diagnostics.js";
import { TerrainColliderSet, type TerrainColliderPage } from "../../terrain/terrain_collider.js";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  PlayerInteractionState,
  type HorizontalWorldBounds,
  validatePlayerWorldBoundsFit,
} from "../../player_controller.js";
import {
  parseBorderOceanGameplayConfig,
  resolvePlayerConfigForBorderOcean,
} from "../../player/border_ocean_player_config.js";
import { createTerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { surfaceHeight } from "../../terrain/terrain.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { Phase0SceneConfig } from "../../phase0/phase0_config.js";
import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";
import { parseClodRuntimeConfig, type ClodRuntimeConfig } from "../runtime_config.js";
import borderOceanSceneConfigText from "../../../config/border_ocean_scene.yaml?raw";
import borderCoastOceanConfigText from "../../../config/border_coast_ocean.yaml?raw";
import {
  parseBorderOceanCamString,
  parseBorderOceanSceneConfig,
} from "../../debug/border_ocean_scene.js";

export type AppRenderer = Awaited<ReturnType<typeof createWebGpuAppRenderer>> | ReturnType<typeof createWebGlAppRenderer>;

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_PLAYER_WORLD_RADIUS_M = 1_000_000_000;

export interface RendererStartupInput {
  searchParams: URLSearchParams;
  clodRuntime?: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  worldCells: number;
  lod0Nodes: ClodPageNode[];
  waterConfig: WaterConfig;
  stagedImport: VoxelProjectArchiveContents | null;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryLongViewScene: boolean;
  queryBorderOceanScene: boolean;
  activePhase0Scene: Phase0SceneConfig | undefined;
}

export interface RendererStartupResult {
  app: AppRenderer;
  renderer: AppRenderer["renderer"];
  maxAnisotropy: number;
  isWebGpu: boolean;
  rendererWebGpuDevice: GPUDevice | null;
  poolTerrainMaterial: boolean;
  renderResolution: RenderResolutionRuntime;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  terrainColliders: TerrainColliderSet;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainRaycast: ReturnType<typeof createTerrainRaycastService>;
}

export function playerWorldBoundsForScene(searchParams: URLSearchParams, worldCells: number): HorizontalWorldBounds {
  if (searchParams.get("scene") !== INFINITE_ISLANDS_SCENE) {
    return { minX: 0, minZ: 0, maxX: worldCells, maxZ: worldCells };
  }
  return {
    minX: -INFINITE_PLAYER_WORLD_RADIUS_M,
    minZ: -INFINITE_PLAYER_WORLD_RADIUS_M,
    maxX: INFINITE_PLAYER_WORLD_RADIUS_M,
    maxZ: INFINITE_PLAYER_WORLD_RADIUS_M,
  };
}

export async function runRendererStartup(input: RendererStartupInput): Promise<RendererStartupResult | null> {
  const {
    searchParams,
    clodRuntime,
    cfg,
    worldCells,
    lod0Nodes,
    waterConfig,
    stagedImport,
    queryGrassPerfScene,
    queryTreePerfScene,
    queryLongViewScene,
    queryBorderOceanScene,
    activePhase0Scene,
  } = input;

  const borderOceanSceneConfig = parseBorderOceanSceneConfig(borderOceanSceneConfigText);
  const borderOceanGameplayConfig = parseBorderOceanGameplayConfig(borderCoastOceanConfigText);
  const playerConfig = resolvePlayerConfigForBorderOcean(
    DEFAULT_PLAYER_CONFIG,
    borderOceanGameplayConfig,
  );
  const playerBounds = playerWorldBoundsForScene(searchParams, worldCells);
  validatePlayerWorldBoundsFit(playerBounds, playerConfig);

  const rendererBackend = parseRendererBackend(searchParams);
  let app: AppRenderer;
  try {
    app = rendererBackend === "webgpu" ? await createWebGpuAppRenderer() : createWebGlAppRenderer();
  } catch (error) {
    const details = [
      error instanceof Error ? error.message : String(error),
      "",
      "Recovery:",
      "- Hard-reload after closing other tabs that used this WebGPU app.",
      "- If Chrome keeps reporting DXGI_ERROR_DEVICE_HUNG, restart the browser.",
      "- Use ?renderer=webgl to open the app without WebGPU.",
    ];
    failLoud("Renderer startup failed", details);
    return null;
  }

  const renderer = app.renderer;
  const maxAnisotropy = app.maxAnisotropy;
  const isWebGpu = app.isWebGpu;
  const rendererWebGpuDevice = getRendererGpuDevice(app);
  const rootTransitionEnabled = searchParams.get("liveClodRootTransition") === "1";
  const poolTerrainMaterial = isWebGpu && cfg.selection.transition_mode === "instant" && !rootTransitionEnabled;
  const runtimeConfig = clodRuntime ?? parseClodRuntimeConfig();
  const renderResolution = createRenderResolutionRuntime(
    runtimeConfig.renderResolution,
    searchParams,
  );
  const initialRenderResolution = renderResolution.resolveCurrentViewport();

  renderer.setPixelRatio(initialRenderResolution.effectivePixelRatio);
  renderer.setSize(initialRenderResolution.cssWidth, initialRenderResolution.cssHeight);
  renderResolution.markApplied(initialRenderResolution);
  window.__drusnielRenderResolution = renderResolution;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  let anyBodyInWorld = false;
  for (const lake of waterConfig.fakeBodies.lakes) {
    if (lake.center[0] >= 0 && lake.center[0] <= worldCells && lake.center[1] >= 0 && lake.center[1] <= worldCells) {
      anyBodyInWorld = true;
      break;
    }
  }
  if (!anyBodyInWorld) {
    for (const river of waterConfig.fakeBodies.rivers) {
      for (const p of river.points) {
        if (p[0] >= 0 && p[0] <= worldCells && p[1] >= 0 && p[1] <= worldCells) {
          anyBodyInWorld = true;
          break;
        }
      }
      if (anyBodyInWorld) break;
    }
  }
  if (queryBorderOceanScene) {
    const parsedCam = parseBorderOceanCamString(searchParams.get("cam"));
    const cam = parsedCam ?? borderOceanSceneConfig.camera;
    camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
  }
  if (queryLongViewScene && activePhase0Scene?.camera) {
    camera.position.set(...activePhase0Scene.camera.position);
    controls.target.set(...activePhase0Scene.camera.target);
  }
  if (searchParams.get("scene") === INFINITE_ISLANDS_SCENE && searchParams.has("x") && searchParams.has("z")) {
    const x = Number(searchParams.get("x"));
    const z = Number(searchParams.get("z"));
    if (Number.isFinite(x) && Number.isFinite(z)) {
      const y = Number(searchParams.get("y"));
      const yaw = Number(searchParams.get("yaw") ?? 0);
      const height = Number.isFinite(y) ? y : Math.max(40, surfaceHeight(x, z) + 18);
      camera.position.set(x, height, z);
      controls.target.set(x + Math.sin(yaw) * 80, height - 12, z + Math.cos(yaw) * 80);
    }
  }

  if (queryGrassPerfScene || queryTreePerfScene || queryLongViewScene) {
    const center = lod0Nodes[0]?.bounds.center;
    if (center && searchParams.get("scene") !== INFINITE_ISLANDS_SCENE && !activePhase0Scene?.camera) {
      const y = center[1] + (queryLongViewScene ? 110 : 38);
      const z = center[2] + (queryLongViewScene ? 220 : 54);
      camera.position.set(center[0] + 12, y, z);
      controls.target.set(center[0], center[1], center[2]);
    }
  }
  if (searchParams.get("scene") === RIVER_PARITY_TEST_SCENE) {
    camera.position.set(worldCells * 0.48, 54, worldCells * 0.56);
    controls.target.set(worldCells * 0.50, 19, worldCells * 0.50);
  }
  controls.update();

  installRealtimeSunShadows({ renderer, scene, searchParams });

  const terrainColliders = new TerrainColliderSet();
  const terrainRaycast = createTerrainRaycastService(terrainColliders);
  if (!anyBodyInWorld && !queryBorderOceanScene) {
    console.warn("[water] no configured water bodies intersect this world; water overlay may be empty", {
      worldCells,
      lakes: waterConfig.fakeBodies.lakes.length,
      rivers: waterConfig.fakeBodies.rivers.length,
    });
  }
  if (!queryBorderOceanScene) {
    lod0Nodes.forEach((n) => terrainColliders.addPage({ id: n.id, mesh: n.mesh } as TerrainColliderPage));
  }

  const player = new PlayerController(playerConfig, playerBounds);
  const interaction: PlayerInteractionState = { mode: "orbit" };

  return {
    app,
    renderer,
    maxAnisotropy,
    isWebGpu,
    rendererWebGpuDevice,
    poolTerrainMaterial,
    renderResolution,
    scene,
    camera,
    controls,
    terrainColliders,
    player,
    interaction,
    terrainRaycast,
  };
}
