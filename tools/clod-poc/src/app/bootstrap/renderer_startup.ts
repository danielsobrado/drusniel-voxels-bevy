import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createWebGlAppRenderer,
  createWebGpuAppRenderer,
  parseRendererBackend,
} from "../../rendering/renderer_backend.js";
import { getRendererGpuDevice } from "../../rendering/webgpu_device_bridge.js";
import { failLoud } from "../../core/diagnostics.js";
import { TerrainColliderSet, type TerrainColliderPage } from "../../terrain_collider.js";
import {
  PlayerController,
  PlayerInteractionState,
} from "../../player_controller.js";
import { createTerrainRaycastService } from "../../player/terrain_raycast_service.js";
import { surfaceHeight } from "../../terrain.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { ProjectArchiveContents } from "../../project_archive.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { Phase0SceneConfig } from "../../phase0/phase0_config.js";

export type AppRenderer = Awaited<ReturnType<typeof createWebGpuAppRenderer>> | ReturnType<typeof createWebGlAppRenderer>;

export interface RendererStartupInput {
  searchParams: URLSearchParams;
  cfg: ClodPagesConfig;
  worldCells: number;
  lod0Nodes: ClodPageNode[];
  waterConfig: WaterConfig;
  stagedImport: ProjectArchiveContents | null;
  queryGrassPerfScene: boolean;
  queryTreePerfScene: boolean;
  queryLongViewScene: boolean;
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
    activePhase0Scene,
  } = input;

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
    failLoud("Renderer initialization failed", details);
    return null;
  }

  const renderer = app.renderer;
  const maxAnisotropy = app.maxAnisotropy;
  const isWebGpu = app.isWebGpu;
  const rendererWebGpuDevice = getRendererGpuDevice(app);
  const poolTerrainMaterial = isWebGpu && cfg.selection.transition_mode === "instant";

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
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
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);

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
      const xRatio = cam.x_ratio ?? cam.start_x_ratio ?? 0.5;
      const zRatio = cam.z_ratio ?? cam.start_z_ratio ?? 0.5;
      const yOffset = cam.y_offset_m ?? worldCells * 0.45;
      const lookDist = cam.look_distance_m ?? worldCells;
      const cx = worldCells * xRatio;
      const cz = worldCells * zRatio;
      controls.target.set(cx, 64, cz + lookDist * 0.1);
      camera.position.set(cx - worldCells * 0.15, yOffset, cz + lookDist * 0.15);
      camera.lookAt(controls.target);
      controls.update();
    } else {
      controls.target.set(mid, 64, mid + worldCells * 0.4);
      camera.position.set(mid - worldCells * 0.15, worldCells * 0.45, mid + worldCells * 0.55);
      camera.lookAt(controls.target);
      controls.update();
    }
  }

  const colliderPages: TerrainColliderPage[] = lod0Nodes
    .map((node) => ({
      id: node.id,
      mesh: node.mesh,
      footprint: node.footprint,
    }));
  const terrainColliders = new TerrainColliderSet(colliderPages);
  const player = new PlayerController(terrainColliders, {
    minX: -1000,
    minZ: -1000,
    maxX: Math.max(worldCells, 1000),
    maxZ: Math.max(worldCells, 1000),
  });
  const interaction = new PlayerInteractionState();
  const terrainRaycast = createTerrainRaycastService({
    terrainColliders,
    surfaceHeight,
    worldCells,
  });

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
