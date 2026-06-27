import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import {
  applyCanopyShellQueryOverrides,
  parseCanopyShellConfig,
  shouldUseDeterministicCanopy,
} from "./canopy_config.js";
import type { CanopyTextureSet } from "./canopy_types.js";
import { canopyMetricsToCounters, createEmptyCanopyMetrics } from "./canopy_types.js";
import { createCanopyClipmap } from "./canopy_clipmap.js";
import { createBlendedTerrainSampler, type CanopyTerrainSampler } from "./canopy_terrain_sampler.js";
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

export function shouldRebuildCanopyShell(
  prev: CanopyTextureSet | null,
  next: CanopyTextureSet,
): boolean {
  if (!prev) return true;
  if (prev.syntheticFallback !== next.syntheticFallback) return true;
  return prev.revision !== next.revision;
}

/** Conservative shell grid cap from triangle budget (assumes all quads are emitted). */
export function shellGridForTriangleBudget(maxShellTris: number, preferredGrid = 192): number {
  const safeTriangleBudget = Number.isFinite(maxShellTris) && maxShellTris > 0 ? maxShellTris : 512;
  const safePreferredGrid = Number.isFinite(preferredGrid) && preferredGrid > 0 ? preferredGrid : 192;
  const maxGrid = Math.floor(Math.sqrt(safeTriangleBudget / 2));
  return Math.max(16, Math.min(safePreferredGrid, maxGrid));
}

export function treeDistributionConfigKey(config: CanopyShellConfig): string {
  return JSON.stringify({
    seed: config.seed,
    treeDistribution: config.treeDistribution,
  });
}

export function canopyTextureConfigKey(config: CanopyShellConfig): string {
  return JSON.stringify({
    source: {
      allowSyntheticDebugFallback: config.source.allowSyntheticDebugFallback,
    },
    distances: config.distances,
    clipmap: config.clipmap,
    material: config.material,
    debug: {
      showCoverageHeatmap: config.debug.showCoverageHeatmap,
      forceSyntheticSource: config.debug.forceSyntheticSource,
    },
    budgets: {
      maxShellTris: config.budgets.maxShellTris,
    },
  });
}

export function shellCenterForTextureSet(set: CanopyTextureSet): { x: number; z: number } {
  return {
    x: set.originX + set.extentM * 0.5,
    z: set.originZ + set.extentM * 0.5,
  };
}

export function shouldAttemptTextureUpload(
  maxTextureUploadsPerFrame: number,
  uploadsUsedThisFrame: number,
): boolean {
  return maxTextureUploadsPerFrame > uploadsUsedThisFrame;
}

export function shouldUseSyntheticCanopyFallback(
  config: CanopyShellConfig,
  forceSynthetic: boolean,
  visibleTileCount: number,
): boolean {
  if (forceSynthetic || config.debug.forceSyntheticSource) return true;
  if (!config.clipmap.enabled) return false;
  return visibleTileCount === 0 && config.source.allowSyntheticDebugFallback;
}

