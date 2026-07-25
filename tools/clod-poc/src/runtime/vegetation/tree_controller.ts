import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { GrassWebGpuBackendAccess } from "../../grass/grass_gpu_ring.js";
import type { PostProcessQualityPreset } from "../../app/state/postprocess_quality_presets.js";
import {
  treeImpostorBakeAgeLayersForQualityPreset,
  treeImpostorStartFractionForQualityPreset,
  treeImpostorTileResolutionForQualityPreset,
  treeLodBudgetsForQualityPreset,
  type TreeShadowMaxLod,
} from "../../app/state/tree_quality_presets.js";
import { TreeSystem, type FallingTree, type TreeSettings, type TreeStats } from "../../trees/index.js";
import type { TreeDepthPrepassMaxLod } from "../../trees/tree_depth_prepass_runtime.js";
import type { TreeTerrainOcclusionSampler } from "../../trees/tree_terrain_occlusion.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../../stones/stone_validation.js";
import { prewarmTreeGpuRingPipelines, treeGpuRingWorkgroupSize } from "../../gpu/tree_ring_compute.js";

export interface TreeControllerUiState {
  treesEnabled: boolean;
  treeQualityPreset: PostProcessQualityPreset;
  treeDepthPrepassMaxLod: TreeDepthPrepassMaxLod;
  treeDistance: number;
  treeMaxInstances: number;
  treeDensity: number;
  treeSpacing: number;
  treeShadowMaxLod: TreeShadowMaxLod;
  treeWindEnabled: boolean;
  treeWindStrength: number;
  treeWindSpeed: number;
  treeGustStrength: number;
  treeTrunkSwayStrength: number;
  treeLeafFlutterStrength: number;
  treeDebugColorByLod: boolean;
  treeFarCheapMaterial: boolean;
  treePlacementDebug: boolean;
  treeImpostorSwapOnBake: boolean;
  treeGpuEnabled: boolean;
  treeGpuFallbackToCpu: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
  treeGpuReadbackVisibleLists: boolean;
  treeGpuValidateAgainstCpu: boolean;
  treeGpuMaxVisible: number;
}

export interface TreeControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  treeConfig: TreeSettings;
  webgpu: boolean;
  getUiState: () => TreeControllerUiState;
  getLighting: () => EnvironmentLighting;
  hydrologyWaterTexture: THREE.Texture | null;
  terrainOcclusionSampler?: TreeTerrainOcclusionSampler;
  gpuDevice: GPUDevice | null;
  gpuBackend: GrassWebGpuBackendAccess | null;
  syncStatsToState: (stats: TreeStats) => void;
}

export interface TreeController {
  readonly system: TreeSystem;
  readonly fallingTrees: FallingTree[];
  makeSettings(): TreeSettings;
  applySettings(): void;
  rebuild(): void;
  refreshStats(): void;
  update(elapsedSeconds: number, ringCenter: THREE.Vector3, camera: THREE.Camera): void;
  updateLighting(lighting: EnvironmentLighting): void;
  setEnabled(enabled: boolean): void;
  setDepthPrepassMaxLod(maxLod: TreeDepthPrepassMaxLod): void;
  markPatchesDirty(): void;
  bakeImpostors(renderer: unknown): ReturnType<TreeSystem["bakeImpostors"]>;
  updateFallingTrees(deltaSeconds: number): void;
  dispose(): void;
}

const FALLING_GRAVITY = 9.81;
const FALLING_TERMINAL_VELOCITY = 30;
const FALLING_MAX_TILT = 0.3;
const FALLING_TREE_MAX = 1024;

