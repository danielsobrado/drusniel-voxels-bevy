import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { FAR_SHELL_DEFAULTS } from "../app/clod_constants.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import {
  applyCanopyShellQueryOverrides,
  parseCanopyShellConfig,
  shouldUseDeterministicCanopy,
} from "./canopy_config.js";
import type { CanopyTextureSet } from "./canopy_types.js";
import { canopyMetricsToCounters, createEmptyCanopyMetrics } from "./canopy_types.js";
import { createCanopyClipmap } from "./canopy_clipmap.js";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import {
  createCanopyDebugOverlays,
  createCanopyDebugState,
  formatCanopyStatsLine,
  updateCanopyDebugOverlays,
  type CanopyDebugState,
} from "./canopy_debug.js";
import {
  buildCanopyTextureSet,
  disposeCanopyTextureSet,
} from "./canopy_texture.js";
import {
  buildFarCanopyShellFromTextureSet,
  updateFarCanopyShellTextures,
  type FarCanopyShell,
} from "../gpu/far_canopy_shell.js";

export interface CanopyShellSystemDeps {
  scene: THREE.Scene;
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  getLighting: () => EnvironmentLighting;
  getConfig: () => CanopyShellConfig;
  getDebugState: () => CanopyDebugState;
  onCounters?: (counters: Record<string, number>) => void;
}

export interface CanopyShellSystem {
  readonly active: boolean;
  readonly debugState: CanopyDebugState;
  readonly shell: FarCanopyShell | null;
  update(cameraX: number, cameraZ: number): void;
  applyDebugConfig(): void;
  dispose(): void;
}

export function createCanopyShellSystem(
  yamlText: string,
  searchParams: URLSearchParams,
  scene: string | null,
  queryCanopy: boolean,
  deps: CanopyShellSystemDeps,
): CanopyShellSystem | null {
  let config = applyCanopyShellQueryOverrides(parseCanopyShellConfig(yamlText), searchParams);
  const active = shouldUseDeterministicCanopy(scene, config, queryCanopy);
  if (!active) return null;

  const clipmap = createCanopyClipmap();
  const treeDistribution = createTreeDistribution(config.treeDistribution, config.seed);
  const farRadius = deps.worldSizeCells * FAR_SHELL_DEFAULTS.radiusFactor;
  const terrainSampler = createBlendedTerrainSampler(deps.terrainSummary, farRadius);
  const debugState = createCanopyDebugState(config);
  const overlays = createCanopyDebugOverlays(deps.scene);

  let shell: FarCanopyShell | null = null;
  let textureSet: CanopyTextureSet | null = null;
  let metrics = createEmptyCanopyMetrics();
  let uploadBudgetUsed = 0;
  let centerX = deps.worldSizeCells / 2;
  let centerZ = deps.worldSizeCells / 2;

  clipmap.setFreezeCenter(config.debug.freezeClipCenter);

  const publish = () => {
    const counters = canopyMetricsToCounters(metrics, true);
    deps.onCounters?.(counters);
    debugState.statsLine = formatCanopyStatsLine(metrics, debugState.syntheticFallbackActive);
  };

  const rebuildShell = (set: CanopyTextureSet) => {
    if (shell) {
      deps.scene.remove(shell.mesh);
      shell.dispose();
    }
    const lighting = deps.getLighting();
    shell = buildFarCanopyShellFromTextureSet(set, config, {
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    }, {
      grid: 192,
      buildRelative: true,
      skipInteriorHole: true,
      showCoverageHeatmap: debugState.showCoverageHeatmap,
      wireframe: debugState.showShellWireframe,
    });
    shell.mesh.position.set(centerX, 0, centerZ);
    deps.scene.add(shell.mesh);
    metrics.shellTriangles = shell.triangleCount;
  };

  const ensureTextures = (forceSynthetic: boolean) => {
    const useSynthetic = forceSynthetic
      || (config.debug.forceSyntheticSource)
      || (clipmap.getVisibleTiles().length === 0 && config.source.allowSyntheticDebugFallback);

    const t0 = performance.now();
    const next = buildCanopyTextureSet({
      visibleTiles: clipmap.getVisibleTiles(),
      config,
      centerX,
      centerZ,
      syntheticFallback: useSynthetic,
      terrainSummary: deps.terrainSummary,
      farRadius,
    });
    debugState.syntheticFallbackActive = next.syntheticFallback;
    if (next.syntheticFallback) metrics.fallbackSyntheticTiles++;
    metrics.uploadMs = performance.now() - t0;
    metrics.textureUploads++;

    if (!textureSet || next.syntheticFallback !== textureSet.syntheticFallback) {
      disposeCanopyTextureSet(textureSet);
      textureSet = next;
      rebuildShell(next);
    } else if (shell) {
      updateFarCanopyShellTextures(shell, next);
      textureSet = next;
    } else {
      disposeCanopyTextureSet(textureSet);
      textureSet = next;
      rebuildShell(next);
    }
  };

  const update = (cameraX: number, cameraZ: number) => {
    config = deps.getConfig();
    clipmap.setFreezeCenter(config.debug.freezeClipCenter || debugState.freezeClipCenter);
    const clipUpdate = clipmap.update(cameraX, cameraZ, config, terrainSampler, treeDistribution);
    centerX = clipUpdate.centerX;
    centerZ = clipUpdate.centerZ;
    metrics = { ...metrics, ...clipUpdate.metrics };

    uploadBudgetUsed = 0;
    if (clipUpdate.texturesDirty || !textureSet) {
      if (uploadBudgetUsed < config.budgets.maxTextureUploadsPerFrame) {
        ensureTextures(false);
        uploadBudgetUsed++;
      }
    }

    if (shell) {
      shell.mesh.position.set(centerX, 0, centerZ);
      const mat = shell.mesh.material as THREE.Material & { wireframe?: boolean };
      if ("wireframe" in mat) mat.wireframe = debugState.showShellWireframe;
    }

    updateCanopyDebugOverlays(overlays, clipmap.getVisibleTiles(), config, centerX, centerZ, debugState);
    publish();
  };

  update(deps.worldSizeCells / 2, deps.worldSizeCells / 2);

  return {
    get active() { return true; },
    get debugState() { return debugState; },
    get shell() { return shell; },
    update,
    applyDebugConfig() {
      config = deps.getConfig();
      ensureTextures(config.debug.forceSyntheticSource);
      publish();
    },
    dispose() {
      if (shell) {
        deps.scene.remove(shell.mesh);
        shell.dispose();
        shell = null;
      }
      disposeCanopyTextureSet(textureSet);
      textureSet = null;
      clipmap.dispose();
      overlays.dispose();
    },
  };
}

export type { CanopyDebugState };
export { createCanopyDebugState, canopyMetricsToCounters };