export function shouldKeepCanopyShellActive(
  config: CanopyShellConfig,
  forceSynthetic: boolean,
): boolean {
  return config.clipmap.enabled || forceSynthetic || config.debug.forceSyntheticSource;
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
  let treeDistribution = createTreeDistribution(config.treeDistribution, config.seed);
  let treeDistributionKey = treeDistributionConfigKey(config);
  let textureConfigKey = canopyTextureConfigKey(config);
  let terrainSampler: CanopyTerrainSampler = createBlendedTerrainSampler(
    deps.terrainSummary,
    config.distances.shellEndM,
  );
  let terrainSamplerRadius = config.distances.shellEndM;
  const debugState = createCanopyDebugState(config);
  const overlays = createCanopyDebugOverlays(deps.scene);

  let shell: FarCanopyShell | null = null;
  let textureSet: CanopyTextureSet | null = null;
  let metrics = createEmptyCanopyMetrics();
  let uploadBudgetUsed = 0;
  let textureRefreshPending = false;
  let centerX = deps.worldSizeCells / 2;
  let centerZ = deps.worldSizeCells / 2;

  clipmap.setFreezeCenter(config.debug.freezeClipCenter);

  const publish = () => {
    const counters = canopyMetricsToCounters(metrics, true);
    deps.onCounters?.(counters);
    debugState.statsLine = formatCanopyStatsLine(metrics, debugState.syntheticFallbackActive);
  };

  const positionShellAtTextureCenter = () => {
    if (!shell || !textureSet) return;
    const center = shellCenterForTextureSet(textureSet);
    shell.mesh.position.set(center.x, 0, center.z);
  };

  const disposeShellAndTextures = () => {
    if (shell) {
      deps.scene.remove(shell.mesh);
      shell.dispose();
      shell = null;
    }
    disposeCanopyTextureSet(textureSet);
    textureSet = null;
    metrics.shellTriangles = 0;
    debugState.syntheticFallbackActive = false;
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
      grid: shellGridForTriangleBudget(config.budgets.maxShellTris),
      buildRelative: true,
      skipInteriorHole: true,
      showCoverageHeatmap: debugState.showCoverageHeatmap,
      wireframe: debugState.showShellWireframe,
    });
    deps.scene.add(shell.mesh);
    metrics.shellTriangles = shell.triangleCount;
    positionShellAtTextureCenter();
  };

  const ensureTextures = (forceSynthetic: boolean): boolean => {
    if (!shouldKeepCanopyShellActive(config, forceSynthetic)) {
      disposeShellAndTextures();
      textureRefreshPending = false;
      return false;
    }

    const visibleTiles = clipmap.getVisibleTiles();
    const farRadius = config.distances.shellEndM;
    const useSynthetic = shouldUseSyntheticCanopyFallback(config, forceSynthetic, visibleTiles.length);

    const t0 = performance.now();
    const next = buildCanopyTextureSet({
      visibleTiles,
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

    if (shouldRebuildCanopyShell(textureSet, next)) {
      disposeCanopyTextureSet(textureSet);
      textureSet = next;
      rebuildShell(next);
    } else {
      disposeCanopyTextureSet(next);
    }
    return true;
  };

  const update = (cameraX: number, cameraZ: number) => {
    config = deps.getConfig();

    if (config.distances.shellEndM !== terrainSamplerRadius) {
      terrainSamplerRadius = config.distances.shellEndM;
      terrainSampler = createBlendedTerrainSampler(deps.terrainSummary, terrainSamplerRadius);
      clipmap.disposeFarTiles();
      textureRefreshPending = true;
    }

    const nextTreeKey = treeDistributionConfigKey(config);
    if (nextTreeKey !== treeDistributionKey) {
      treeDistributionKey = nextTreeKey;
      treeDistribution = createTreeDistribution(config.treeDistribution, config.seed);
      clipmap.disposeFarTiles();
      textureRefreshPending = true;
    }

    const nextTextureConfigKey = canopyTextureConfigKey(config);
    if (nextTextureConfigKey !== textureConfigKey) {
      textureConfigKey = nextTextureConfigKey;
      textureRefreshPending = true;
    }

    clipmap.setFreezeCenter(config.debug.freezeClipCenter || debugState.freezeClipCenter);
    const clipUpdate = clipmap.update(cameraX, cameraZ, config, terrainSampler, treeDistribution);
    centerX = clipUpdate.centerX;
    centerZ = clipUpdate.centerZ;
    metrics = { ...metrics, ...clipUpdate.metrics };

    if (!shouldKeepCanopyShellActive(config, false)) {
      disposeShellAndTextures();
      textureRefreshPending = false;
      updateCanopyDebugOverlays(overlays, clipmap.getVisibleTiles(), config, centerX, centerZ, debugState);
      publish();
      return;
    }

    uploadBudgetUsed = 0;
    if (clipUpdate.texturesDirty || textureRefreshPending || !textureSet) {
      if (shouldAttemptTextureUpload(config.budgets.maxTextureUploadsPerFrame, uploadBudgetUsed)) {
        const uploaded = ensureTextures(false);
        if (uploaded) textureRefreshPending = false;
        uploadBudgetUsed++;
      }
    }

    if (shell) {
      positionShellAtTextureCenter();
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
      textureConfigKey = canopyTextureConfigKey(config);
      textureRefreshPending = true;
      if (!shouldKeepCanopyShellActive(config, config.debug.forceSyntheticSource)) {
        disposeShellAndTextures();
        textureRefreshPending = false;
        publish();
        return;
      }
      if (shouldAttemptTextureUpload(config.budgets.maxTextureUploadsPerFrame, 0)) {
        const uploaded = ensureTextures(config.debug.forceSyntheticSource);
        if (uploaded) textureRefreshPending = false;
      }
      publish();
    },
    dispose() {
      disposeShellAndTextures();
      clipmap.dispose();
      overlays.dispose();
    },
  };
}

export type { CanopyDebugState };
export { createCanopyDebugState, canopyMetricsToCounters };