export function createFallingTreeInstancedMesh(): THREE.InstancedMesh {
  const geometry = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
  const material = new THREE.MeshStandardMaterial({ color: 0x8B5E3C, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geometry, material, FALLING_TREE_MAX);
  mesh.name = "falling-tree-instances";
  mesh.count = 0;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function clampAtLeast(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, value) : min;
}

export function createTreeController(deps: TreeControllerDeps): TreeController {
  const fallingTrees: FallingTree[] = [];
  const fallingTreeMesh = createFallingTreeInstancedMesh();
  const fallingTrunkGeo = fallingTreeMesh.geometry;
  const fallingTreeMat = fallingTreeMesh.material as THREE.Material;
  const fallingTreeDummy = new THREE.Object3D();
  deps.scene.add(fallingTreeMesh);

  const makeSettings = (): TreeSettings => {
    const state = deps.getUiState();
    const treeSpacing = clampAtLeast(state.treeSpacing, 0.5);
    const treeDensity = clampAtLeast(state.treeDensity, 0);
    const treeDistance = clampAtLeast(state.treeDistance, 0);
    const lodBudgets = treeLodBudgetsForQualityPreset(state.treeQualityPreset, deps.treeConfig.lod.budgets);
    return {
      ...deps.treeConfig,
      enabled: state.treesEnabled,
      distanceM: treeDistance,
      maxInstances: Math.floor(clampAtLeast(state.treeMaxInstances, 0)),
      placement: {
        ...deps.treeConfig.placement,
        spacingM: treeSpacing,
      },
      lod: {
        ...deps.treeConfig.lod,
        farFraction: treeImpostorStartFractionForQualityPreset(
          state.treeQualityPreset,
          treeDistance,
          deps.treeConfig.lod.farFraction,
        ),
        shadowsMaxLod: state.treeShadowMaxLod,
        budgets: lodBudgets,
      },
      ecology: {
        ...deps.treeConfig.ecology,
        density: {
          ...deps.treeConfig.ecology.density,
          baseDensity: treeDensity,
        },
      },
      impostors: {
        ...deps.treeConfig.impostors,
        bakeAgeLayers: treeImpostorBakeAgeLayersForQualityPreset(
          state.treeQualityPreset,
          deps.treeConfig.impostors.bakeAgeLayers,
        ),
        resolutionPx: treeImpostorTileResolutionForQualityPreset(
          state.treeQualityPreset,
          deps.treeConfig.impostors.resolutionPx,
        ),
        swapOnBake: state.treeImpostorSwapOnBake,
      },
      wind: {
        ...deps.treeConfig.wind,
        enabled: state.treeWindEnabled,
        strength: state.treeWindStrength,
        speed: state.treeWindSpeed,
        gustStrength: state.treeGustStrength,
        trunkSwayStrength: state.treeTrunkSwayStrength,
        leafFlutterStrength: state.treeLeafFlutterStrength,
      },
      render: {
        ...deps.treeConfig.render,
        debugColorByLod: state.treeDebugColorByLod,
        farCheapMaterial: state.treeFarCheapMaterial,
        placementDebug: state.treePlacementDebug,
      },
      gpu: {
        ...deps.treeConfig.gpu,
        enabled: state.treeGpuEnabled,
        fallbackToCpu: state.treeGpuFallbackToCpu,
        debugForceCpu: state.treeGpuForceCpu,
        debugShowGpuCounts: state.treeGpuShowCounts,
        readbackVisibleLists: state.treeGpuReadbackVisibleLists,
        debugValidateAgainstCpu: state.treeGpuValidateAgainstCpu,
        maxVisible: Math.floor(clampAtLeast(state.treeGpuMaxVisible, 0)),
      },
    };
  };

  // Start the ~9s tree_cull compile now rather than on the first frame that updates trees;
  // the ring is otherwise stuck on CPU-fallback patches (near/mid only) until it finishes.
  if (deps.gpuDevice && deps.webgpu) {
    prewarmTreeGpuRingPipelines(deps.gpuDevice, treeGpuRingWorkgroupSize(deps.treeConfig));
  }

  const signaturesBefore = pageMeshSignatures(deps.nodes);
  const system = new TreeSystem({
    scene: deps.scene,
    nodes: deps.nodes,
    worldCells: deps.worldCells,
    settings: makeSettings(),
    webgpu: deps.webgpu,
    lighting: deps.getLighting(),
    hydrologyWaterTexture: deps.hydrologyWaterTexture,
    terrainOcclusionSampler: deps.terrainOcclusionSampler,
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
    supportsGpuTrees: deps.webgpu,
  });
  system.setDepthPrepassMaxLod(deps.getUiState().treeDepthPrepassMaxLod);
  assertPageMeshSignaturesUnchanged(signaturesBefore, pageMeshSignatures(deps.nodes));

  const refreshStats = () => {
    deps.syncStatsToState(system.getStats());
  };

  return {
    system,
    fallingTrees,
    makeSettings,
    applySettings() {
      system.updateSettings(makeSettings());
    },
    rebuild() {
      system.updateSettings(makeSettings());
      system.rebuild();
      refreshStats();
    },
    refreshStats,
    update(elapsedSeconds, ringCenter, camera) {
      system.update(elapsedSeconds, ringCenter, camera);
    },
    updateLighting(lighting) {
      system.updateLighting(lighting);
    },
    setEnabled(enabled) {
      system.setEnabled(enabled);
    },
    setDepthPrepassMaxLod(maxLod) {
      const state = deps.getUiState();
      state.treeDepthPrepassMaxLod = maxLod;
      system.setDepthPrepassMaxLod(maxLod);
    },
    markPatchesDirty() {
      system.markPatchesDirty();
    },
    bakeImpostors(renderer) {
      return system.bakeImpostors(renderer);
    },
    updateFallingTrees(dt) {
      if (fallingTrees.length === 0) {
        fallingTreeMesh.count = 0;
        fallingTreeMesh.visible = false;
        return;
      }
      for (let i = fallingTrees.length - 1; i >= 0; i--) {
        const t = fallingTrees[i];
        t.velocity = Math.min(t.velocity + FALLING_GRAVITY * dt, FALLING_TERMINAL_VELOCITY);
        t.position[1] -= t.velocity * dt;
        if (t.position[1] < 0) {
          fallingTrees.splice(i, 1);
        }
      }
      const count = Math.min(fallingTrees.length, FALLING_TREE_MAX);
      fallingTreeMesh.count = count;
      fallingTreeMesh.visible = count > 0;
      for (let i = 0; i < count; i++) {
        const t = fallingTrees[i];
        const tilt = Math.min(t.velocity / FALLING_TERMINAL_VELOCITY, 1) * FALLING_MAX_TILT;
        fallingTreeDummy.position.set(t.position[0], t.position[1], t.position[2]);
        fallingTreeDummy.rotation.set(0, t.rotationY, tilt);
        fallingTreeDummy.scale.set(t.scale, t.scale, t.scale);
        fallingTreeDummy.updateMatrix();
        fallingTreeMesh.setMatrixAt(i, fallingTreeDummy.matrix);
      }
      fallingTreeMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      system.dispose();
      deps.scene.remove(fallingTreeMesh);
      fallingTrunkGeo.dispose();
      fallingTreeMat.dispose();
      fallingTreeMesh.dispose();
    },
  };
}
