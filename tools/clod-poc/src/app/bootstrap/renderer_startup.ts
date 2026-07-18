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
import { appColumnCertified, createAppCellReadinessFeeds, movementReadinessAt } from "../../player/cell_readiness.js";
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
import { defaultStartupCameraPose } from "./infinite_islands_startup_camera.js";
import borderOceanSceneConfigText from "../../../config/border_ocean_scene.yaml?raw";
import borderCoastOceanConfigText from "../../../config/border_coast_ocean.yaml?raw";
import {
  parseBorderOceanCamString,
  parseBorderOceanSceneConfig,
} from "../../debug/border_ocean_scene.js";
import {
  isRpgDensityScene,
  rpgDensitySceneCenter,
  type RpgDensitySceneId,
} from "../../scenes/rpg_density_scenes.js";

export type AppRenderer = Awaited<ReturnType<typeof createWebGpuAppRenderer>> | ReturnType<typeof createWebGlAppRenderer>;

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const CONTINENT_SCENE = "continent";
const CAVE_TEST_SCENE = "cave-test";
const INFINITE_PLAYER_WORLD_RADIUS_M = 1_000_000_000;

function usesUnboundedTerrain(scene: string | null): boolean {
  return scene === INFINITE_ISLANDS_SCENE || scene === CAVE_TEST_SCENE || scene === CONTINENT_SCENE;
}

