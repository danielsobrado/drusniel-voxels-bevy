import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { LongViewSunShadowsConfig, ShadowProxyConfig, ShadowProxyCoverage, ShadowProxyRuntime, ShadowProxySource } from "./shadowProxyTypes.js";
import { buildShadowProxyMesh, updateShadowProxyDebugMaterial } from "./shadowProxyBuilder.js";
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

export interface ShadowProxyControllerDeps {
  scene: THREE.Scene;
  renderer: ShadowMapRenderer;
  getTerrainSummary: () => ShadowProxySource;
  worldSize: number;
  isLongView: boolean;
  streamingCentered: boolean;
  rebaseSnapMeters: number;
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
  let runtime = buildDisabledRuntime();
  let sunLight: THREE.DirectionalLight | null = null;
  let sunHelper: THREE.CameraHelper | null = null;
  let disposed = false;
  let onSunShadowsChanged = deps.onSunShadowsChanged;
  let sunTarget = resolveSunTarget(deps);

  const sunShadowsEnabled = () => deps.getSunShadowsEnabled();

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
    deps.onCounters?.(counters);
  };

  const removeProxyMesh = () => {
    if (runtime.mesh) deps.scene.remove(runtime.mesh);
  };

  const attachProxyMesh = () => {
    if (runtime.mesh && proxyEnabled) deps.scene.add(runtime.mesh);
  };

  const rebuildProxy = (force = false) => {
    if (!deps.isLongView || !proxyEnabled) {
      removeProxyMesh();
      runtime.dispose();
      runtime = buildDisabledRuntime();
      builtSummaryRef = null;
      publishCounters();
      return;
    }
    const terrainSummary = deps.getTerrainSummary();
    const center = resolveCoverageCenter(deps);
    const coverage: ShadowProxyCoverage = computeShadowProxyCoverage(
      deps.worldSize,
      config,
      center.x,
      center.z,
    );
    const sameSummary = builtSummaryRef === terrainSummary;
    const sameCenter = builtCenterX === center.x && builtCenterZ === center.z;
    if (config.debugFreezeProxy && frozenGeometry && !force && sameSummary && sameCenter) {
      updateShadowProxyDebugMaterial(runtime, config);
      publishCounters();
      return;
    }
    removeProxyMesh();
    runtime.dispose();
    runtime = buildShadowProxyMesh(terrainSummary, config, coverage);
    builtSummaryRef = terrainSummary;
    builtCenterX = center.x;
    builtCenterZ = center.z;
    frozenGeometry = runtime.stats.built;
    attachProxyMesh();
    publishCounters();
  };

  rebuildProxy(true);

  const applySunShadowState = (enabled: boolean) => {
    if (enabled) ensureSunLight();
    if (sunLight) {
      sunTarget = resolveSunTarget(deps);
      sunLight.target.position.copy(sunTarget);
      sunLight.castShadow = enabled;
      configureLongViewSunShadows(sunLight, deps.getConfig(), { castShadow: enabled });
      syncLongViewSunLight(sunLight, deps.getLighting(), 2.4, sunTarget);
    }
    deps.onSunShadowsChanged?.(enabled);
    onSunShadowsChanged?.(enabled);
    publishCounters();
  };

  return {
    get runtime() { return runtime; },
    get sunLight() { return sunLight; },
    get sunShadowCameraHelper() { return sunHelper; },
    syncSunLight() {
      if (!sunLight) return;
      sunTarget = resolveSunTarget(deps);
      syncLongViewSunLight(sunLight, deps.getLighting(), 2.4, sunTarget);
      configureLongViewSunShadows(sunLight, deps.getConfig(), { castShadow: sunShadowsEnabled() });
      sunLight.castShadow = sunShadowsEnabled();
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
      config = next;
      if (builtSummaryRef !== deps.getTerrainSummary() || geometryChanged) {
        rebuildProxy(true);
      } else if (config.debugFreezeProxy && frozenGeometry && !geometryChanged) {
        updateShadowProxyDebugMaterial(runtime, config);
      } else {
        rebuildProxy(true);
      }
      if (sunLight) {
        configureLongViewSunShadows(sunLight, config, { castShadow: sunShadowsEnabled() });
        sunLight.castShadow = sunShadowsEnabled();
      }
      publishCounters();
    },
    updateFrame(cameraWorldX: number, cameraWorldZ: number) {
      if (!deps.isLongView || !deps.streamingCentered) return;
      const snapped = snapCenter(cameraWorldX, cameraWorldZ, deps.rebaseSnapMeters);
      if (snapped.x === builtCenterX && snapped.z === builtCenterZ) return;
      sunTarget = new THREE.Vector3(snapped.x, 0, snapped.z);
      if (sunLight) {
        sunLight.target.position.copy(sunTarget);
        sunLight.target.updateMatrixWorld();
      }
      rebuildProxy(true);
    },
    rebuildIfNeeded(force = false) {
      const summary = deps.getTerrainSummary();
      const center = resolveCoverageCenter(deps);
      if (
        force
        || builtSummaryRef !== summary
        || builtCenterX !== center.x
        || builtCenterZ !== center.z
      ) {
        rebuildProxy(force);
      }
    },
    setOnSunShadowsChanged(handler: ((enabled: boolean) => void) | undefined) {
      onSunShadowsChanged = handler;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeProxyMesh();
      runtime.dispose();
      if (sunHelper) {
        deps.scene.remove(sunHelper);
        sunHelper.dispose();
      }
      if (sunLight) {
        deps.scene.remove(sunLight);
        deps.scene.remove(sunLight.target);
        sunLight.dispose();
      }
      sunLight = null;
      sunHelper = null;
    },
  };
}

function resolveCoverageCenter(deps: ShadowProxyControllerDeps): { x: number; z: number } {
  if (deps.streamingCentered) {
    const live = deps.getCoverageCenter();
    return snapCenter(live.x, live.z, deps.rebaseSnapMeters);
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
