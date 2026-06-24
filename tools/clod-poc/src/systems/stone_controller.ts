import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { STONE_CLASSES, type StoneClass } from "../stones/stone_config.js";
import type { StoneSettings } from "../stones/stone_config.js";
import { StoneSystem, type StoneLighting, type StoneStats } from "../stones/stone_instances.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../stones/stone_validation.js";
import type { GrassWebGpuBackendAccess } from "../grass/grass_gpu_ring.js";

export interface StoneControllerUiState {
  stonesEnabled: boolean;
  stoneDensity: number;
  stoneMaxInstances: number;
  stoneSeed: number;
  stoneShowLarge: boolean;
  stoneShowMedium: boolean;
  stoneShowSmall: boolean;
}

export interface StoneControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  stoneConfig: StoneSettings;
  getUiState: () => StoneControllerUiState;
  getLighting: () => StoneLighting;
  hydrologyWaterTexture: THREE.Texture | null;
  gpuDevice: GPUDevice | null;
  gpuBackend: GrassWebGpuBackendAccess | null;
  onScatterStats: () => void;
  syncStatsToState: (stats: StoneStats) => void;
}

export interface StoneController {
  readonly system: StoneSystem;
  makeSettings(): StoneSettings;
  visibleClasses(): StoneClass[];
  applySettings(): void;
  rebuild(): void;
  refreshStats(): void;
  update(ringCenter: THREE.Vector3): void;
  updateLighting(lighting: StoneLighting): void;
  setEnabled(enabled: boolean): void;
  setVisibleClasses(classes: StoneClass[]): void;
}

export function createStoneController(deps: StoneControllerDeps): StoneController {
  const makeSettings = (): StoneSettings => {
    const state = deps.getUiState();
    return {
      ...deps.stoneConfig,
      enabled: state.stonesEnabled,
      density: state.stoneDensity,
      maxInstances: state.stoneMaxInstances,
      seedSalt: state.stoneSeed,
    };
  };
  const visibleClasses = (): StoneClass[] => {
    const state = deps.getUiState();
    return STONE_CLASSES.filter((cls) =>
      cls === "large" ? state.stoneShowLarge : cls === "medium" ? state.stoneShowMedium : state.stoneShowSmall,
    );
  };

  const signaturesBefore = pageMeshSignatures(deps.nodes);
  const system = new StoneSystem({
    scene: deps.scene,
    nodes: deps.nodes,
    worldCells: deps.worldCells,
    settings: makeSettings(),
    lighting: deps.getLighting(),
    hydrologyWaterTexture: deps.hydrologyWaterTexture,
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
    onStats: () => deps.onScatterStats(),
  });
  assertPageMeshSignaturesUnchanged(signaturesBefore, pageMeshSignatures(deps.nodes));
  system.setVisibleClasses(visibleClasses());

  const refreshStats = () => {
    deps.syncStatsToState(system.getStats());
  };

  return {
    system,
    makeSettings,
    visibleClasses,
    applySettings() {
      system.updateSettings(makeSettings());
    },
    rebuild() {
      system.updateSettings(makeSettings());
      system.setVisibleClasses(visibleClasses());
      refreshStats();
    },
    refreshStats,
    update(ringCenter) {
      system.update(ringCenter);
    },
    updateLighting(lighting) {
      system.updateLighting(lighting);
    },
    setEnabled(enabled) {
      system.setEnabled(enabled);
    },
    setVisibleClasses(classes) {
      system.setVisibleClasses(classes);
    },
  };
}
