import * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropPlacementScene } from "./prop_types.js";
import { PropAssetRegistry, type LoadedPropAsset } from "./prop_asset_loader.js";
import { assignPropCellCoords } from "./prop_placements.js";
import { cullPropSpatialGrid } from "./prop_culling.js";
import { PropDebugOverlay } from "./prop_debug.js";
import {
  propDistanceToCamera,
  propNeedsCollider,
} from "./prop_lod.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";
import { EMPTY_PROP_STATS, syncPropStatsToHooks, type PropStats } from "./prop_stats.js";
import type { PropColliderInstanceInput } from "./prop_collider.js";
import { collectPropDebugCells, emptyPropDebugPayload } from "./prop_system_debug.js";
import {
  cellKey,
  type CellBuildContext,
  type PropWebGpuBackendAccess,
} from "./prop_system_support.js";
import {
  clearPropGpuRing,
  createPropGpuRingRuntimeState,
  resolvePropGpuRingStatus,
  updatePropGpuRing,
  usesPropGpuRingDraw,
  type PropGpuRingRuntimeInput,
  type PropGpuRingRuntimeState,
} from "./prop_gpu_ring_runtime.js";
import {
  clearPropCpuBuckets,
  collectPropCpuDebugBounds,
  createPropCpuBucketRuntimeState,
  enqueuePropCpuRingJobs,
  ensurePropCpuBuckets,
  processPropCpuCellJobs,
  processPropCpuMatrixUploads,
  resetPropCpuBucketStreamingState,
  setPropCpuBucketsVisible,
  visiblePropCpuBucketCount,
  type PropCpuBucketRuntimeInput,
  type PropCpuBucketRuntimeState,
} from "./prop_cpu_bucket_runtime.js";

export interface PropSystemDeps {
  scene: THREE.Scene;
  settings: CustomPropsSettings;
  placementScene: PropPlacementScene;
  getHooks?: () => ClodHooks | null;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: PropWebGpuBackendAccess | null;
}

export function propStreamingCenter(camera: THREE.Camera, ringCenter?: THREE.Vector3 | null): [number, number, number] {
  const center = ringCenter ?? camera.position;
  return [center.x, center.y, center.z];
}

export { propGpuStatus } from "./prop_system_support.js";
export {
  clearPropGpuRing,
  createPropGpuRingRuntimeState,
  ensurePropGpuRing,
  packPropGpuFrustumPlanes,
  resolvePropGpuRingStatus,
  setPropGpuRingVisible,
  updatePropGpuRing,
  usesPropGpuRingDraw,
  type PropGpuRingRuntimeInput,
  type PropGpuRingRuntimeState,
} from "./prop_gpu_ring_runtime.js";
export {
  clearPropCpuBuckets,
  collectPropCpuDebugBounds,
  createPropCpuBucketRuntimeState,
  enqueuePropCpuRingJobs,
  ensurePropCpuBuckets,
  processPropCpuCellJobs,
  processPropCpuMatrixUploads,
  resetPropCpuBucketStreamingState,
  setPropCpuBucketsVisible,
  visiblePropCpuBucketCount,
  type PropCpuBucketRuntimeInput,
  type PropCpuBucketRuntimeState,
} from "./prop_cpu_bucket_runtime.js";

export class PropSystem {
  private readonly root = new THREE.Group();
  private readonly registry: PropAssetRegistry;
  private readonly debug: PropDebugOverlay;
  private grid: PropSpatialGrid | null = null;
  private readonly assetById = new Map<string, PropAssetDef>();
  private readonly loadedAssets = new Map<string, LoadedPropAsset>();
  private readonly metadataByAssetId = new Map<string, PropAssetMetadata>();
  private readonly gpuRing: PropGpuRingRuntimeState = createPropGpuRingRuntimeState();
  private readonly cpuBuckets: PropCpuBucketRuntimeState = createPropCpuBucketRuntimeState();
  private frameId = 0;
  private ready = false;
  private stats: PropStats = { ...EMPTY_PROP_STATS };
  private collidersActive = 0;
  private colliderQueryRadius = 0;

  constructor(private readonly deps: PropSystemDeps) {
    this.root.name = "custom-props";
    deps.scene.add(this.root);
    this.registry = new PropAssetRegistry(deps.settings);
    this.debug = new PropDebugOverlay(deps.scene);
    for (const def of deps.settings.props) this.assetById.set(def.id, def);
  }

  get isReady(): boolean {
    return this.ready;
  }

  getStats(): PropStats {
    return this.stats;
  }

  availablePrefabIds(): string[] {
    return [...this.assetById.keys()].sort((a, b) => a.localeCompare(b));
  }

