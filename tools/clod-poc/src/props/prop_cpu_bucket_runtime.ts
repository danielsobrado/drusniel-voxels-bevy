import * as THREE from "three";
import type { CustomPropsSettings, PropAssetDef } from "./prop_types.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import type { PropSpatialGrid } from "./prop_spatial_grid.js";
import { createBillboardMaterial } from "./prop_billboard.js";
import {
  propCastsShadow,
  propDistanceToCamera,
  selectPropLodIndex,
} from "./prop_lod.js";
import {
  addLodTotals,
  bucketKey,
  disposeBucket,
  lodGeometry,
  lodTriangleCount,
  parseCellKey,
  propBoxScratch as _box,
  propDebugBoxSizeScratch as _debugBoxSize,
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
  type RenderBucket,
} from "./prop_system_support.js";

export interface PropCpuBucketRuntimeState {
  buckets: Map<string, RenderBucket>;
  lodState: Map<number, InstanceLodState>;
  activeCellKeys: Set<string>;
  cellRecords: Map<string, CellRenderRecord>;
  cellJobMap: Map<string, CellJobKind>;
  cellJobQueue: string[];
  matrixUploadQueue: MatrixUploadJob[];
  trianglesByLod: number[];
  activeInstances: number;
  activeBillboards: number;
  activeShadowCasters: number;
  lastRefreshPos: [number, number, number] | null;
}

export interface PropCpuBucketRuntimeInput {
  state: PropCpuBucketRuntimeState;
  root: THREE.Object3D;
  settings: CustomPropsSettings;
  grid: PropSpatialGrid | null;
  assetById: ReadonlyMap<string, PropAssetDef>;
  loadedAssets: ReadonlyMap<string, LoadedPropAsset>;
}

export function createPropCpuBucketRuntimeState(): PropCpuBucketRuntimeState {
  return {
    buckets: new Map(),
    lodState: new Map(),
    activeCellKeys: new Set(),
    cellRecords: new Map(),
    cellJobMap: new Map(),
    cellJobQueue: [],
    matrixUploadQueue: [],
    trianglesByLod: [0, 0, 0, 0, 0],
    activeInstances: 0,
    activeBillboards: 0,
    activeShadowCasters: 0,
    lastRefreshPos: null,
  };
}

export function resetPropCpuBucketStreamingState(state: PropCpuBucketRuntimeState): void {
  state.activeCellKeys.clear();
  state.cellRecords.clear();
  state.cellJobMap.clear();
  state.cellJobQueue.length = 0;
  state.matrixUploadQueue.length = 0;
  state.activeInstances = 0;
  state.activeBillboards = 0;
  state.activeShadowCasters = 0;
  state.lastRefreshPos = null;
  state.trianglesByLod.fill(0);
  for (const bucket of state.buckets.values()) {
    bucket.freeSlots.length = 0;
    bucket.occupiedSlots.clear();
    bucket.nextSlot = 0;
    bucket.mesh.count = 0;
    bucket.mesh.visible = false;
  }
}

export function clearPropCpuBuckets(input: PropCpuBucketRuntimeInput): void {
  resetPropCpuBucketStreamingState(input.state);
  for (const bucket of input.state.buckets.values()) disposeBucket(bucket);
  input.state.buckets.clear();
}

export function ensurePropCpuBuckets(input: PropCpuBucketRuntimeInput): void {
  const maxInstances = Math.max(1, input.grid?.instances.length ?? 1);
  for (const def of input.settings.props) {
    const loaded = input.loadedAssets.get(def.id);
    if (!loaded) continue;

    const lodCount = def.lod.distances.length;
    for (let lod = 0; lod < lodCount; lod++) {
      const geometry = lodGeometry(loaded, lod);
      if (!geometry) continue;
      addPropCpuBucket(input, def.id, lod, "opaque", geometry, loaded.sourceMaterial, maxInstances, false);
      addPropCpuBucket(input, def.id, lod, "shadow", geometry, loaded.sourceMaterial, maxInstances, true);
    }

    if (loaded.lodChain?.billboardGeometry) {
      const mat =
        (loaded.lodChain.billboardGeometry.userData.billboardMaterial as THREE.Material | undefined) ??
        createBillboardMaterial(loaded.sourceMaterial);
      addPropCpuBucket(input, def.id, lodCount, "billboard", loaded.lodChain.billboardGeometry, mat, maxInstances, false);
    }
  }
}

export function setPropCpuBucketsVisible(state: PropCpuBucketRuntimeState, visible: boolean): void {
  for (const bucket of state.buckets.values()) bucket.mesh.visible = visible && bucket.mesh.count > 0;
}

export function enqueuePropCpuRingJobs(
  input: PropCpuBucketRuntimeInput,
  desiredCellKeys: ReadonlySet<string>,
  camPos: [number, number, number],
): void {
  reconcilePropPendingCellJobs(input.state, desiredCellKeys);
  for (const key of input.state.activeCellKeys) {
    if (!desiredCellKeys.has(key)) enqueuePropCellJob(input.state, key, "leave");
  }
  for (const key of desiredCellKeys) {
    if (!input.state.activeCellKeys.has(key)) enqueuePropCellJob(input.state, key, "enter");
  }
  if (shouldRefreshPropActiveCells(input, camPos)) {
    for (const key of desiredCellKeys) {
      if (input.state.activeCellKeys.has(key)) enqueuePropCellJob(input.state, key, "refresh");
    }
    input.state.lastRefreshPos = [...camPos] as [number, number, number];
  }
}

