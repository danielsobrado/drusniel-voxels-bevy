import type * as THREE from "three";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropPlacementScene } from "../props/prop_types.js";
import { PropColliderSet } from "../props/prop_collider.js";
import { PropSystem } from "../props/prop_system.js";
import type { PropStats } from "../props/prop_stats.js";
import type { ClodHooks } from "../core/hooks.js";
import { resolvePropSnapPlacement, type PropSnapPlacementInput, type PropSnapPlacementResult } from "../props/prop_snap.js";
import type { PropSpatialGrid } from "../props/prop_spatial_grid.js";
import { propGpuRingUnsupportedReason } from "../gpu/prop_ring_compute.js";
import { reportGpuCpuFallback } from "../gpu/gpu_cpu_fallback_log.js";

const COLLIDER_SYNC_MIN_INTERVAL_MS = 75;
const COLLIDER_SYNC_MIN_DISTANCE_M = 0.35;
const COLLIDER_SYNC_MIN_DISTANCE_SQ = COLLIDER_SYNC_MIN_DISTANCE_M * COLLIDER_SYNC_MIN_DISTANCE_M;

interface PropSystemSnapAccess {
  grid: PropSpatialGrid | null;
  assetById: Map<string, PropAssetDef>;
  metadataByAssetId: Map<string, PropAssetMetadata>;
}

export interface PropControllerDeps {
  scene: THREE.Scene;
  settings: CustomPropsSettings;
  placementScene: PropPlacementScene;
  getHooks?: () => ClodHooks | null;
  syncStatsToState?: (stats: PropStats) => void;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: {
    createStorageAttribute(attribute: THREE.BufferAttribute): void;
    createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
    get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
  } | null;
}

export interface PropController {
  readonly system: PropSystem;
  readonly colliderSet: PropColliderSet;
  init(): Promise<void>;
  update(camera: THREE.PerspectiveCamera, ringCenter?: THREE.Vector3): void;
  syncColliders(playerPos: [number, number, number]): void;
  setEnabled(enabled: boolean): void;
  refreshStats(): void;
  getPlacementSceneSnapshot(): PropPlacementScene;
  replacePlacementScene(scene: PropPlacementScene): void;
  resolveSnapPlacement(input: PropSnapPlacementInput): PropSnapPlacementResult | null;
  availablePrefabIds(): string[];
  dispose(): void;
}

export function createPropController(deps: PropControllerDeps): PropController {
  const fallbackReason = propGpuCpuFallbackReason(deps);
  if (fallbackReason) reportGpuCpuFallback("props-gpu-ring", fallbackReason);

  const system = new PropSystem({
    scene: deps.scene,
    settings: { ...deps.settings },
    placementScene: deps.placementScene,
    getHooks: deps.getHooks,
    gpuDevice: deps.gpuDevice,
    gpuBackend: deps.gpuBackend,
  });
  const colliderSet = new PropColliderSet();
  let collidersEnabled = deps.settings.enabled;
  let forceColliderSync = true;
  let lastColliderSyncAt = Number.NEGATIVE_INFINITY;
  let lastColliderSyncPos: [number, number, number] | null = null;

  const refreshStats = () => {
    deps.syncStatsToState?.(system.getStats());
  };

  const shouldSyncColliders = (playerPos: [number, number, number]): boolean => {
    if (forceColliderSync || !lastColliderSyncPos) return true;
    const now = performance.now();
    if (now - lastColliderSyncAt >= COLLIDER_SYNC_MIN_INTERVAL_MS) return true;
    const dx = playerPos[0] - lastColliderSyncPos[0];
    const dy = playerPos[1] - lastColliderSyncPos[1];
    const dz = playerPos[2] - lastColliderSyncPos[2];
    return dx * dx + dy * dy + dz * dz >= COLLIDER_SYNC_MIN_DISTANCE_SQ;
  };

  const resolveSnap = (input: PropSnapPlacementInput): PropSnapPlacementResult | null => {
    const snapAccess = system as unknown as PropSystemSnapAccess;
    if (!snapAccess.grid) return null;
    return resolvePropSnapPlacement(input, snapAccess.grid.instances, snapAccess.assetById, snapAccess.metadataByAssetId);
  };

  return {
    system,
    colliderSet,
    async init() {
      await system.init();
      forceColliderSync = true;
      refreshStats();
    },
    update(camera, ringCenter) {
      system.update(camera, ringCenter);
      refreshStats();
    },
    syncColliders(playerPos) {
      if (!collidersEnabled) return;
      if (!shouldSyncColliders(playerPos)) return;
      const instances = system.buildColliderInstances(playerPos);
      colliderSet.sync(instances);
      system.setCollidersActive(colliderSet.activeCount());
      lastColliderSyncAt = performance.now();
      lastColliderSyncPos = [...playerPos] as [number, number, number];
      forceColliderSync = false;
    },
    setEnabled(enabled) {
      collidersEnabled = enabled;
      system.setEnabled(enabled);
      if (!enabled) {
        colliderSet.sync([]);
        system.setCollidersActive(0);
      }
      forceColliderSync = true;
      refreshStats();
    },
    refreshStats,
    getPlacementSceneSnapshot() {
      return system.getPlacementSceneSnapshot();
    },
    replacePlacementScene(scene) {
      system.replacePlacementScene(scene);
      colliderSet.sync([]);
      system.setCollidersActive(0);
      forceColliderSync = true;
      refreshStats();
    },
    resolveSnapPlacement(input) {
      return resolveSnap(input);
    },
    availablePrefabIds() {
      return system.availablePrefabIds();
    },
    dispose() {
      colliderSet.dispose();
      system.dispose();
    },
  };
}

export function propGpuCpuFallbackReason(deps: PropControllerDeps): string | null {
  const gpu = deps.settings.gpu;
  if (!deps.settings.enabled || !gpu.enabled || !gpu.fallbackToCpu || gpu.debugForceCpu) return null;
  if (!deps.gpuDevice) return "WebGPU device unavailable";
  if (!deps.gpuBackend) return "WebGPU renderer backend unavailable";
  return propGpuRingUnsupportedReason(deps.gpuDevice);
}
