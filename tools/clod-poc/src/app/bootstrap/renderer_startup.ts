import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createWebGlAppRenderer,
  createWebGpuAppRenderer,
  parseRendererBackend,
} from "../../rendering/renderer_backend.js";
import { getRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import { failLoud } from "../../core/diagnostics.js";
import { TerrainColliderSet, type TerrainColliderPage } from "../../terrain/terrain_collider.js";
import {
  PlayerController,
  PlayerInteractionState,
} from "../../player_controller.js";
import { createTerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { surfaceHeight } from "../../terrain/terrain.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { Phase0SceneConfig } from "../../phase0/phase0_config.js";
import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";
import borderOceanSceneConfigText from "../../../config/border_ocean_scene.yaml?raw";
import {
  parseBorderOceanCamString,
  parseBorderOceanSceneConfig,
} from "../../debug/border_ocean_scene.js";

export type AppRenderer = Awaited<ReturnType<typeof createWebGpuAppRenderer>> | ReturnType<typeof createWebGlAppRenderer>;

export interface RendererStartupInput {
  searchParams: URLSearchParams;
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
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  terrainColliders: TerrainColliderSet;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainRaycast: ReturnType<typeof createTerrainRaycastService>;
}

export async function runRendererStartup(input: RendererStartupInput): Promise<RendererStartupResult | null> {
  const {
    searchParams,
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
    failLoud("Renderer startup failed", details.join("\n"));
    return null;
  }

  const { renderer, scene, camera, controls } = app;
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const rendererWebGpuDevice = getRendererGpuDevice(renderer);
  const isWebGpu = rendererBackend === "webgpu";
  const poolTerrainMaterial = searchParams.get("poolTerrainMaterial") !== "0";

  const spawnX = stagedImport?.manifest.camera.position[0] ?? worldCells * 0.5;
  const spawnZ = stagedImport?.manifest.camera.position[2] ?? worldCells * 0.5;
  const spawnY = stagedImport?.manifest.camera.position[1] ?? surfaceHeight(spawnX, spawnZ) + 12;
  camera.position.set(spawnX, spawnY, spawnZ);
  controls.target.set(
    stagedImport?.manifest.camera.target[0] ?? spawnX,
    stagedImport?.manifest.camera.target[1] ?? surfaceHeight(spawnX, spawnZ),
    stagedImport?.manifest.camera.target[2] ?? spawnZ - 16,
  );
  controls.update();

  const colliderPages: TerrainColliderPage[] = lod0Nodes.map((node) => ({
    id: node.id,
    mesh: node.mesh,
    footprint: node.footprint,
  }));
  const terrainColliders = new TerrainColliderSet(colliderPages);
  const terrainRaycast = createTerrainRaycastService(terrainColliders);
  const player = new PlayerController(camera, controls, terrainRaycast, { heightOffset: 2.2 });
  const interaction = new PlayerInteractionState();

  void cfg;
  void waterConfig;
  void queryGrassPerfScene;
  void queryTreePerfScene;
  void queryLongViewScene;
  void queryBorderOceanScene;
  void activePhase0Scene;
  void RIVER_PARITY_TEST_SCENE;
  void parseBorderOceanCamString;
  void borderOceanSceneConfig;

  return {
    app,
    renderer,
    maxAnisotropy,
    isWebGpu,
    rendererWebGpuDevice,
    poolTerrainMaterial,
    scene,
    camera,
    controls,
    terrainColliders,
    player,
    interaction,
    terrainRaycast,
  };
}
