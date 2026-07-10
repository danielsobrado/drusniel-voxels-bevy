import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { LongViewSunShadowsConfig, ShadowProxyConfig, ShadowProxyCoverage, ShadowProxyRuntime, ShadowProxySource } from "./shadowProxyTypes.js";
import { buildShadowProxyMesh, updateShadowProxyDebugMaterial } from "./shadowProxyBuilder.js";
import { createShadowProxyGeometryJob, type ShadowProxyGeometryJob } from "./shadowProxyGeometry.js";
import {
  configureLongViewSunShadows,
  createLongViewSunLight,
  createSunShadowCameraHelper,
  enableRendererShadowMaps,
  syncLongViewSunLight,
  type ShadowMapRenderer,
} from "./longViewSunShadows.js";
import { shadowProxyStatsToCounters } from "./shadowProxyStats.js";
import { computeShadowProxyCoverage } from "./shadowProxyValidation.js";

const SHADOW_PROXY_PENDING_MAX_MS = 30_000;

export interface ShadowProxyControllerDeps {
  scene: THREE.Scene;
  renderer: ShadowMapRenderer;
  getTerrainSummary: () => ShadowProxySource;
  worldSize: number;
  isLongView: boolean;
  streamingCentered: boolean;
  /** Snap distance for geometry rebuilds in streaming mode (not per-frame follow). */
  rebuildSnapMeters: number;
  getSunShadowsEnabled: () => boolean;
  getConfig: () => ShadowProxyConfig;
  getLighting: () => EnvironmentLighting;
  getCoverageCenter: () => { x: number; z: number };
  onSunShadowsChanged?: (enabled: boolean) => void;
  onCounters?: (counters: Record<string, number>) => void;
}

export interface ShadowProxyController {
  readonly runtime: ShadowProxyRuntime;
  readonly sunLight: THREE.DirectionalLight | null;
  readonly sunShadowCameraHelper: THREE.CameraHelper | null;
  syncSunLight(): void;
  setProxyEnabled(enabled: boolean): void;
  setSunShadowsEnabled(enabled: boolean): void;
  setShadowCameraHelperVisible(visible: boolean): void;
  applyDebugConfig(): void;
  updateFrame(cameraWorldX: number, cameraWorldZ: number): void;
  rebuildIfNeeded(force?: boolean): void;
  setOnSunShadowsChanged(handler: ((enabled: boolean) => void) | undefined): void;
  dispose(): void;
}

function snapCenter(x: number, z: number, snapM: number): { x: number; z: number } {
  if (snapM <= 0) return { x, z };
  return {
    x: Math.round(x / snapM) * snapM,
    z: Math.round(z / snapM) * snapM,
  };
}

function geometryConfigChanged(a: ShadowProxyConfig, b: ShadowProxyConfig): boolean {
  return a.gridRes !== b.gridRes
    || a.streamGridRes !== b.streamGridRes
    || a.startM !== b.startM
    || a.endM !== b.endM
    || a.heightBiasM !== b.heightBiasM
    || a.minHeightM !== b.minHeightM
    || a.maxHeightM !== b.maxHeightM
    || a.edgeFadeM !== b.edgeFadeM;
}