/** RPG density route sites are absolute metres; phase0 ratios assume the full authored domain. */
function rpgDensityCameraTarget(searchParams: URLSearchParams): { x: number; z: number } | null {
  const sceneId = searchParams.get("rpgDensityScene");
  if (!isRpgDensityScene(sceneId)) return null;
  return rpgDensitySceneCenter(sceneId as RpgDensitySceneId);
}

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
  if (!usesUnboundedTerrain(searchParams.get("scene"))) {
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
      "- Restart the browser if the WebGPU device keeps failing.",
      "- Use ?renderer=webgl to open the app without WebGPU.",
    ];
    failLoud("Renderer startup failed", details);
    return null;
  }

  const renderer = app.renderer;
  const maxAnisotropy = app.maxAnisotropy;
  const isWebGpu = app.isWebGpu;
  const rendererWebGpuDevice = getRendererGpuDevice(app);
  const poolTerrainMaterial = isWebGpu;
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
  (window as unknown as { __drusnielScene?: THREE.Scene }).__drusnielScene = scene;
  let anyBodyInWorld = false;
  for (const lake of waterConfig.fakeBodies.lakes) {
    if (lake.center[0] >= 0 && lake.center[0] <= worldCells && lake.center[1] >= 0 && lake.center[1] <= worldCells) {
      anyBodyInWorld = true;
      break;
    }
  }
  if (!anyBodyInWorld) {
    for (const river of waterConfig.fakeBodies.rivers) {
      for (const pt of river.points) {
        if (pt[0] >= 0 && pt[0] <= worldCells && pt[1] >= 0 && pt[1] <= worldCells) {
          anyBodyInWorld = true;
          break;
        }
      }
      if (anyBodyInWorld) break;
    }
  }
  if (waterConfig.enabled && !anyBodyInWorld && (waterConfig.fakeBodies.lakes.length > 0 || waterConfig.fakeBodies.rivers.length > 0)) {
    console.warn("[water] no fake water bodies inside world bounds; water will be invisible");
  }

  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(
    55,
    initialRenderResolution.cssWidth / initialRenderResolution.cssHeight,
    0.5,
    8000,
  );
  const startupPose = defaultStartupCameraPose(searchParams.get("scene"), worldCells);
  camera.position.fromArray(startupPose.eye);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.fromArray(startupPose.target);
  camera.lookAt(controls.target);
  controls.update();

  // Infinite-islands: honour cam=x,y,z[,yaw,pitch[,fov]] (the long-view/acceptance URL
  // format) so inspection URLs teleport the startup orbit camera instead of silently
  // ignoring the parameter. x/z spawn params still control the (gated) player spawn.
  if (searchParams.get("scene") === "infinite-islands") {
    const camParam = searchParams.get("cam");
    const parts = camParam ? camParam.split(",").map(Number) : [];
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      camera.position.set(parts[0], parts[1], parts[2]);
      camera.rotation.set(parts[4] ?? 0, parts[3] ?? 0, 0, "YXZ");
      if (parts[5]) {
        camera.fov = parts[5];
        camera.updateProjectionMatrix();
      }
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      controls.target.copy(camera.position).addScaledVector(forward, 120);
      controls.update();
    }
  }

  if (stagedImport) {
    camera.position.fromArray(stagedImport.manifest.camera.position);
    controls.target.fromArray(stagedImport.manifest.camera.target);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryGrassPerfScene) {
    controls.target.set(mid, 20, mid);
    camera.position.set(mid - worldCells * 0.24, 46, mid + worldCells * 0.34);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryTreePerfScene) {
    controls.target.set(mid, 24, mid);
    camera.position.set(mid - worldCells * 0.28, 58, mid + worldCells * 0.38);
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryBorderOceanScene) {
    const cam = parseBorderOceanCamString(searchParams.get("cam"), worldCells, borderOceanSceneConfig);
    camera.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    controls.target.set(cam.look[0], cam.look[1], cam.look[2]);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  } else if (searchParams.get("scene") === RIVER_PARITY_TEST_SCENE) {
    controls.target.set(worldCells * 0.50, 38, worldCells * 0.50);
    camera.position.set(worldCells * 0.30, 155, worldCells * 0.86);
    camera.fov = 48;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  } else if (queryLongViewScene) {
    const camParam = searchParams.get("cam");
    const parts = camParam ? camParam.split(",").map(Number) : [];
    if (camParam && parts.length >= 4 && parts.every(Number.isFinite)) {
      controls.target.set(parts[0], parts[1], parts[2]);
      camera.position.set(parts[0], parts[1] + 20, parts[2] + 40);
      camera.rotation.set(parts[4] ?? 0, parts[3] ?? 0, 0, "YXZ");
      if (parts[5]) { camera.fov = parts[5]; camera.updateProjectionMatrix(); }
      controls.update();
    } else if (activePhase0Scene) {
      const cam = activePhase0Scene.camera;
      const yOffset = cam.y_offset_m ?? worldCells * 0.45;
      const lookDist = cam.look_distance_m ?? worldCells;
      const rpgTarget = rpgDensityCameraTarget(searchParams);
      const cx = rpgTarget
        ? rpgTarget.x
        : worldCells * (cam.x_ratio ?? cam.start_x_ratio ?? 0.5);
      const cz = rpgTarget
        ? rpgTarget.z
        : worldCells * (cam.z_ratio ?? cam.start_z_ratio ?? 0.5);
      const orbitBack = rpgTarget ? Math.min(lookDist, 240) : worldCells * 0.15;
      controls.target.set(cx, 64, cz + lookDist * 0.1);
      camera.position.set(cx - orbitBack, yOffset, cz + lookDist * 0.15);
      camera.lookAt(controls.target);
      controls.update();
    } else {
      controls.target.set(mid, 64, mid + worldCells * 0.4);
      camera.position.set(mid - worldCells * 0.15, worldCells * 0.45, mid + worldCells * 0.55);
      camera.lookAt(controls.target);
      controls.update();
    }
  }

  installRealtimeSunShadows({
    scene,
    camera,
    renderer,
    worldCells,
    searchParams,
    enabled: !queryLongViewScene,
  });

  const colliderPages: TerrainColliderPage[] = lod0Nodes
    .map((node) => ({
      id: node.id,
      mesh: node.mesh,
      footprint: node.footprint,
    }));
const terrainColliders = new TerrainColliderSet(colliderPages, {
    enabled: usesUnboundedTerrain(searchParams.get("scene")),
    surfaceHeight,
    // Never invent a floor in 3D voxel columns (caves, edits): the fallback only fires
    // in columns the voxel authority certifies single-surface.
    certifyColumn: appColumnCertified,
  }, { autoProcessRebuilds: true });
  // Build every page's BVH now so the first spell cast / spawn raycast doesn't hitch on a lazy MeshBVH build.
  terrainColliders.prewarmAll();
  const player = new PlayerController(terrainColliders, playerBounds, playerConfig);
  // Frontier barrier: stop at the readiness frontier of uncovered, uncertified columns
  // instead of walking onto an invented floor or falling through unloaded ground.
  const movementReadinessFeeds = createAppCellReadinessFeeds({ terrainColliders });
  player.attachMovementReadiness((x, z) => movementReadinessAt(movementReadinessFeeds, x, z));
  const interaction = new PlayerInteractionState();
  const terrainRaycast = createTerrainRaycastService({
    terrainColliders,
    surfaceHeight,
    worldCells,
    allowOutOfWorld: usesUnboundedTerrain(searchParams.get("scene")),
    getMode: () => interaction.mode,
  });

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
