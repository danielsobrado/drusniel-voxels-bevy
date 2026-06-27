import * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropPlacementScene } from "./prop_types.js";
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
import { PropSpatialGrid, type PropGridCell } from "./prop_spatial_grid.js";
import { EMPTY_PROP_STATS, syncPropStatsToHooks, type PropStats } from "./prop_stats.js";
import { createBillboardMaterial } from "./prop_billboard.js";
import type { PropColliderInstanceInput } from "./prop_collider.js";

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _box = new THREE.Box3();
const _debugBoxSize = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

type BucketKind = "opaque" | "shadow" | "billboard";
type CellJobKind = "enter" | "refresh" | "leave";

interface InstanceLodState {
  lod: number;
}

interface RenderBucket {
  assetId: string;
  lod: number;
  kind: BucketKind;
  mesh: THREE.InstancedMesh;
  maxCount: number;
  freeSlots: number[];
  occupiedSlots: Set<number>;
  nextSlot: number;
}

interface BucketSlot {
  bucketKey: string;
  slot: number;
}

interface CellRenderRecord {
  key: string;
  slots: BucketSlot[];
  instancesVisible: number;
  billboardInstances: number;
  shadowCasters: number;
  trianglesByLod: number[];
  debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[];
}

interface MatrixUploadJob {
  bucketKey: string;
  slot: number;
  matrix: THREE.Matrix4;
  activateSlot?: boolean;
  releaseSlot?: boolean;
}

interface CellBuildContext {
  camPos: [number, number, number];
  viewportH: number;
  fovY: number;
  visibleInstanceIndices: ReadonlySet<number>;
  debugEnabled: boolean;
}

function bucketKey(assetId: string, lod: number, kind: BucketKind): string {
  return `${assetId}:${lod}:${kind}`;
}

function cellKey(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`;
}

function parseCellKey(key: string): [number, number] {
  const [x, z] = key.split(",").map(Number);
  return [x ?? 0, z ?? 0];
}

function addLodTotals(target: number[], delta: readonly number[], sign: 1 | -1): void {
  for (let i = 0; i < delta.length; i++) target[i] = (target[i] ?? 0) + (delta[i] ?? 0) * sign;
}

function lodGeometry(asset: LoadedPropAsset, lod: number): THREE.BufferGeometry | null {
  if (asset.lodChain) return asset.lodChain.levels[lod]?.geometry ?? null;
  let found: THREE.Mesh | null = null;
  asset.root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  const mesh = found as THREE.Mesh | null;
  return mesh?.geometry ?? null;
}

function lodTriangleCount(asset: LoadedPropAsset, lod: number): number {
  if (asset.lodChain) return asset.lodChain.levels[lod]?.triangleCount ?? asset.metadata.triangleCount;
  return asset.metadata.triangleCount;
}

function disposeBucket(bucket: RenderBucket): void {
  const mat = bucket.mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
  bucket.mesh.removeFromParent();
}

export interface PropSystemDeps {
  scene: THREE.Scene;
  settings: CustomPropsSettings;
  placementScene: PropPlacementScene;
  getHooks?: () => ClodHooks | null;
}

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
    this.clearBuckets();
    this.ensureBuckets();
    this.resetStreamingState();
    this.stats = {
      ...EMPTY_PROP_STATS,
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      collidersActive: this.collidersActive,
    };
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.ready || !this.grid || !this.deps.settings.enabled) {
      this.root.visible = false;
      return;
    }

    const t0 = performance.now();
    this.frameId++;
    this.root.visible = true;

    const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    const ringRadius = this.computeRingRadius();
    const candidateCells = this.grid.nearbyCells(camPos, ringRadius);
    const cull = cullPropSpatialGrid(this.grid, camera, this.deps.settings, this.metadataByAssetId, this.frameId, candidateCells);
    const visibleInstanceIndices = new Set(cull.visibleInstanceIndices);
    const viewportH = Math.max(1, window.innerHeight);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const debugEnabled = this.deps.settings.debug.showCells
      || this.deps.settings.debug.showBounds
      || this.deps.settings.debug.lodColorOverlay;

    this.enqueueRingJobs(cull.visibleCellKeys, camPos);
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
      this.debug.update({ settings: this.deps.settings.debug, visibleCells: [], culledCells: [], instanceBounds: [] });
      return;
    }
    const visibleCells: PropGridCell[] = [];
    const culledCells: PropGridCell[] = [];
    for (const cell of this.grid.allCells()) {
      const key = cellKey(cell.cellCoord);
      if (visibleCellSet.has(key)) visibleCells.push(cell);
      else culledCells.push(cell);
    }
    this.debug.update({
      settings: this.deps.settings.debug,
      visibleCells,
      culledCells,
      instanceBounds: debugBounds,
    });
  }
}