export function createShadowProxyController(
  longViewConfig: LongViewSunShadowsConfig,
  deps: ShadowProxyControllerDeps,
): ShadowProxyController {
  let config = { ...longViewConfig.shadowProxy };
  let proxyEnabled = config.enabled && deps.isLongView;
  let frozenGeometry = false;
  let builtSummaryRef: ShadowProxySource | null = null;
  let builtCenterX = Number.NaN;
  let builtCenterZ = Number.NaN;
  let pendingJob: {
    job: ShadowProxyGeometryJob;
    centerX: number;
    centerZ: number;
    summaryRef: ShadowProxySource;
    config: ShadowProxyConfig;
    coverage: ShadowProxyCoverage;
    startedMs: number;
  } | null = null;
  let runtime = buildDisabledRuntime();
  let sunLight: THREE.DirectionalLight | null = null;
  let sunHelper: THREE.CameraHelper | null = null;
  let disposed = false;
  let onSunShadowsChanged = deps.onSunShadowsChanged;
  let sunTarget = resolveSunTarget(deps);

  const sunShadowsEnabled = () => deps.getSunShadowsEnabled();

  const disposeSunLight = () => {
    if (sunHelper) {
      deps.scene.remove(sunHelper);
      sunHelper.dispose();
      sunHelper = null;
    }
    if (sunLight) {
      deps.scene.remove(sunLight);
      deps.scene.remove(sunLight.target);
      sunLight.dispose();
      sunLight = null;
    }
  };

  const ensureSunLight = () => {
    if (sunLight || !deps.isLongView) return;
    enableRendererShadowMaps(deps.renderer);
    sunTarget = resolveSunTarget(deps);
    sunLight = createLongViewSunLight(config, { castShadow: sunShadowsEnabled() });
    sunLight.target.position.copy(sunTarget);
    deps.scene.add(sunLight);
    deps.scene.add(sunLight.target);
    sunHelper = createSunShadowCameraHelper(sunLight);
    deps.scene.add(sunHelper);
    syncLongViewSunLight(sunLight, deps.getLighting(), 2.4, sunTarget);
  };

  if (deps.isLongView && longViewConfig.enabled && sunShadowsEnabled()) {
    ensureSunLight();
  }

  if (sunShadowsEnabled()) {
    onSunShadowsChanged?.(true);
  }

  const publishCounters = () => {
    const counters = shadowProxyStatsToCounters({
      proxyEnabled,
      sunShadowsEnabled: sunShadowsEnabled(),
      stats: runtime.stats,
      lightShadowMapSize: config.lightShadowMapSize,
      lightShadowCameraExtentM: config.lightShadowCameraExtentM,
    });
    const pendingAgeMs = pendingJob ? Math.max(0, performance.now() - pendingJob.startedMs) : 0;
    deps.onCounters?.({ ...counters, shadow_proxy_building: pendingJob ? 1 : 0, shadow_proxy_pending_age_ms: pendingAgeMs });
  };

  const removeProxyMesh = () => {
    if (runtime.mesh) deps.scene.remove(runtime.mesh);
  };

  const attachProxyMesh = () => {
    if (runtime.mesh && proxyEnabled) deps.scene.add(runtime.mesh);
  };

  const updateStreamingFollow = () => {
    if (!runtime.mesh || !deps.streamingCentered) return;
    runtime.mesh.position.set(builtCenterX, 0, builtCenterZ);
  };

  const applyCompletedBuild = (
    built: { centerX: number; centerZ: number; summaryRef: ShadowProxySource; config: ShadowProxyConfig },
    nextRuntime: ShadowProxyRuntime,
  ) => {
    removeProxyMesh();
    runtime.dispose();
    runtime = nextRuntime;
    builtSummaryRef = built.summaryRef;
    builtCenterX = built.centerX;
    builtCenterZ = built.centerZ;
    frozenGeometry = runtime.stats.built;
    if (runtime.mesh && deps.streamingCentered) {
      runtime.mesh.position.set(builtCenterX, 0, builtCenterZ);
    } else if (runtime.mesh) {
      runtime.mesh.position.set(0, 0, 0);
    }
    attachProxyMesh();
    publishCounters();
  };

  const buildBudgetMs = () => {
    const budget = config.buildBudgetMs;
    return Number.isFinite(budget) && budget > 0 ? budget : 2;
  };

  const stepPendingJob = () => {
    if (!pendingJob) return;
    const result = pendingJob.job.step(buildBudgetMs());
    if (!result) return;
    const done = pendingJob;
    pendingJob = null;
    applyCompletedBuild(done, buildShadowProxyMesh(done.summaryRef, done.config, done.coverage, result));
  };

  const pendingJobIsStale = (): boolean => {
    if (!pendingJob) return true;
    return performance.now() - pendingJob.startedMs > SHADOW_PROXY_PENDING_MAX_MS;
  };

  const rebuildProxy = (force = false) => {
    if (!deps.isLongView || !proxyEnabled) {
      pendingJob = null;
      removeProxyMesh();
      runtime.dispose();
      runtime = buildDisabledRuntime();
      builtSummaryRef = null;
      publishCounters();
      return;
    }
    const liveConfig = deps.getConfig();
    if (liveConfig.debugFreezeProxy && frozenGeometry && !force) {
      config = { ...config, ...liveConfig };
      updateShadowProxyDebugMaterial(runtime, liveConfig);
      publishCounters();
      return;
    }
    config = { ...config, ...liveConfig };
    const terrainSummary = deps.getTerrainSummary();
    const center = resolveCoverageCenter(deps);
    if (!force && pendingJob && terrainSummary === pendingJob.summaryRef && !pendingJobIsStale()) {
      publishCounters();
      return;
    }
    const coverage: ShadowProxyCoverage = {
      ...computeShadowProxyCoverage(deps.worldSize, config, center.x, center.z),
      buildRelative: deps.streamingCentered,
    };
    const buildConfig = deps.streamingCentered && config.streamGridRes > 1 && config.streamGridRes < config.gridRes
      ? { ...config, gridRes: Math.floor(config.streamGridRes) }
      : config;
    pendingJob = {
      job: createShadowProxyGeometryJob(terrainSummary, buildConfig, coverage),
      centerX: center.x,
      centerZ: center.z,
      summaryRef: terrainSummary,
      config: buildConfig,
      coverage,
      startedMs: performance.now(),
    };
    publishCounters();
    stepPendingJob();
  };

  rebuildProxy(true);

  const applySunShadowState = (enabled: boolean) => {
    if (!enabled) {
      disposeSunLight();
      onSunShadowsChanged?.(false);
      publishCounters();
      return;
    }
    ensureSunLight();
    if (sunLight) {
      sunTarget = resolveSunTarget(deps);
      sunLight.target.position.copy(sunTarget);
      sunLight.castShadow = true;
      configureLongViewSunShadows(sunLight, deps.getConfig(), { castShadow: true });
      syncLongViewSunLight(sunLight, deps.getLighting(), 2.4, sunTarget);
    }
    onSunShadowsChanged?.(true);
    publishCounters();
  };

  return {
    get runtime() { return runtime; },
    get sunLight() { return sunLight; },
    get sunShadowCameraHelper() { return sunHelper; },
    syncSunLight() {
      if (!sunShadowsEnabled()) {
        disposeSunLight();
        return;
      }
      ensureSunLight();
      if (!sunLight) return;
      sunTarget = resolveSunTarget(deps);
      syncLongViewSunLight(sunLight, deps.getLighting(), 2.4, sunTarget);
      configureLongViewSunShadows(sunLight, deps.getConfig(), { castShadow: true });
      sunLight.castShadow = true;
    },
    setProxyEnabled(enabled: boolean) {
      proxyEnabled = enabled && deps.isLongView;
      config = { ...config, enabled: proxyEnabled };
      rebuildProxy(true);
    },
    setSunShadowsEnabled(enabled: boolean) {
      applySunShadowState(enabled && deps.isLongView);
    },
    setShadowCameraHelperVisible(visible: boolean) {
      if (sunHelper) sunHelper.visible = visible;
    },
    applyDebugConfig() {
      const next = { ...deps.getConfig() };
      const geometryChanged = geometryConfigChanged(config, next);
      const summaryChanged = builtSummaryRef !== deps.getTerrainSummary();
      config = next;
      if (summaryChanged || geometryChanged) {
        rebuildProxy(true);
      } else {
        updateShadowProxyDebugMaterial(runtime, config);
      }
      if (!sunShadowsEnabled()) {
        disposeSunLight();
      } else {
        ensureSunLight();
        if (sunLight) {
          configureLongViewSunShadows(sunLight, config, { castShadow: true });
          sunLight.castShadow = true;
        }
      }
      publishCounters();
    },
    updateFrame(cameraWorldX: number, cameraWorldZ: number) {
      if (!deps.isLongView) return;
      stepPendingJob();
      if (!deps.streamingCentered) return;
      const snapped = snapCenter(cameraWorldX, cameraWorldZ, deps.rebuildSnapMeters);
      sunTarget = new THREE.Vector3(snapped.x, 0, snapped.z);
      if (sunLight) {
        sunLight.target.position.copy(sunTarget);
        sunLight.target.updateMatrixWorld();
      }
      const frozen = deps.getConfig().debugFreezeProxy && frozenGeometry;
      const targetCenterX = pendingJob ? pendingJob.centerX : builtCenterX;
      const targetCenterZ = pendingJob ? pendingJob.centerZ : builtCenterZ;
      if ((snapped.x !== targetCenterX || snapped.z !== targetCenterZ) && !frozen) {
        if (!pendingJob || pendingJobIsStale()) rebuildProxy(true);
      }
      updateStreamingFollow();
      publishCounters();
    },
    rebuildIfNeeded(force = false) {
      stepPendingJob();
      if (deps.getConfig().debugFreezeProxy && frozenGeometry && !force) return;
      const summary = deps.getTerrainSummary();
      const center = resolveCoverageCenter(deps);
      const targetSummary = pendingJob ? pendingJob.summaryRef : builtSummaryRef;
      const targetCenterX = pendingJob ? pendingJob.centerX : builtCenterX;
      const targetCenterZ = pendingJob ? pendingJob.centerZ : builtCenterZ;
      if (
        force
        || targetSummary !== summary
        || targetCenterX !== center.x
        || targetCenterZ !== center.z
      ) {
        rebuildProxy(force || !pendingJob || pendingJobIsStale());
      }
    },
    setOnSunShadowsChanged(handler: ((enabled: boolean) => void) | undefined) {
      onSunShadowsChanged = handler;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingJob = null;
      removeProxyMesh();
      runtime.dispose();
      disposeSunLight();
    },
  };
}

function resolveCoverageCenter(deps: ShadowProxyControllerDeps): { x: number; z: number } {
  if (deps.streamingCentered) {
    const live = deps.getCoverageCenter();
    return snapCenter(live.x, live.z, deps.rebuildSnapMeters);
  }
  return { x: deps.worldSize / 2, z: deps.worldSize / 2 };
}

function resolveSunTarget(deps: ShadowProxyControllerDeps): THREE.Vector3 {
  const center = resolveCoverageCenter(deps);
  return new THREE.Vector3(center.x, 0, center.z);
}

function buildDisabledRuntime(): ShadowProxyRuntime {
  return {
    mesh: null,
    stats: {
      enabled: false,
      built: false,
      gridRes: 0,
      vertexCount: 0,
      triangleCount: 0,
      buildMs: 0,
      worldMinX: 0,
      worldMaxX: 0,
      worldMinZ: 0,
      worldMaxZ: 0,
      minHeight: 0,
      maxHeight: 0,
      castShadow: false,
      receiveShadow: false,
      mainPassColorWrite: false,
      mainPassDepthWrite: false,
    },
    dispose() {},
  };
}