  getPlacementSceneSnapshot(): PropPlacementScene {
    const instances = (this.grid?.instances ?? this.deps.placementScene.instances).map((instance) => ({
      assetId: instance.assetId,
      position: [...instance.position] as [number, number, number],
      rotationY: instance.rotationY,
      scale: instance.scale,
      seed: instance.seed,
      variationId: instance.variationId,
      flags: instance.flags,
      revision: instance.revision,
    }));
    return {
      schemaVersion: this.deps.placementScene.schemaVersion,
      sceneId: this.deps.placementScene.sceneId,
      instances,
    };
  }

  buildColliderInstances(playerPos: [number, number, number]): PropColliderInstanceInput[] {
    if (!this.grid || this.colliderQueryRadius <= 0) return [];
    const out: PropColliderInstanceInput[] = [];
    const cells = this.grid.nearbyCells(playerPos, this.colliderQueryRadius);
    for (const cell of cells) {
      for (const idx of cell.instanceIndices) {
        const inst = this.grid.instances[idx]!;
        const def = this.assetById.get(inst.assetId);
        const loaded = this.loadedAssets.get(inst.assetId);
        if (!def || !loaded) continue;
        const radius = loaded.metadata.boundingSphereRadius * inst.scale;
        const distance = propDistanceToCamera(playerPos, inst.position, radius);
        if (!propNeedsCollider(def, distance)) continue;
        out.push({
          key: String(idx),
          mode: def.collision.mode,
          position: inst.position,
          rotationY: inst.rotationY,
          scale: inst.scale,
          asset: loaded,
        });
      }
    }
    return out;
  }

  setCollidersActive(count: number): void {
    this.collidersActive = count;
  }

  async init(): Promise<void> {
    const { loaded } = await this.registry.loadManifest();
    for (const asset of loaded) {
      this.loadedAssets.set(asset.def.id, asset);
      this.metadataByAssetId.set(asset.def.id, asset.metadata);
    }
    this.replacePlacementScene(this.deps.placementScene);
    this.ready = true;
  }

  replacePlacementScene(placementScene: PropPlacementScene): void {
    this.deps.placementScene = placementScene;
    const instances = assignPropCellCoords(placementScene.instances, this.deps.settings.spatial.cellSizeM);
    this.grid = PropSpatialGrid.fromInstances(instances, this.deps.settings.spatial.cellSizeM);
    this.colliderQueryRadius = this.computeColliderQueryRadius();
    this.cpuBuckets.lodState.clear();
    clearPropGpuRing(this.gpuRingInput());
    clearPropCpuBuckets(this.cpuBucketInput());
    ensurePropCpuBuckets(this.cpuBucketInput());
    resetPropCpuBucketStreamingState(this.cpuBuckets);
    this.stats = {
      ...EMPTY_PROP_STATS,
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      collidersActive: this.collidersActive,
      gpuStatus: this.resolveGpuStatus(),
    };
  }

