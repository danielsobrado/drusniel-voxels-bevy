import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import {
  shouldUseDeterministicCanopy,
} from "./canopy_config.js";
import type { VegetationLodConfig } from "../vegetation/vegetation_lod_config.js";
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
  buildCanopyTextureSetFromFarSummary,
  disposeCanopyTextureSet,
  updateCanopyTextureSetInPlace,
} from "./canopy_texture.js";
import {
  buildCanopyGpuImpostorsFromTextureSet,
  canopyGpuImpostorDefaultOpacity,
  maxCanopyGpuImpostorInstances,
  setCanopyGpuImpostorOpacity,
  updateCanopyGpuImpostorsFromTextureSet,
  type CanopyGpuImpostorShell,
} from "./canopy_gpu_impostors.js";
import { createCanopyRemoteTileBuilder } from "./canopy_worker_client.js";
import { getNaadfIntegrationFromWindow } from "../naadf/canopyBridge.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import { getGlobalCoherentFarSummaryProvider } from "../terrain/far_clipmap/far_clipmap_source.js";

export interface CanopyShellSystemDeps {
  scene: THREE.Scene;
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  /** Resolved procedural terrain config; enables worker-side canopy tile builds when present. */
  terrainFieldConfig?: TerrainFieldConfig | null;
  getLighting: () => EnvironmentLighting;
  getConfig: () => CanopyShellConfig;
  getVegetationLodConfig: () => VegetationLodConfig;
  getDebugState: () => CanopyDebugState;
  onCounters?: (counters: Record<string, number>) => void;
  getFarSummaryProvider?: () => FarHeightProvider | undefined;
}

export interface CanopyShellSystem {
  readonly active: boolean;
  readonly debugState: CanopyDebugState;
  readonly shell: CanopyGpuImpostorShell | null;
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
  if (prev.originX !== next.originX || prev.originZ !== next.originZ) return true;
  if (prev.extentM !== next.extentM || prev.resolution !== next.resolution) return true;
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
  const x = set.originX + set.extentM * 0.5;
  const z = set.originZ + set.extentM * 0.5;
  return {
    x: Number.isFinite(x) ? x : 0,
    z: Number.isFinite(z) ? z : 0,
  };
}

export function shouldAttemptTextureUpload(
  maxTextureUploadsPerFrame: number,
  uploadsUsedThisFrame: number,
): boolean {
  return maxTextureUploadsPerFrame > uploadsUsedThisFrame;
}

export interface CanopyTextureRefreshState {
  hasTextureSet: boolean;
  texturesDirty: boolean;
  textureRefreshPending: boolean;
  queuedTiles: number;
}

