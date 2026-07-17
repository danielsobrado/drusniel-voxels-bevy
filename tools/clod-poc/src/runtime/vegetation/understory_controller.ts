import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { GrassWebGpuBackendAccess } from "../../grass/grass_gpu_ring.js";
import type { UnderstoryHydrologyData } from "../../gpu/understory_ring_compute.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../../stones/stone_validation.js";
import {
  setUnderstoryDepthPrepassEnabled,
  understoryDepthPrepassFromQuery,
} from "../../understory/understory_depth_prepass_runtime.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import { UnderstorySystem, type UnderstoryStats } from "../../understory/understory_system.js";
import type { DressingSystem } from "../../ecology/dressing/dressing_system.js";
import {
  getRingDebugOverlay,
  ringDebugEnabled,
  type RingTelemetryState,
} from "../../diagnostics/ring_debug_overlay.js";

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
  dressingSystem?: DressingSystem | null;
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
  setDepthPrepassEnabled(enabled: boolean): void;
  markPatchesDirty(): void;
}

interface UnderstoryGpuPrefilterStatsSource {
  gpuRingStats?: {
    prefilterTestedClusters?: number;
    prefilterRejectedClusters?: number;
    prefilterAcceptedClusters?: number;
    prefilterUnknownKeptClusters?: number;
    readbackMs?: number | null;
  };
}

export function createUnderstoryController(deps: UnderstoryControllerDeps): UnderstoryController {
  setUnderstoryDepthPrepassEnabled(initialUnderstoryDepthPrepassEnabled());
  const ringDebug = getRingDebugOverlay(deps.scene, "understory");

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
        dead_log: { ...deps.understoryConfig.classes.dead_log, enabled: deps.dressingSystem?.enabled ? false : deps.understoryConfig.classes.dead_log.enabled },
        stump: { ...deps.understoryConfig.classes.stump, enabled: deps.dressingSystem?.enabled ? false : deps.understoryConfig.classes.stump.enabled },
      },
      render: {
        ...deps.understoryConfig.render,
        debugColorByClass: state.understoryDebugColorByClass || ringDebugEnabled("understory"),
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

  const currentStats = () => withGpuPrefilterStats(system, system.getStats());
  const sync = () => deps.syncStatsToState(currentStats());
  const rebuildWithCurrentSettings = () => {
    system.updateSettings(makeSettings());
    system.rebuild();
    sync();
  };
  sync();

  return {
    system,
    makeSettings,
    applySettings: rebuildWithCurrentSettings,
    rebuild: rebuildWithCurrentSettings,
    refreshStats: sync,
    update: (elapsedSeconds, ringCenter, camera) => {
      system.update(elapsedSeconds, ringCenter, camera);
      deps.dressingSystem?.update(ringCenter);
      const settings = makeSettings();
      const stats = currentStats();
      ringDebug.update({
        centerX: ringCenter.x,
        centerZ: ringCenter.z,
        cellSizeM: settings.placement.spacingM,
        outerRadiusM: settings.distanceM,
        innerRadiusM: 0,
        refreshDistanceM: settings.placement.spacingM,
        candidateGrid: Math.max(1, Math.ceil((settings.distanceM * 2) / settings.placement.spacingM)),
        acceptedCount: telemetryState(system) === "unknown" ? undefined : stats.gpuVisibleCount,
        telemetryState: telemetryState(system),
        classColoring: settings.render.debugColorByClass,
        lodMode: "class-only",
      });
    },
    updateLighting: (lighting) => system.updateLighting(lighting),
    setEnabled: (enabled) => {
      deps.getUiState().understoryEnabled = enabled;
      system.setEnabled(enabled);
      sync();
    },
    setDepthPrepassEnabled: (enabled) => {
      setUnderstoryDepthPrepassEnabled(enabled);
      system.rebuild();
      sync();
    },
    markPatchesDirty: () => {
      system.markPatchesDirty();
      system.rebuild();
      sync();
    },
  };
}

function withGpuPrefilterStats(system: UnderstorySystem, stats: UnderstoryStats): UnderstoryStats {
  const source = system as unknown as UnderstoryGpuPrefilterStatsSource;
  const gpuRingStats = source.gpuRingStats;
  if (!gpuRingStats) return stats;
  return {
    ...stats,
    gpuPrefilterTestedClusters: gpuRingStats.prefilterTestedClusters ?? stats.gpuPrefilterTestedClusters ?? 0,
    gpuPrefilterRejectedClusters: gpuRingStats.prefilterRejectedClusters ?? stats.gpuPrefilterRejectedClusters ?? 0,
    gpuPrefilterAcceptedClusters: gpuRingStats.prefilterAcceptedClusters ?? stats.gpuPrefilterAcceptedClusters ?? 0,
    gpuPrefilterUnknownKeptClusters: gpuRingStats.prefilterUnknownKeptClusters ?? stats.gpuPrefilterUnknownKeptClusters ?? 0,
  };
}

function telemetryState(system: UnderstorySystem): RingTelemetryState {
  const source = system as unknown as UnderstoryGpuPrefilterStatsSource;
  return source.gpuRingStats?.readbackMs == null ? "unknown" : "last-known";
}

function initialUnderstoryDepthPrepassEnabled(): boolean {
  if (typeof location === "undefined") return false;
  return understoryDepthPrepassFromQuery(new URLSearchParams(location.search));
}