  update(camera: THREE.PerspectiveCamera, ringCenter?: THREE.Vector3): void {
    if (!this.ready || !this.grid || !this.deps.settings.enabled) {
      this.root.visible = false;
      return;
    }

    const t0 = performance.now();
    this.frameId++;
    this.root.visible = true;

    const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    const streamCenter = propStreamingCenter(camera, ringCenter);
    const ringRadius = this.computeRingRadius();

    if (usesPropGpuRingDraw(this.deps.settings) && updatePropGpuRing(this.gpuRingInput(), camera, streamCenter, ringRadius)) {
      const stats = this.gpuRing.stats;
      setPropCpuBucketsVisible(this.cpuBuckets, false);
      this.stats = {
        ...EMPTY_PROP_STATS,
        totalInstances: this.grid.instances.length,
        cellsTotal: this.grid.cells.size,
        cellsVisible: 0,
        cellsCulled: 0,
        instancesVisible: stats?.visibleCount ?? 0,
        instancesCulled: Math.max(0, this.grid.instances.length - (stats?.visibleCount ?? 0)),
        drawCallsOpaque: this.gpuRing.draw?.meshes.length ?? 0,
        drawCallsTotal: this.gpuRing.draw?.meshes.length ?? 0,
        collidersActive: this.collidersActive,
        gpuStatus: this.gpuRing.status,
        gpuCandidateCount: stats?.candidateCount ?? this.grid.instances.length,
        gpuVisibleCount: stats?.visibleCount ?? 0,
        gpuOverflowed: stats?.overflowed ?? false,
        gpuDispatchMs: stats?.submitMs ?? null,
        updateMs: performance.now() - t0,
      };
      const hooks = this.deps.getHooks?.();
      if (hooks?.stats) syncPropStatsToHooks(this.stats, hooks.stats.counters);
      return;
    }

    setPropCpuBucketsVisible(this.cpuBuckets, true);
    const candidateCells = this.grid.nearbyCells(streamCenter, ringRadius);
    const cull = cullPropSpatialGrid(this.grid, camera, this.deps.settings, this.metadataByAssetId, this.frameId, candidateCells);
    const visibleInstanceIndices = new Set(cull.visibleInstanceIndices);
    const viewportH = Math.max(1, window.innerHeight);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const debugEnabled = this.deps.settings.debug.showCells
      || this.deps.settings.debug.showBounds
      || this.deps.settings.debug.lodColorOverlay;

    const cpuInput = this.cpuBucketInput();
    enqueuePropCpuRingJobs(cpuInput, cull.visibleCellKeys, streamCenter);
    const context: CellBuildContext = { camPos, viewportH, fovY, visibleInstanceIndices, debugEnabled };
    processPropCpuCellJobs(cpuInput, context);
    processPropCpuMatrixUploads(cpuInput);

    const drawCallsTotal = visiblePropCpuBucketCount(this.cpuBuckets);
    this.updateDebug(debugEnabled, this.cpuBuckets.activeCellKeys, collectPropCpuDebugBounds(this.cpuBuckets, debugEnabled));

    this.stats = {
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      cellsVisible: this.cpuBuckets.activeCellKeys.size,
      cellsCulled: Math.max(0, this.grid.cells.size - this.cpuBuckets.activeCellKeys.size),
      instancesVisible: this.cpuBuckets.activeInstances,
      instancesCulled: cull.culledInstances,
      farCellsSkipped: cull.farCellSkipped,
      drawCallsOpaque: drawCallsTotal,
      drawCallsTotal,
      trianglesByLod: [...this.cpuBuckets.trianglesByLod],
      shadowCasters: this.cpuBuckets.activeShadowCasters,
      collidersActive: this.collidersActive,
      billboardInstances: this.cpuBuckets.activeBillboards,
      gpuStatus: this.resolveGpuStatus(),
      gpuCandidateCount: 0,
      gpuVisibleCount: 0,
      gpuOverflowed: false,
      gpuDispatchMs: null,
      updateMs: performance.now() - t0,
    };

    const hooks = this.deps.getHooks?.();
    if (hooks?.stats) syncPropStatsToHooks(this.stats, hooks.stats.counters);
  }

  setEnabled(enabled: boolean): void {
    this.deps.settings.enabled = enabled;
    this.root.visible = enabled;
  }

  dispose(): void {
    clearPropGpuRing(this.gpuRingInput());
    clearPropCpuBuckets(this.cpuBucketInput());
    this.registry.dispose();
    this.debug.dispose();
    this.root.removeFromParent();
  }

  private gpuRingInput(): PropGpuRingRuntimeInput {
    return {
      state: this.gpuRing,
      root: this.root,
      settings: this.deps.settings,
      grid: this.grid,
      loadedAssets: this.loadedAssets,
      gpuDevice: this.deps.gpuDevice ?? null,
      gpuBackend: this.deps.gpuBackend ?? null,
    };
  }

  private cpuBucketInput(): PropCpuBucketRuntimeInput {
    return {
      state: this.cpuBuckets,
      root: this.root,
      settings: this.deps.settings,
      grid: this.grid,
      assetById: this.assetById,
      loadedAssets: this.loadedAssets,
    };
  }

  private resolveGpuStatus() {
    return resolvePropGpuRingStatus(
      this.deps.settings,
      this.gpuRing,
      this.deps.gpuDevice,
      this.deps.gpuBackend,
    );
  }

  private computeRingRadius(): number {
    if (this.deps.settings.spatial.ringRadiusM > 0) return this.deps.settings.spatial.ringRadiusM;
    const maxPropDistance = Math.max(
      ...this.deps.settings.props.map((p) => p.culling.maxDistance),
      this.deps.settings.spatial.cellSizeM,
    );
    return maxPropDistance + this.deps.settings.spatial.cellSizeM;
  }

  private computeColliderQueryRadius(): number {
    if (!this.grid) return 0;
    let radius = 0;
    for (const inst of this.grid.instances) {
      const def = this.assetById.get(inst.assetId);
      const loaded = this.loadedAssets.get(inst.assetId);
      if (!def || !loaded || def.collision.mode === "none") continue;
      radius = Math.max(radius, def.collision.distance + loaded.metadata.boundingSphereRadius * inst.scale);
    }
    return radius;
  }

  private updateDebug(
    debugEnabled: boolean,
    visibleCellSet: ReadonlySet<string>,
    debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[],
  ): void {
    if (!debugEnabled || !this.grid) {
      this.debug.update(emptyPropDebugPayload(this.deps.settings));
      return;
    }
    this.debug.update(collectPropDebugCells({
      settings: this.deps.settings,
      cells: this.grid.allCells(),
      visibleCellSet,
      cellKey,
      instanceBounds: debugBounds,
    }));
  }
}
