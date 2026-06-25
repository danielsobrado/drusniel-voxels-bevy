import type { EnvironmentLighting } from "../../environment/environment.js";
import {
  applyForestLightingMaterialStateIfChanged,
  ForestLightingSystem,
  type ForestLightingDebugMode,
  type ForestLightingMaterialUpdateSignature,
  type ForestLightingSettings,
  type ForestLightingStats,
} from "../../forest_lighting/index.js";
import type { TreeSystem } from "../../trees/index.js";
import type { UnderstorySystem } from "../../understory/understory_system.js";

export interface ForestLightingControllerUiState {
  forestLightingEnabled: boolean;
  forestLightingAoStrength: number;
  forestLightingShadowStrength: number;
  forestLightingFogStrength: number;
  forestLightingSunShaftsStrength: number;
  forestLightingDebugMode: ForestLightingDebugMode;
}

export interface ForestLightingControllerDeps {
  worldCells: number;
  forestLightingConfig: ForestLightingSettings;
  getUiState: () => ForestLightingControllerUiState;
  getTreeSystem: () => TreeSystem;
  getUnderstorySystem: () => UnderstorySystem;
  syncStatsToState: (stats: ForestLightingStats, statsText: string) => void;
}

export interface ForestLightingController {
  readonly system: ForestLightingSystem;
  makeSettings(): ForestLightingSettings;
  applySettings(): void;
  bumpSettingsVersion(): void;
  applyToPropMaterials(): void;
  refreshStats(): void;
  update(
    elapsedSeconds: number,
    center: import("three").Vector3,
    proxies: { treeProxies: ReturnType<TreeSystem["getLightingProxies"]>; understoryProxies: ReturnType<UnderstorySystem["getLightingProxies"]>; sunDirection: EnvironmentLighting["sunDirection"] },
  ): void;
  dispose(): void;
}

export function createForestLightingController(deps: ForestLightingControllerDeps): ForestLightingController {
  const makeSettings = (): ForestLightingSettings => {
    const state = deps.getUiState();
    return {
      ...deps.forestLightingConfig,
      enabled: state.forestLightingEnabled,
      field: { ...deps.forestLightingConfig.field },
      canopy: { ...deps.forestLightingConfig.canopy },
      ambientOcclusion: {
        ...deps.forestLightingConfig.ambientOcclusion,
        strength: state.forestLightingAoStrength,
      },
      shadowProxy: {
        ...deps.forestLightingConfig.shadowProxy,
        strength: state.forestLightingShadowStrength,
      },
      atmosphere: {
        ...deps.forestLightingConfig.atmosphere,
        forestFogStrength: state.forestLightingFogStrength,
        sunShaftsStrength: state.forestLightingSunShaftsStrength,
      },
      materialIntegration: {
        ...deps.forestLightingConfig.materialIntegration,
        debugMode: state.forestLightingDebugMode,
      },
    };
  };

  const system = new ForestLightingSystem({
    worldCells: deps.worldCells,
    settings: makeSettings(),
  });
  let settingsVersion = 0;
  let lastAppliedSignature: ForestLightingMaterialUpdateSignature | null = null;

  const formatStatsText = (stats: ForestLightingStats): string =>
    stats.enabled
      ? `canopy=${stats.maxCanopy.toFixed(2)} ao=${stats.maxAo.toFixed(2)} ` +
        `shadow=${stats.maxShadow.toFixed(2)} fog=${stats.maxFog.toFixed(2)}`
      : "disabled";

  const refreshStats = () => {
    const stats = system.getStats();
    deps.syncStatsToState(stats, formatStatsText(stats));
  };

  const applyToPropMaterials = () => {
    const stats = system.getStats();
    const materialState = system.getMaterialState();
    const signature: ForestLightingMaterialUpdateSignature = {
      textureHandle: materialState.textureHandle,
      textureUpdates: stats.textureUpdates,
      settingsVersion,
      enabled: materialState.settings.enabled,
      debugMode: materialState.settings.materialIntegration.debugMode,
    };
    lastAppliedSignature = applyForestLightingMaterialStateIfChanged(
      lastAppliedSignature,
      signature,
      materialState,
      [deps.getTreeSystem(), deps.getUnderstorySystem()],
    );
  };

  applyToPropMaterials();

  return {
    system,
    makeSettings,
    applySettings() {
      settingsVersion++;
      system.updateSettings(makeSettings());
      applyToPropMaterials();
      refreshStats();
    },
    bumpSettingsVersion() {
      settingsVersion++;
    },
    applyToPropMaterials,
    refreshStats,
    update(elapsedSeconds, center, proxies) {
      system.update(elapsedSeconds, center, proxies);
    },
    dispose() {
      system.dispose();
    },
  };
}
