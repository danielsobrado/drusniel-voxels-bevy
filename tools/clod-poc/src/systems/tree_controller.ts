import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import type { EnvironmentLighting } from "../environment.js";
import type { GrassWebGpuBackendAccess } from "../grass/grass_gpu_ring.js";
import { TreeSystem, type FallingTree, type TreeSettings, type TreeStats } from "../trees/index.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../stones/stone_validation.js";

export interface TreeControllerUiState {
  treesEnabled: boolean;
  treeDistance: number;
  treeMaxInstances: number;
  treeWindEnabled: boolean;
  treeWindStrength: number;
  treeWindSpeed: number;
  treeGustStrength: number;
  treeTrunkSwayStrength: number;
  treeLeafFlutterStrength: number;
  treeDebugColorByLod: boolean;
  treeGpuEnabled: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
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
  markPatchesDirty(): void;
  bakeImpostors(renderer: unknown): ReturnType<TreeSystem["bakeImpostors"]>;
  updateFallingTrees(deltaSeconds: number): void;
  dispose(): void;
}

const FALLING_GRAVITY = 9.81;
const FALLING_TERMINAL_VELOCITY = 30;
const FALLING_MAX_TILT = 0.3;
const FALLING_TREE_MAX = 1024;

export function createTreeController(deps: TreeControllerDeps): TreeController {
  const fallingTrees: FallingTree[] = [];
  const fallingTrunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
  const fallingTreeMat = new THREE.MeshStandardMaterial({ color: 0x8B5E3C, roughness: 0.9 });
  const fallingTreeMesh = new THREE.InstancedMesh(fallingTrunkGeo, fallingTreeMat, FALLING_TREE_MAX);
  const fallingTreeDummy = new THREE.Object3D();
  fallingTreeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  deps.scene.add(fallingTreeMesh);

  const makeSettings = (): TreeSettings => {
    const state = deps.getUiState();
    return {
      ...deps.treeConfig,
      enabled: state.treesEnabled,
      distanceM: state.treeDistance,
      maxInstances: state.treeMaxInstances,
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
      },
      gpu: {
        ...deps.treeConfig.gpu,
        enabled: state.treeGpuEnabled,
        debugForceCpu: state.treeGpuForceCpu,
        debugShowGpuCounts: state.treeGpuShowCounts,
      },
    };
  };

  const signaturesBefore = pageMeshSignatures(deps.nodes);
  const system = new TreeSystem({
    scene: deps.scene,
    nodes: deps.nodes,
    worldCells: deps.worldCells,
    settings: makeSettings(),
    webgpu: deps.webgpu,
    lighting: deps.getLighting(),
    hydrologyWaterTexture: deps.hydrologyWaterTexture,
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
    supportsGpuTrees: deps.webgpu,
  });
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
    markPatchesDirty() {
      system.markPatchesDirty();
    },
    bakeImpostors(renderer) {
      return system.bakeImpostors(renderer);
    },
    updateFallingTrees(dt) {
      if (fallingTrees.length === 0) { fallingTreeMesh.count = 0; return; }
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
      deps.scene.remove(fallingTreeMesh);
      fallingTrunkGeo.dispose();
      fallingTreeMat.dispose();
      fallingTreeMesh.dispose();
    },
  };
}