export function shouldRefreshCanopyTextures(state: CanopyTextureRefreshState): boolean {
  if (!state.texturesDirty && !state.textureRefreshPending) return false;
  if (!state.hasTextureSet) return true;
  return state.queuedTiles <= 0;
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
  searchParams: URLSearchParams,
  scene: string | null,
  queryCanopy: boolean,
  deps: CanopyShellSystemDeps,
): CanopyShellSystem | null {
  let config = structuredClone(deps.getConfig());
  const active = shouldUseDeterministicCanopy(scene, config, queryCanopy);
  if (!active) return null;

  const unifiedSource = searchParams.get("farSummaryLayout") === "2"
    && searchParams.get("canopySource") !== "legacy";
  const persistentShell = unifiedSource && searchParams.get("canopyShellRebuild") !== "legacy";
  const impostorCoverageThreshold = unifiedSource ? 0.01 : 0.12;
  const getFarSummaryProvider = deps.getFarSummaryProvider ?? getGlobalCoherentFarSummaryProvider;

  // Canopy tiles build in a worker whenever one is available; NAADF scenes stay on the
  // main-thread path because the NAADF coverage merge lives in main-thread integration state.
  const remoteBuilder = unifiedSource ? null : createCanopyRemoteTileBuilder();
  const remoteSource = remoteBuilder
    ? {
      available: () => remoteBuilder.available() && getNaadfIntegrationFromWindow() === undefined,
      build: remoteBuilder.build,
    }
    : null;
  const configureRemoteBuilder = (): void => {
    remoteBuilder?.configure({
      terrainFieldConfig: deps.terrainFieldConfig ?? null,
      terrainSummary: deps.terrainSummary,
      farRadius: config.distances.shellEndM,
      config,
    });
  };
  configureRemoteBuilder();

  const clipmap = createCanopyClipmap(remoteSource);
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

  let shell: CanopyGpuImpostorShell | null = null;
  let standbyShell: CanopyGpuImpostorShell | null = null;
  let fadingFromShell: CanopyGpuImpostorShell | null = null;
  let fadingToShell: CanopyGpuImpostorShell | null = null;
  let textureSet: CanopyTextureSet | null = null;
  let metrics = createEmptyCanopyMetrics();
  let uploadBudgetUsed = 0;
  let textureRefreshPending = false;
  let centerX = deps.worldSizeCells / 2;
  let centerZ = deps.worldSizeCells / 2;
  let farSummaryRevision = -1;
  let farSummaryCenterX = Number.NaN;
  let farSummaryCenterZ = Number.NaN;
  let textureDirtySinceMs = 0;
  let fadeStartedAtMs = -1;

  clipmap.setFreezeCenter(config.debug.freezeClipCenter);

  const publish = () => {
    const counters = canopyMetricsToCounters(metrics, true);
    deps.onCounters?.(counters);
    debugState.statsLine = formatCanopyStatsLine(metrics, debugState.syntheticFallbackActive);
  };

  const positionShellAtTextureCenter = () => {
    if (!shell) return;
    shell.mesh.position.set(shell.centerX, 0, shell.centerZ);
    if (standbyShell) standbyShell.mesh.position.set(standbyShell.centerX, 0, standbyShell.centerZ);
    metrics.gpuImpostorCenterX = shell.centerX;
    metrics.gpuImpostorCenterZ = shell.centerZ;
  };

  const disposeShellAndTextures = () => {
    if (shell) {
      deps.scene.remove(shell.mesh);
      shell.dispose();
      shell = null;
    }
    if (standbyShell) {
      deps.scene.remove(standbyShell.mesh);
      standbyShell.dispose();
      standbyShell = null;
    }
    fadingFromShell = null;
    fadingToShell = null;
    disposeCanopyTextureSet(textureSet);
    textureSet = null;
    metrics.shellTriangles = 0;
    metrics.gpuImpostorEnabled = 0;
    metrics.gpuImpostorInstances = 0;
    metrics.gpuImpostorMaxInstances = 0;
    metrics.gpuImpostorCoverageThreshold = 0;
    metrics.gpuImpostorMaxColorChannel = 0;
    metrics.gpuImpostorOpacity = 0;
    debugState.syntheticFallbackActive = false;
  };

  const applyShellHandoff = (target: CanopyGpuImpostorShell) => {
    const handoff = deps.getVegetationLodConfig().canopyHandoff;
    target.materialHandle.updateTransition(handoff.startM, handoff.endM);
    target.materialHandle.updateLighting(deps.getLighting());
  };

  const rebuildShell = (set: CanopyTextureSet) => {
    if (shell) {
      deps.scene.remove(shell.mesh);
      shell.dispose();
    }
    const lighting = deps.getLighting();
    shell = buildCanopyGpuImpostorsFromTextureSet(set, config, lighting, {
      maxInstances: maxCanopyGpuImpostorInstances(config.budgets.maxShellTris),
      coverageThreshold: impostorCoverageThreshold,
      sampleStride: 1,
    });
    applyShellHandoff(shell);
    deps.scene.add(shell.mesh);
    metrics.shellTriangles = shell.triangleCount;
    metrics.gpuImpostorEnabled = 1;
    metrics.gpuImpostorInstances = shell.instanceCount;
    metrics.gpuImpostorBuilds++;
    metrics.shellRebuildsTotal++;
    metrics.gpuImpostorMaxInstances = shell.maxInstances;
    metrics.gpuImpostorCoverageThreshold = shell.coverageThreshold;
    metrics.gpuImpostorMaxColorChannel = Number(shell.mesh.userData.canopyGpuImpostorMaxColorChannel) || 0;
    metrics.gpuImpostorOpacity = Number(shell.mesh.userData.canopyGpuImpostorOpacity) || 0;
    positionShellAtTextureCenter();
    if (persistentShell && !standbyShell) {
      standbyShell = buildCanopyGpuImpostorsFromTextureSet(set, config, lighting, {
        maxInstances: maxCanopyGpuImpostorInstances(config.budgets.maxShellTris),
        coverageThreshold: impostorCoverageThreshold,
        sampleStride: 1,
      });
      applyShellHandoff(standbyShell);
      setCanopyGpuImpostorOpacity(standbyShell, 0);
      standbyShell.mesh.visible = false;
      deps.scene.add(standbyShell.mesh);
      metrics.gpuImpostorBuilds++;
      metrics.shellRebuildsTotal++;
    }
  };

  const refreshPersistentShell = (set: CanopyTextureSet) => {
    if (!shell) {
      rebuildShell(set);
      return;
    }
    if (!standbyShell) return;
    updateCanopyGpuImpostorsFromTextureSet(standbyShell, set, config, deps.getLighting());
    applyShellHandoff(standbyShell);
    metrics.shellTriangles = standbyShell.triangleCount;
    metrics.gpuImpostorInstances = standbyShell.instanceCount;
    metrics.gpuImpostorCenterX = standbyShell.centerX;
    metrics.gpuImpostorCenterZ = standbyShell.centerZ;
    metrics.gpuImpostorMaxColorChannel = Number(standbyShell.mesh.userData.canopyGpuImpostorMaxColorChannel) || 0;
    metrics.textureUploadBytesTotal += standbyShell.instanceCount * (16 + 3) * Float32Array.BYTES_PER_ELEMENT;
    setCanopyGpuImpostorOpacity(standbyShell, 0);
    standbyShell.mesh.visible = true;
    fadingFromShell = shell;
    fadingToShell = standbyShell;
    fadeStartedAtMs = performance.now();
    positionShellAtTextureCenter();
  };

  const ensureTextures = (forceSynthetic: boolean): boolean => {
    if (!shouldKeepCanopyShellActive(config, forceSynthetic)) {
      disposeShellAndTextures();
      textureRefreshPending = false;
      return false;
    }

    const farRadius = config.distances.shellEndM;
    const t0 = performance.now();
    let next: CanopyTextureSet;
    if (unifiedSource && !forceSynthetic && !config.debug.forceSyntheticSource) {
      const provider = getFarSummaryProvider();
      if (!provider?.sampleSummaryInto) return false;
      const built = buildCanopyTextureSetFromFarSummary({ provider, config, centerX, centerZ });
      next = built.set;
      metrics.farSummaryHits = built.hits;
      metrics.farSummaryMisses = built.misses;
      metrics.averageCoverage = built.averageCoverage;
      metrics.maxCoverage = built.maxCoverage;
      farSummaryRevision = provider.revision?.() ?? farSummaryRevision;
      farSummaryCenterX = centerX;
      farSummaryCenterZ = centerZ;
    } else {
      const visibleTiles = clipmap.getVisibleTiles();
      const useSynthetic = shouldUseSyntheticCanopyFallback(config, forceSynthetic, visibleTiles.length);
      next = buildCanopyTextureSet({
        visibleTiles,
        config,
        centerX,
        centerZ,
        syntheticFallback: useSynthetic,
        terrainSummary: deps.terrainSummary,
        farRadius,
      });
    }
    debugState.syntheticFallbackActive = next.syntheticFallback;
    if (next.syntheticFallback) metrics.fallbackSyntheticTiles++;
    metrics.uploadMs = performance.now() - t0;
    metrics.textureUploads++;

    if (persistentShell) {
      refreshPersistentShell(next);
      if (textureSet && updateCanopyTextureSetInPlace(textureSet, next)) {
        disposeCanopyTextureSet(next);
      } else {
        disposeCanopyTextureSet(textureSet);
        textureSet = next;
      }
    } else if (shouldRebuildCanopyShell(textureSet, next)) {
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
      configureRemoteBuilder();
      textureRefreshPending = true;
    }

    const nextTreeKey = treeDistributionConfigKey(config);
    if (nextTreeKey !== treeDistributionKey) {
      treeDistributionKey = nextTreeKey;
      treeDistribution = createTreeDistribution(config.treeDistribution, config.seed);
      clipmap.disposeFarTiles();
      configureRemoteBuilder();
      textureRefreshPending = true;
    }

    const nextTextureConfigKey = canopyTextureConfigKey(config);
    if (nextTextureConfigKey !== textureConfigKey) {
      textureConfigKey = nextTextureConfigKey;
      textureRefreshPending = true;
    }

    const freezeCenter = config.debug.freezeClipCenter || debugState.freezeClipCenter;
    const runtimeMetrics = {
      fallbackSyntheticTiles: metrics.fallbackSyntheticTiles,
      textureUploads: metrics.textureUploads,
      shellTriangles: metrics.shellTriangles,
      gpuImpostorEnabled: metrics.gpuImpostorEnabled,
      gpuImpostorInstances: metrics.gpuImpostorInstances,
      gpuImpostorBuilds: metrics.gpuImpostorBuilds,
      gpuImpostorMaxInstances: metrics.gpuImpostorMaxInstances,
      gpuImpostorCoverageThreshold: metrics.gpuImpostorCoverageThreshold,
      gpuImpostorCenterX: metrics.gpuImpostorCenterX,
      gpuImpostorCenterZ: metrics.gpuImpostorCenterZ,
      gpuImpostorMaxColorChannel: metrics.gpuImpostorMaxColorChannel,
      gpuImpostorOpacity: metrics.gpuImpostorOpacity,
      uploadMs: metrics.uploadMs,
      averageCoverage: metrics.averageCoverage,
      maxCoverage: metrics.maxCoverage,
      farSummaryHits: metrics.farSummaryHits,
      farSummaryMisses: metrics.farSummaryMisses,
      shellRebuildsTotal: metrics.shellRebuildsTotal,
      textureUploadBytesTotal: metrics.textureUploadBytesTotal,
    };
    let texturesDirty = false;
    if (unifiedSource) {
      const provider = getFarSummaryProvider();
      const snapM = Math.max(128, Math.min(256, (config.clipmap.rings[0]?.cellSizeM ?? 32) * 4));
      const nextCenterX = freezeCenter && Number.isFinite(farSummaryCenterX)
        ? farSummaryCenterX
        : Math.round(cameraX / snapM) * snapM;
      const nextCenterZ = freezeCenter && Number.isFinite(farSummaryCenterZ)
        ? farSummaryCenterZ
        : Math.round(cameraZ / snapM) * snapM;
      const revision = provider?.revision?.() ?? -1;
      texturesDirty = textureSet === null
        || nextCenterX !== farSummaryCenterX
        || nextCenterZ !== farSummaryCenterZ
        || revision !== farSummaryRevision;
      centerX = nextCenterX;
      centerZ = nextCenterZ;
      metrics = {
        ...createEmptyCanopyMetrics(),
        ...runtimeMetrics,
        requestedTiles: provider ? 1 : 0,
        visibleTiles: provider ? 1 : 0,
        queuedTiles: provider ? 0 : 1,
      };
    } else {
      clipmap.setFreezeCenter(freezeCenter);
      const clipUpdate = clipmap.update(cameraX, cameraZ, config, terrainSampler, treeDistribution);
      centerX = clipUpdate.centerX;
      centerZ = clipUpdate.centerZ;
      texturesDirty = clipUpdate.texturesDirty;
      metrics = { ...clipUpdate.metrics, ...runtimeMetrics };
    }

    if (!shouldKeepCanopyShellActive(config, false)) {
      disposeShellAndTextures();
      textureRefreshPending = false;
      updateCanopyDebugOverlays(
        overlays,
        clipmap.getVisibleTiles(),
        config,
        centerX,
        centerZ,
        debugState,
        deps.getVegetationLodConfig().canopyHandoff,
      );
      publish();
      return;
    }

    uploadBudgetUsed = 0;
    if (texturesDirty && !textureRefreshPending) {
      textureRefreshPending = true;
      textureDirtySinceMs = performance.now();
    }
    const debounceReady = textureSet === null
      || !persistentShell
      || (fadeStartedAtMs < 0 && performance.now() - textureDirtySinceMs >= 500);
    if (shouldRefreshCanopyTextures({
      hasTextureSet: textureSet !== null,
      texturesDirty,
      textureRefreshPending,
      queuedTiles: metrics.queuedTiles,
    }) && debounceReady) {
      if (shouldAttemptTextureUpload(config.budgets.maxTextureUploadsPerFrame, uploadBudgetUsed)) {
        const uploaded = ensureTextures(false);
        if (uploaded) {
          textureRefreshPending = false;
          textureDirtySinceMs = 0;
        }
        uploadBudgetUsed++;
      }
    }

    if (shell) {
      if (fadeStartedAtMs >= 0) {
        const fadeT = Math.min(1, (performance.now() - fadeStartedAtMs) / 1000);
        if (fadingFromShell) setCanopyGpuImpostorOpacity(fadingFromShell, canopyGpuImpostorDefaultOpacity() * (1 - fadeT));
        if (fadingToShell) setCanopyGpuImpostorOpacity(fadingToShell, canopyGpuImpostorDefaultOpacity() * fadeT);
        if (fadeT >= 1 && fadingFromShell && fadingToShell) {
          fadingFromShell.mesh.visible = false;
          standbyShell = fadingFromShell;
          shell = fadingToShell;
          fadingFromShell = null;
          fadingToShell = null;
          fadeStartedAtMs = -1;
        }
      }
      positionShellAtTextureCenter();
      const material = shell.mesh.material;
      if (!Array.isArray(material) && "wireframe" in material) material.wireframe = debugState.showShellWireframe;
    }

    updateCanopyDebugOverlays(
      overlays,
      clipmap.getVisibleTiles(),
      config,
      centerX,
      centerZ,
      debugState,
      deps.getVegetationLodConfig().canopyHandoff,
    );
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
      remoteBuilder?.dispose();
    },
  };
}

export type { CanopyDebugState };
export { createCanopyDebugState, canopyMetricsToCounters };
