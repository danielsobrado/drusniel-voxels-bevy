import * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropGpuStatus, PropPlacementScene } from "./prop_types.js";
import { PropAssetRegistry, type LoadedPropAsset } from "./prop_asset_loader.js";
import { assignPropCellCoords } from "./prop_placements.js";
import { cullPropSpatialGrid } from "./prop_culling.js";
import { PropDebugOverlay } from "./prop_debug.js";
import {
  propCastsShadow,
  propDistanceToCamera,
  propNeedsCollider,
  selectPropLodIndex,
} from "./prop_lod.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";
import { EMPTY_PROP_STATS, syncPropStatsToHooks, type PropStats } from "./prop_stats.js";
import { createBillboardMaterial } from "./prop_billboard.js";
import type { PropColliderInstanceInput } from "./prop_collider.js";
import {
  PropGpuRingCompute,
  propGpuRingUnsupportedReason,
  type PropGpuRingSourceData,
  type PropGpuRingStats,
} from "../gpu/prop_ring_compute.js";
import { buildPropGpuRingSource, createPropGpuRingDrawResources } from "./prop_gpu_ring_draw.js";
import { collectPropDebugCells, emptyPropDebugPayload } from "./prop_system_debug.js";
import {
  addLodTotals,
  bucketKey,
  cellKey,
  disposeBucket,
  lodGeometry,
  lodTriangleCount,
  parseCellKey,
  propBoxScratch as _box,
  propDebugBoxSizeScratch as _debugBoxSize,
  propGpuFrustum as _gpuFrustum,
  propGpuFrustumMatrix as _gpuFrustumMatrix,
  propMatrixScratch as _matrix,
  propPositionScratch as _position,
  propQuaternionScratch as _quaternion,
  propScaleScratch as _scale,
  propYAxis as _yAxis,
  propZeroMatrix as _zeroMatrix,
  type BucketKind,
  type BucketSlot,
  type CellBuildContext,
  type CellJobKind,
  type CellRenderRecord,
  type InstanceLodState,
  type MatrixUploadJob,
  type PropGpuRingDrawResources,
  type PropWebGpuBackendAccess,
  type RenderBucket,
} from "./prop_system_support.js";

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

export class PropSystem {
  private readonly root = new THREE.Group();
  private readonly registry: PropAssetRegistry;
  private readonly debug: PropDebugOverlay;
  private grid: PropSpatialGrid | null = null;
  private readonly assetById = new Map<string, PropAssetDef>();
  private readonly loadedAssets = new Map<string, LoadedPropAsset>();
  private readonly metadataByAssetId = new Map<string, PropAssetMetadata>();
  private readonly buckets = new Map<string, RenderBucket>();
  private readonly lodState = new Map<number, InstanceLodState>();
  private readonly activeCellKeys = new Set<string>();
  private readonly cellRecords = new Map<string, CellRenderRecord>();
  private readonly cellJobMap = new Map<string, CellJobKind>();
  private readonly cellJobQueue: string[] = [];
  private readonly matrixUploadQueue: MatrixUploadJob[] = [];
  private readonly trianglesByLod = [0, 0, 0, 0, 0];
  private frameId = 0;
  private ready = false;
  private stats: PropStats = { ...EMPTY_PROP_STATS };
  private collidersActive = 0;
  private colliderQueryRadius = 0;
  private activeInstances = 0;
  private activeBillboards = 0;
  private activeShadowCasters = 0;
  private lastRefreshPos: [number, number, number] | null = null;
  private gpuRingDraw: PropGpuRingDrawResources | null = null;
  private gpuRingCompute: PropGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingGeneration = 0;
  private gpuRingStats: PropGpuRingStats | null = null;
  private gpuStatus: PropGpuStatus = "disabled";
  private gpuLoggedError: string | null = null;
  private readonly frustumPlaneScratch = new Float32Array(24);

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
    this.lodState.clear();
    this.clearGpuRing();
    this.clearBuckets();
    this.ensureBuckets();
    this.resetStreamingState();
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