export function processPropCpuCellJobs(input: PropCpuBucketRuntimeInput, context: CellBuildContext): void {
  const budget = Math.max(1, input.settings.spatial.cellUpdateBudgetPerFrame);
  let processed = 0;
  while (processed < budget && input.state.cellJobQueue.length > 0) {
    const key = input.state.cellJobQueue.shift()!;
    processed++;
    const kind = input.state.cellJobMap.get(key);
    if (!kind) continue;
    input.state.cellJobMap.delete(key);
    if (kind === "leave") releasePropCpuCell(input, key);
    else rebuildPropCpuCell(input, key, context);
  }
}

export function processPropCpuMatrixUploads(input: PropCpuBucketRuntimeInput): void {
  const budget = Math.max(1, input.settings.spatial.matrixUploadBudgetPerFrame);
  processPropCpuMatrixUploadsWithBudget(input.state, budget);
}

export function visiblePropCpuBucketCount(state: PropCpuBucketRuntimeState): number {
  let count = 0;
  for (const bucket of state.buckets.values()) if (bucket.mesh.visible) count++;
  return count;
}

export function collectPropCpuDebugBounds(
  state: PropCpuBucketRuntimeState,
  debugEnabled: boolean,
): { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] {
  if (!debugEnabled) return [];
  const out: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] = [];
  for (const record of state.cellRecords.values()) out.push(...record.debugBounds);
  return out;
}

function addPropCpuBucket(
  input: PropCpuBucketRuntimeInput,
  assetId: string,
  lod: number,
  kind: BucketKind,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  maxCount: number,
  castShadow: boolean,
): void {
  const key = bucketKey(assetId, lod, kind);
  if (input.state.buckets.has(key)) return;
  const mesh = new THREE.InstancedMesh(geometry, material.clone(), maxCount);
  mesh.name = `prop:${assetId}:lod${lod}:${kind}`;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = kind !== "billboard";
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  input.root.add(mesh);
  input.state.buckets.set(key, { assetId, lod, kind, mesh, maxCount, freeSlots: [], occupiedSlots: new Set(), nextSlot: 0 });
}

function reconcilePropPendingCellJobs(
  state: PropCpuBucketRuntimeState,
  desiredCellKeys: ReadonlySet<string>,
): void {
  for (const [key, kind] of state.cellJobMap) {
    const desired = desiredCellKeys.has(key);
    const active = state.activeCellKeys.has(key);
    if (desired && kind === "leave") {
      if (active) state.cellJobMap.delete(key);
      else state.cellJobMap.set(key, "enter");
    } else if (!desired && (kind === "enter" || kind === "refresh")) {
      if (active) state.cellJobMap.set(key, "leave");
      else state.cellJobMap.delete(key);
    }
  }
}

function shouldRefreshPropActiveCells(
  input: PropCpuBucketRuntimeInput,
  camPos: [number, number, number],
): boolean {
  const { state } = input;
  if (!state.lastRefreshPos) {
    state.lastRefreshPos = [...camPos] as [number, number, number];
    return false;
  }
  const threshold = input.settings.spatial.lodRefreshDistanceM;
  if (threshold <= 0) return false;
  const dx = camPos[0] - state.lastRefreshPos[0];
  const dy = camPos[1] - state.lastRefreshPos[1];
  const dz = camPos[2] - state.lastRefreshPos[2];
  return dx * dx + dy * dy + dz * dz >= threshold * threshold;
}

function enqueuePropCellJob(state: PropCpuBucketRuntimeState, key: string, kind: CellJobKind): void {
  const previous = state.cellJobMap.get(key);
  if (!previous) {
    state.cellJobMap.set(key, kind);
    state.cellJobQueue.push(key);
    return;
  }
  if (kind === "leave") {
    state.cellJobMap.set(key, "leave");
    return;
  }
  if (previous === "leave") state.cellJobMap.set(key, "refresh");
  else if (previous !== "enter") state.cellJobMap.set(key, kind);
}

function rebuildPropCpuCell(input: PropCpuBucketRuntimeInput, key: string, context: CellBuildContext): void {
  if (!input.grid) return;
  releasePropCpuCell(input, key);
  const cell = input.grid.cellAt(parseCellKey(key));
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
    appendPropInstanceToCell(input, record, idx, context);
  }

  input.state.cellRecords.set(key, record);
  input.state.activeCellKeys.add(key);
  input.state.activeInstances += record.instancesVisible;
  input.state.activeBillboards += record.billboardInstances;
  input.state.activeShadowCasters += record.shadowCasters;
  addLodTotals(input.state.trianglesByLod, record.trianglesByLod, 1);
}

