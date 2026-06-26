import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { GrassWebGpuBackendAccess } from "../../grass/grass_gpu_ring.js";
import { UnderstorySystem, type UnderstoryStats } from "../../understory/understory_system.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../../stones/stone_validation.js";
import type { UnderstoryHydrologyData } from "../../gpu/understory_ring_compute.js";

export interface UnderstoryControllerUiState {
  understoryEnabled: boolean;
  understoryDistance: number;
  understoryMaxInstances: number;
  understoryDebugColorByClass: boolean;
}

export interface UnderstoryControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  understoryConfig: UnderstorySettings;
  webgpu: boolean;
  getUiState: () => UnderstoryControllerUiState;
  getLighting: () => EnvironmentLighting;
  gpuDevice: GPUDevice | null;
  gpuBackend: GrassWebGpuBackendAccess | null;
  hydrologyData: UnderstoryHydrologyData | null;
  hydrologyWaterTexture: THREE.Texture | null;
  syncStatsToState: (stats: UnderstoryStats) => void;
}

export interface UnderstoryController {
  readonly system: UnderstorySystem;
  makeSettings(): UnderstorySettings;
  applySettings(): void;
  rebuild(): void;
  refreshStats(): void;
  update(elapsedSeconds: number, ringCenter: THREE.Vector3, camera: THREE.Camera): void;
  updateLighting(lighting: EnvironmentLighting): void;
  setEnabled(enabled: boolean): void;
  markPatchesDirty(): void;
}

export function createUnderstoryController(deps: UnderstoryControllerDeps): UnderstoryController {
  const makeSettings = (): UnderstorySettings => {
    const state = deps.getUiState();
    return {
      ...deps.understoryConfig,
      enabled: state.understoryEnabled,
      distanceM: state.understoryDistance,
      maxInstances: state.understoryMaxInstances,
      placement: { ...deps.understoryConfig.placement },
      ecology: { ...deps.understoryConfig.ecology },
      classes: {
        shrub: { ...deps.understoryConfig.classes.shrub },
        fern: { ...deps.understoryConfig.classes.fern },
        sapling: { ...deps.understoryConfig.classes.sapling },
        flower: { ...deps.understoryConfig.classes.flower },
        dead_log: { ...deps.understoryConfig.classes.dead_log },
        stump: { ...deps.understoryConfig.classes.stump },
      },
      render: {
        ...deps.understoryConfig.render,
        debugColorByClass: state.understoryDebugColorByClass,
      },
    };
  };

  const signaturesBefore = pageMeshSignatures(deps.nodes);
  const system = new UnderstorySystem({
    scene: deps.scene,
    nodes: deps.nodes,
    worldCells: deps.worldCells,
    settings: makeSettings(),
    webgpu: deps.webgpu,
    lighting: deps.getLighting(),
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
    supportsGpu: deps.webgpu,
    hydrologyData: deps.hydrologyData,
    hydrologyWaterTexture: deps.hydrologyWaterTexture,
  });
  assertPageMeshSignaturesUnchanged(signaturesBefore, pageMeshSignatures(deps.nodes));

  const refreshStats = () => {
    deps.syncStatsToState(system.getStats());
  };

  return {
    system,
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
  };
}
