import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import {
  GrassSystem,
  type GrassGpuRingComputeFactory,
} from "../../grass/grass_system.js";
import {
  type GrassLighting,
  type GrassSettings,
  type GrassShaderMode,
} from "../../grass/grass_config.js";
import type { GrassStats } from "../../grass/grass_stats.js";
import type { GrassGeometryBuilder, GrassMaterialFactory } from "../../grass/grass_geometry.js";
import type { GrassWebGpuBackendAccess } from "../../grass/grass_gpu_ring.js";

export interface GrassControllerUiState {
  grassEnabled: boolean;
  grassShaderMode: GrassShaderMode;
  grassDistance: number;
  grassMaxBlades: number;
  grassBladeSpacing: number;
  grassSlopeMinY: number;
  grassMinHeight: number;
  grassMaxHeight: number;
  grassBladeHeight: number;
  grassBladeHeightVariation: number;
  grassBladeWidth: number;
  grassWindStrength: number;
  grassWindSpeed: number;
  grassAlphaToCoverage: boolean;
  grassNearCrossedQuads: boolean;
  grassSeed: number;
}

export interface GrassControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: GrassSettings;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  supportsRing: boolean;
  gpuDevice: GPUDevice | null;
  gpuBackend: GrassWebGpuBackendAccess | null;
  getUiState: () => GrassControllerUiState;
  getLighting: () => GrassLighting;
  createMaterial?: GrassMaterialFactory;
  buildGeometry?: GrassGeometryBuilder;
  createGpuRingCompute?: GrassGpuRingComputeFactory;
  syncStatsToState: (stats: GrassStats) => void;
}

export interface GrassController {
  readonly system: GrassSystem;
  makeSettings(): GrassSettings;
  applySettings(): void;
  rebuild(): void;
  refreshStats(): void;
  update(elapsedSeconds: number, ringCenter: THREE.Vector3, camera: THREE.Camera): void;
  updateLighting(lighting: GrassLighting): void;
  setEnabled(enabled: boolean): void;
  setRingDebug(on: boolean): void;
}

export function createGrassController(deps: GrassControllerDeps): GrassController {
  const makeSettings = (): GrassSettings => {
    const state = deps.getUiState();
    return {
      ...deps.grassConfig,
      enabled: state.grassEnabled,
      shaderMode: state.grassShaderMode,
      distanceM: state.grassDistance,
      maxInstances: state.grassMaxBlades,
      placement: {
        ...deps.grassConfig.placement,
        spacingM: state.grassBladeSpacing,
        slopeMinY: state.grassSlopeMinY,
        minHeightM: state.grassMinHeight,
        maxHeightM: state.grassMaxHeight,
      },
      blade: {
        ...deps.grassConfig.blade,
        heightM: state.grassBladeHeight,
        heightVariation: state.grassBladeHeightVariation,
        widthM: state.grassBladeWidth,
        nearCrossedQuads: state.grassNearCrossedQuads,
      },
      wind: {
        ...deps.grassConfig.wind,
        strength: state.grassWindStrength,
        speed: state.grassWindSpeed,
      },
      render: {
        ...deps.grassConfig.render,
        alphaToCoverage: state.grassAlphaToCoverage,
      },
      alphaToCoverage: state.grassAlphaToCoverage,
      nearCrossedQuads: state.grassNearCrossedQuads,
      distance: state.grassDistance,
      bladeSpacing: state.grassBladeSpacing,
      bladeHeight: state.grassBladeHeight,
      bladeHeightVariation: state.grassBladeHeightVariation,
      bladeWidth: state.grassBladeWidth,
      windStrength: state.grassWindStrength,
      windSpeed: state.grassWindSpeed,
      slopeMinY: state.grassSlopeMinY,
      minHeight: state.grassMinHeight,
      maxHeight: state.grassMaxHeight,
      maxBlades: state.grassMaxBlades,
      seed: state.grassSeed,
      ring: {
        ...deps.grassConfig.ring,
        grid: Math.floor(deps.queryGrassRingGrid ?? deps.grassConfig.ring.grid),
        cell: deps.queryGrassRingCell ?? deps.grassConfig.ring.cell,
      },
      patchFallback: { ...deps.grassConfig.patchFallback },
    };
  };

  const system = new GrassSystem({
    scene: deps.scene,
    nodes: deps.nodes,
    worldCells: deps.worldCells,
    settings: makeSettings(),
    lighting: deps.getLighting(),
    supportsRing: deps.supportsRing,
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
    ...(deps.createMaterial && deps.buildGeometry
      ? { createMaterial: deps.createMaterial, buildGeometry: deps.buildGeometry }
      : {}),
    ...(deps.createGpuRingCompute ? { createGpuRingCompute: deps.createGpuRingCompute } : {}),
  });

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
    setRingDebug(on) {
      system.setRingDebug(on);
    },
  };
}