function appendPropInstanceToCell(
  input: PropCpuBucketRuntimeInput,
  record: CellRenderRecord,
  idx: number,
  context: CellBuildContext,
): void {
  if (!input.grid) return;
  const inst = input.grid.instances[idx]!;
  const def = input.assetById.get(inst.assetId);
  const loaded = input.loadedAssets.get(inst.assetId);
  if (!def || !loaded) return;

  const radius = loaded.metadata.boundingSphereRadius * inst.scale;
  const distance = propDistanceToCamera(context.camPos, inst.position, radius);
  const previous = input.state.lodState.get(idx)?.lod ?? null;
  const lod = selectPropLodIndex(
    def,
    { camPos: context.camPos, propPos: inst.position, viewportH: context.viewportH, fovY: context.fovY, thresholdPx: def.culling.minScreenPx },
    radius,
    previous,
    loaded.lodErrorWorld.length > 0 ? loaded.lodErrorWorld : undefined,
  );
  input.state.lodState.set(idx, { lod });
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
    const wantsShadow = propCastsShadow(def, distance)
      && input.state.activeShadowCasters + record.shadowCasters < input.settings.shadows.maxShadowProps;
    const kind: BucketKind = wantsShadow ? "shadow" : "opaque";
    key = bucketKey(inst.assetId, lod, kind);
    const triCount = lodTriangleCount(loaded, lod);
    record.trianglesByLod[lod] = (record.trianglesByLod[lod] ?? 0) + triCount;
    if (wantsShadow) record.shadowCasters++;
  }

  const slot = allocatePropBucketSlot(input.state, key);
  if (slot === null) return;
  record.slots.push({ bucketKey: key, slot });
  record.instancesVisible++;
  queuePropMatrixUpload(input.state, key, slot, _matrix, "activate");

  if (context.debugEnabled && (input.settings.debug.showBounds || input.settings.debug.lodColorOverlay)) {
    _debugBoxSize.set(radius * 2, radius * 2, radius * 2);
    _box.setFromCenterAndSize(_position, _debugBoxSize);
    record.debugBounds.push({ min: _box.min.clone(), max: _box.max.clone(), lod });
  }
}

function releasePropCpuCell(input: PropCpuBucketRuntimeInput, key: string): void {
  const { state } = input;
  const record = state.cellRecords.get(key);
  if (!record) {
    state.activeCellKeys.delete(key);
    return;
  }
  for (const slot of record.slots) {
    if (!cancelPropPendingActivation(state, slot)) queuePropMatrixUpload(state, slot.bucketKey, slot.slot, _zeroMatrix, "release");
  }
  state.cellRecords.delete(key);
  state.activeCellKeys.delete(key);
  state.activeInstances -= record.instancesVisible;
  state.activeBillboards -= record.billboardInstances;
  state.activeShadowCasters -= record.shadowCasters;
  addLodTotals(state.trianglesByLod, record.trianglesByLod, -1);
}

function cancelPropPendingActivation(state: PropCpuBucketRuntimeState, slot: BucketSlot): boolean {
  for (const job of state.matrixUploadQueue) {
    if (job.bucketKey !== slot.bucketKey || job.slot !== slot.slot || !job.activateSlot) continue;
    job.matrix.copy(_zeroMatrix);
    job.activateSlot = false;
    job.releaseSlot = true;
    return true;
  }
  return false;
}

function allocatePropBucketSlot(state: PropCpuBucketRuntimeState, key: string): number | null {
  const bucket = state.buckets.get(key);
  if (!bucket) return null;
  const slot = bucket.freeSlots.pop() ?? bucket.nextSlot++;
  return slot < bucket.maxCount ? slot : null;
}

function queuePropMatrixUpload(
  state: PropCpuBucketRuntimeState,
  bucketKey: string,
  slot: number,
  matrix: THREE.Matrix4,
  mode: "activate" | "release",
): void {
  state.matrixUploadQueue.push({
    bucketKey,
    slot,
    matrix: matrix.clone(),
    activateSlot: mode === "activate",
    releaseSlot: mode === "release",
  });
}

function processPropCpuMatrixUploadsWithBudget(state: PropCpuBucketRuntimeState, budget: number): void {
  let processed = 0;
  while (processed < budget && state.matrixUploadQueue.length > 0) {
    const job = state.matrixUploadQueue.shift()!;
    const bucket = state.buckets.get(job.bucketKey);
    if (!bucket) continue;
    bucket.mesh.setMatrixAt(job.slot, job.matrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
    if (job.activateSlot) bucket.occupiedSlots.add(job.slot);
    if (job.releaseSlot) {
      bucket.occupiedSlots.delete(job.slot);
      if (!bucket.freeSlots.includes(job.slot)) bucket.freeSlots.push(job.slot);
    }
    refreshPropBucketVisibility(bucket);
    processed++;
  }
}

function refreshPropBucketVisibility(bucket: RenderBucket): void {
  let maxSlot = -1;
  for (const slot of bucket.occupiedSlots) maxSlot = Math.max(maxSlot, slot);
  bucket.mesh.count = maxSlot + 1;
  bucket.mesh.visible = maxSlot >= 0;
}