    if (this.usesGpuRingDraw() && this.updateGpuRing(camera, streamCenter, ringRadius)) {
      const stats = this.gpuRingStats;
      this.setCpuBucketsVisible(false);
      this.stats = {
        ...EMPTY_PROP_STATS,
        totalInstances: this.grid.instances.length,
        cellsTotal: this.grid.cells.size,
        cellsVisible: 0,
        cellsCulled: 0,
        instancesVisible: stats?.visibleCount ?? 0,
        instancesCulled: Math.max(0, this.grid.instances.length - (stats?.visibleCount ?? 0)),
        drawCallsOpaque: this.gpuRingDraw?.meshes.length ?? 0,
        drawCallsTotal: this.gpuRingDraw?.meshes.length ?? 0,
        collidersActive: this.collidersActive,
        gpuStatus: this.gpuStatus,
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

    this.setCpuBucketsVisible(true);
    const candidateCells = this.grid.nearbyCells(streamCenter, ringRadius);
    const cull = cullPropSpatialGrid(this.grid, camera, this.deps.settings, this.metadataByAssetId, this.frameId, candidateCells);
    const visibleInstanceIndices = new Set(cull.visibleInstanceIndices);
    const viewportH = Math.max(1, window.innerHeight);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const debugEnabled = this.deps.settings.debug.showCells
      || this.deps.settings.debug.showBounds
      || this.deps.settings.debug.lodColorOverlay;

    this.enqueueRingJobs(cull.visibleCellKeys, streamCenter);
    const context: CellBuildContext = { camPos, viewportH, fovY, visibleInstanceIndices, debugEnabled };
    this.processCellJobs(context);
    this.processMatrixUploads();

    const drawCallsTotal = this.visibleBucketCount();
    this.updateDebug(debugEnabled, this.activeCellKeys, this.collectDebugBounds(debugEnabled));

    this.stats = {
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      cellsVisible: this.activeCellKeys.size,
      cellsCulled: Math.max(0, this.grid.cells.size - this.activeCellKeys.size),
      instancesVisible: this.activeInstances,
      instancesCulled: cull.culledInstances,
      farCellsSkipped: cull.farCellSkipped,
      drawCallsOpaque: drawCallsTotal,
      drawCallsTotal,
      trianglesByLod: [...this.trianglesByLod],
      shadowCasters: this.activeShadowCasters,
      collidersActive: this.collidersActive,
      billboardInstances: this.activeBillboards,
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
    this.clearGpuRing();
    this.clearBuckets();
    this.registry.dispose();
    this.debug.dispose();
    this.root.removeFromParent();
  }

  private resetStreamingState(): void {
    this.activeCellKeys.clear();
    this.cellRecords.clear();
    this.cellJobMap.clear();
    this.cellJobQueue.length = 0;
    this.matrixUploadQueue.length = 0;
    this.activeInstances = 0;
    this.activeBillboards = 0;
    this.activeShadowCasters = 0;
    this.lastRefreshPos = null;
    this.trianglesByLod.fill(0);
    for (const bucket of this.buckets.values()) {
      bucket.freeSlots.length = 0;
      bucket.occupiedSlots.clear();
      bucket.nextSlot = 0;
      bucket.mesh.count = 0;
      bucket.mesh.visible = false;
    }
  }

  private clearBuckets(): void {
    this.resetStreamingState();
    for (const bucket of this.buckets.values()) disposeBucket(bucket);
    this.buckets.clear();
  }

  private ensureBuckets(): void {
    const maxInstances = Math.max(1, this.grid?.instances.length ?? 1);
    for (const def of this.deps.settings.props) {
      const loaded = this.loadedAssets.get(def.id);
      if (!loaded) continue;

      const lodCount = def.lod.distances.length;
      for (let lod = 0; lod < lodCount; lod++) {
        const geometry = lodGeometry(loaded, lod);
        if (!geometry) continue;
        this.addBucket(def.id, lod, "opaque", geometry, loaded.sourceMaterial, maxInstances, false);
        this.addBucket(def.id, lod, "shadow", geometry, loaded.sourceMaterial, maxInstances, true);
      }

      if (loaded.lodChain?.billboardGeometry) {
        const mat =
          (loaded.lodChain.billboardGeometry.userData.billboardMaterial as THREE.Material | undefined) ??
          createBillboardMaterial(loaded.sourceMaterial);
        this.addBucket(def.id, lodCount, "billboard", loaded.lodChain.billboardGeometry, mat, maxInstances, false);
      }
    }
  }

  private addBucket(
    assetId: string,
    lod: number,
    kind: BucketKind,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount: number,
    castShadow: boolean,
  ): void {
    const key = bucketKey(assetId, lod, kind);
    if (this.buckets.has(key)) return;
    const mesh = new THREE.InstancedMesh(geometry, material.clone(), maxCount);
    mesh.name = `prop:${assetId}:lod${lod}:${kind}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = kind !== "billboard";
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    this.buckets.set(key, { assetId, lod, kind, mesh, maxCount, freeSlots: [], occupiedSlots: new Set(), nextSlot: 0 });
  }

  private usesGpuRingDraw(): boolean {
    const gpu = this.deps.settings.gpu;
    return this.deps.settings.enabled && gpu.enabled && !gpu.debugForceCpu;
  }

  private resolveGpuStatus(): PropGpuStatus {
    if (!this.deps.settings.gpu.enabled) return "disabled";
    if (this.deps.settings.gpu.debugForceCpu) return "fallback-cpu";
    if (this.gpuStatus === "ring") return "ring";
    if (!this.deps.gpuDevice || !this.deps.gpuBackend) {
      return this.deps.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
    }
    return this.deps.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
  }

  private updateGpuRing(camera: THREE.PerspectiveCamera, streamCenter: [number, number, number], ringRadius: number): boolean {
    const gpu = this.deps.settings.gpu;
    if (!this.deps.gpuDevice || !this.deps.gpuBackend || !this.grid) {
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      this.setGpuRingVisible(false);
      return false;
    }
    const unsupported = propGpuRingUnsupportedReason(this.deps.gpuDevice);
    if (unsupported) {
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      if (this.gpuLoggedError !== unsupported) {
        this.gpuLoggedError = unsupported;
        console.warn(`[props-gpu-ring] falling back to CPU: ${unsupported}`);
      }
      this.setGpuRingVisible(false);
      return false;
    }

    this.ensureGpuRing();
    if (!this.gpuRingDraw || !this.gpuRingCompute) {
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      this.setGpuRingVisible(false);
      return false;
    }

    const dispatched = this.gpuRingCompute.dispatch({
      centerX: streamCenter[0],
      centerY: streamCenter[1],
      centerZ: streamCenter[2],
      ringRadius,
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      cameraZ: camera.position.z,
      maxInstancesPerGroup: this.gpuRingDraw.maxInstancesPerGroup,
      frustumPlanes: this.frustumPlanes(camera),
    });
    if (!dispatched) {
      const stats = this.gpuRingCompute.stats(this.deps.settings.enabled);
      this.gpuRingStats = stats;
      this.gpuStatus = stats.status === "failed" && !gpu.fallbackToCpu ? "unsupported" : "fallback-cpu";
      this.setGpuRingVisible(false);
      return false;
    }
    this.gpuRingStats = this.gpuRingCompute.stats(this.deps.settings.enabled);
    if (this.gpuRingStats.status === "failed") {
      if (this.gpuRingStats.reason && this.gpuLoggedError !== this.gpuRingStats.reason) {
        this.gpuLoggedError = this.gpuRingStats.reason;
        console.warn(`[props-gpu-ring] falling back to CPU: ${this.gpuRingStats.reason}`);
      }
      this.gpuStatus = gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      this.setGpuRingVisible(false);
      return false;
    }
    this.gpuStatus = "ring";
    this.setGpuRingVisible(true);
    return true;
  }

  private ensureGpuRing(): void {
    if (!this.grid || !this.deps.gpuDevice || !this.deps.gpuBackend) return;
    const source = this.buildGpuRingSource();
    if (source.groupCount === 0 || source.sourceCount === 0) return;
    const key = [
      this.grid.instances.length,
      source.groupCount,
      this.deps.settings.gpu.maxVisible,
      this.deps.settings.gpu.workgroupSize,
      ...this.deps.settings.props.map((prop) => `${prop.id}:${prop.lod.distances.join(",")}:${prop.culling.maxDistance}`),
    ].join("|");
    if (this.gpuRingStats?.status === "failed" && this.gpuRingKey === key) return;
    if (this.gpuRingCompute && this.gpuRingDraw && this.gpuRingKey === key) return;
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRing();
    this.gpuRingKey = key;
    this.gpuRingDraw = this.createGpuRingDrawResources(source);
    for (const mesh of this.gpuRingDraw.meshes) this.root.add(mesh);
    this.setGpuRingVisible(false);
    this.gpuRingStats = {
      status: "initializing",
      candidateCount: source.sourceCount,
      visibleCount: 0,
      groupCounts: new Array<number>(source.groupCount).fill(0),
      overflowed: false,
      submitMs: null,
      readbackMs: null,
    };
    const initKey = key;
    const initGeneration = this.gpuRingGeneration;
    const outputBuffers = {
      instanceA: this.gpuBufferForAttribute(this.gpuRingDraw.instanceA),
      instanceB: this.gpuBufferForAttribute(this.gpuRingDraw.instanceB),
      indirectArgs: this.gpuBufferForAttribute(this.gpuRingDraw.indirect),
    };
    this.gpuRingInit = PropGpuRingCompute.create(this.deps.gpuDevice, source, outputBuffers, this.deps.settings)
      .then((compute) => {
        if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) {
          compute.destroy();
          return;
        }
        this.gpuRingCompute = compute;
        this.gpuRingStats = compute.stats(this.deps.settings.enabled);
      })
      .catch((error) => {
        if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.gpuRingStats = { ...this.gpuRingStats!, status: "failed", reason };
      })
      .finally(() => {
        if (this.gpuRingKey === initKey && this.gpuRingGeneration === initGeneration) this.gpuRingInit = null;
      });
  }

  private buildGpuRingSource(): PropGpuRingSourceData {
    return buildPropGpuRingSource({
      grid: this.grid,
      settings: this.deps.settings,
      loadedAssets: this.loadedAssets,
      indexCountFor: (geometry) => this.indexCountFor(geometry),
    });
  }

  private createGpuRingDrawResources(source: PropGpuRingSourceData): PropGpuRingDrawResources {
    return createPropGpuRingDrawResources({
      source,
      settings: this.deps.settings,
      loadedAssets: this.loadedAssets,
      gpuBackend: this.deps.gpuBackend,
    });
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.deps.gpuBackend) throw new Error("Cannot read WebGPU prop buffer without a backend");
    const buffer = this.deps.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "prop ring attribute"}`);
    return buffer;
  }

  private frustumPlanes(camera: THREE.Camera): Float32Array {
    (camera as THREE.Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    _gpuFrustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _gpuFrustum.setFromProjectionMatrix(_gpuFrustumMatrix);
    for (let i = 0; i < 6; i++) {
      const plane = _gpuFrustum.planes[i]!;
      const offset = i * 4;
      this.frustumPlaneScratch[offset] = plane.normal.x;
      this.frustumPlaneScratch[offset + 1] = plane.normal.y;
      this.frustumPlaneScratch[offset + 2] = plane.normal.z;
      this.frustumPlaneScratch[offset + 3] = plane.constant;
    }
    return this.frustumPlaneScratch;
  }

  private setGpuRingVisible(visible: boolean): void {
    if (!this.gpuRingDraw) return;
    for (const mesh of this.gpuRingDraw.meshes) mesh.visible = visible;
  }

  private setCpuBucketsVisible(visible: boolean): void {
    for (const bucket of this.buckets.values()) bucket.mesh.visible = visible && bucket.mesh.count > 0;
  }

  private clearGpuRing(): void {
    this.gpuRingGeneration++;
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.gpuRingStats = null;
    if (this.gpuRingDraw) {
      for (const mesh of this.gpuRingDraw.meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    this.gpuRingDraw = null;
  }

  private enqueueRingJobs(desiredCellKeys: ReadonlySet<string>, camPos: [number, number, number]): void {
    this.reconcilePendingCellJobs(desiredCellKeys);
    for (const key of this.activeCellKeys) {
      if (!desiredCellKeys.has(key)) this.enqueueCellJob(key, "leave");
    }
    for (const key of desiredCellKeys) {
      if (!this.activeCellKeys.has(key)) this.enqueueCellJob(key, "enter");
    }
    if (this.shouldRefreshActiveCells(camPos)) {
      for (const key of desiredCellKeys) {
        if (this.activeCellKeys.has(key)) this.enqueueCellJob(key, "refresh");
      }
      this.lastRefreshPos = [...camPos] as [number, number, number];
    }
  }

  private reconcilePendingCellJobs(desiredCellKeys: ReadonlySet<string>): void {
    for (const [key, kind] of this.cellJobMap) {
      const desired = desiredCellKeys.has(key);
      const active = this.activeCellKeys.has(key);
      if (desired && kind === "leave") {
        if (active) this.cellJobMap.delete(key);
        else this.cellJobMap.set(key, "enter");
      } else if (!desired && (kind === "enter" || kind === "refresh")) {
        if (active) this.cellJobMap.set(key, "leave");
        else this.cellJobMap.delete(key);
      }
    }
  }

  private shouldRefreshActiveCells(camPos: [number, number, number]): boolean {
    if (!this.lastRefreshPos) {
      this.lastRefreshPos = [...camPos] as [number, number, number];
      return false;
    }
    const threshold = this.deps.settings.spatial.lodRefreshDistanceM;
    if (threshold <= 0) return false;
    const dx = camPos[0] - this.lastRefreshPos[0];
    const dy = camPos[1] - this.lastRefreshPos[1];
    const dz = camPos[2] - this.lastRefreshPos[2];
    return dx * dx + dy * dy + dz * dz >= threshold * threshold;
  }

  private enqueueCellJob(key: string, kind: CellJobKind): void {
    const previous = this.cellJobMap.get(key);
    if (!previous) {
      this.cellJobMap.set(key, kind);
      this.cellJobQueue.push(key);
      return;
    }
    if (kind === "leave") {
      this.cellJobMap.set(key, "leave");
      return;
    }
    if (previous === "leave") this.cellJobMap.set(key, "refresh");
    else if (previous !== "enter") this.cellJobMap.set(key, kind);
  }

  private processCellJobs(context: CellBuildContext): void {
    const budget = Math.max(1, this.deps.settings.spatial.cellUpdateBudgetPerFrame);
    let processed = 0;
    while (processed < budget && this.cellJobQueue.length > 0) {
      const key = this.cellJobQueue.shift()!;
      processed++;
      const kind = this.cellJobMap.get(key);
      if (!kind) continue;
      this.cellJobMap.delete(key);
      if (kind === "leave") this.releaseCell(key);
      else this.rebuildCell(key, context);
    }
  }

  private rebuildCell(key: string, context: CellBuildContext): void {
    if (!this.grid) return;
    this.releaseCell(key);
    const cell = this.grid.cellAt(parseCellKey(key));
    if (!cell) return;

    const record: CellRenderRecord = {
      key,
      slots: [],
      instancesVisible: 0,
      billboardInstances: 0,
      shadowCasters: 0,
      trianglesByLod: [0, 0, 0, 0, 0],
      debugBounds: [],
    };

    for (const idx of cell.instanceIndices) {
      if (!context.visibleInstanceIndices.has(idx)) continue;
      this.appendInstanceToCell(record, idx, context);
    }

    this.cellRecords.set(key, record);
    this.activeCellKeys.add(key);
    this.activeInstances += record.instancesVisible;
    this.activeBillboards += record.billboardInstances;
    this.activeShadowCasters += record.shadowCasters;
    addLodTotals(this.trianglesByLod, record.trianglesByLod, 1);
  }

  private appendInstanceToCell(record: CellRenderRecord, idx: number, context: CellBuildContext): void {
    if (!this.grid) return;
    const inst = this.grid.instances[idx]!;
    const def = this.assetById.get(inst.assetId);
    const loaded = this.loadedAssets.get(inst.assetId);
    if (!def || !loaded) return;

    const radius = loaded.metadata.boundingSphereRadius * inst.scale;
    const distance = propDistanceToCamera(context.camPos, inst.position, radius);
    const previous = this.lodState.get(idx)?.lod ?? null;
    const lod = selectPropLodIndex(
      def,
      { camPos: context.camPos, propPos: inst.position, viewportH: context.viewportH, fovY: context.fovY, thresholdPx: def.culling.minScreenPx },
      radius,
      previous,
      loaded.lodErrorWorld.length > 0 ? loaded.lodErrorWorld : undefined,
    );
    this.lodState.set(idx, { lod });
    if (lod < 0) return;

    _position.set(inst.position[0], inst.position[1], inst.position[2]);
    _quaternion.setFromAxisAngle(_yAxis, inst.rotationY);
    _scale.setScalar(inst.scale);
    _matrix.compose(_position, _quaternion, _scale);

    let key: string;
    if (lod >= def.lod.distances.length) {
      if (!loaded.lodChain?.billboardGeometry) return;
      key = bucketKey(inst.assetId, def.lod.distances.length, "billboard");
      record.billboardInstances++;
      record.trianglesByLod[4] = (record.trianglesByLod[4] ?? 0) + 2;
    } else {
      const wantsShadow = propCastsShadow(def, distance) && this.activeShadowCasters + record.shadowCasters < this.deps.settings.shadows.maxShadowProps;
      const kind: BucketKind = wantsShadow ? "shadow" : "opaque";
      key = bucketKey(inst.assetId, lod, kind);
      const triCount = lodTriangleCount(loaded, lod);
      record.trianglesByLod[lod] = (record.trianglesByLod[lod] ?? 0) + triCount;
      if (wantsShadow) record.shadowCasters++;
    }

    const slot = this.allocateBucketSlot(key);
    if (slot === null) return;
    record.slots.push({ bucketKey: key, slot });
    record.instancesVisible++;
    this.queueMatrixUpload(key, slot, _matrix, "activate");

    if (context.debugEnabled && (this.deps.settings.debug.showBounds || this.deps.settings.debug.lodColorOverlay)) {
      _debugBoxSize.set(radius * 2, radius * 2, radius * 2);
      _box.setFromCenterAndSize(_position, _debugBoxSize);
      record.debugBounds.push({ min: _box.min.clone(), max: _box.max.clone(), lod });
    }
  }

  private releaseCell(key: string): void {
    const record = this.cellRecords.get(key);
    if (!record) {
      this.activeCellKeys.delete(key);
      return;
    }
    for (const slot of record.slots) {
      if (!this.cancelPendingActivation(slot)) this.queueMatrixUpload(slot.bucketKey, slot.slot, _zeroMatrix, "release");
    }
    this.cellRecords.delete(key);
    this.activeCellKeys.delete(key);
    this.activeInstances -= record.instancesVisible;
    this.activeBillboards -= record.billboardInstances;
    this.activeShadowCasters -= record.shadowCasters;
    addLodTotals(this.trianglesByLod, record.trianglesByLod, -1);
  }

  private cancelPendingActivation(slot: BucketSlot): boolean {
    for (const job of this.matrixUploadQueue) {
      if (job.bucketKey !== slot.bucketKey || job.slot !== slot.slot || !job.activateSlot) continue;
      job.matrix.copy(_zeroMatrix);
      job.activateSlot = false;
      job.releaseSlot = true;
      return true;
    }
    return false;
  }

  private allocateBucketSlot(key: string): number | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    const slot = bucket.freeSlots.pop() ?? bucket.nextSlot++;
    return slot < bucket.maxCount ? slot : null;
  }

  private queueMatrixUpload(bucketKey: string, slot: number, matrix: THREE.Matrix4, mode: "activate" | "release"): void {
    this.matrixUploadQueue.push({
      bucketKey,
      slot,
      matrix: matrix.clone(),
      activateSlot: mode === "activate",
      releaseSlot: mode === "release",
    });
  }

  private processMatrixUploads(): void {
    const budget = Math.max(1, this.deps.settings.spatial.matrixUploadBudgetPerFrame);
    let processed = 0;
    while (processed < budget && this.matrixUploadQueue.length > 0) {
      const job = this.matrixUploadQueue.shift()!;
      const bucket = this.buckets.get(job.bucketKey);
      if (!bucket) continue;
      bucket.mesh.setMatrixAt(job.slot, job.matrix);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (job.activateSlot) bucket.occupiedSlots.add(job.slot);
      if (job.releaseSlot) {
        bucket.occupiedSlots.delete(job.slot);
        if (!bucket.freeSlots.includes(job.slot)) bucket.freeSlots.push(job.slot);
      }
      this.refreshBucketVisibility(bucket);
      processed++;
    }
  }

  private refreshBucketVisibility(bucket: RenderBucket): void {
    let maxSlot = -1;
    for (const slot of bucket.occupiedSlots) maxSlot = Math.max(maxSlot, slot);
    bucket.mesh.count = maxSlot + 1;
    bucket.mesh.visible = maxSlot >= 0;
  }

  private visibleBucketCount(): number {
    let count = 0;
    for (const bucket of this.buckets.values()) if (bucket.mesh.visible) count++;
    return count;
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
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

  private collectDebugBounds(debugEnabled: boolean): { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] {
    if (!debugEnabled) return [];
    const out: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] = [];
    for (const record of this.cellRecords.values()) out.push(...record.debugBounds);
    return out;
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
