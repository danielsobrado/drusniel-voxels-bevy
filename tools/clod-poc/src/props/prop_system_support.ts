import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { isRenderableIndirectDrawGeometry } from "../gpu/indirect_draw_geometry.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import type { CustomPropsSettings, PropGpuStatus } from "./prop_types.js";
import type { PropGpuRingSourceData } from "../gpu/prop_ring_compute.js";

export const propMatrixScratch = new THREE.Matrix4();
export const propPositionScratch = new THREE.Vector3();
export const propQuaternionScratch = new THREE.Quaternion();
export const propScaleScratch = new THREE.Vector3();
export const propBoxScratch = new THREE.Box3();
export const propDebugBoxSizeScratch = new THREE.Vector3();
export const propYAxis = new THREE.Vector3(0, 1, 0);
export const propZeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
export const propGpuFrustumMatrix = new THREE.Matrix4();
export const propGpuFrustum = new THREE.Frustum();

export type BucketKind = "opaque" | "shadow" | "billboard";
export type CellJobKind = "enter" | "refresh" | "leave";

export interface InstanceLodState {
  lod: number;
}

export interface RenderBucket {
  assetId: string;
  lod: number;
  kind: BucketKind;
  mesh: THREE.InstancedMesh;
  maxCount: number;
  freeSlots: number[];
  occupiedSlots: Set<number>;
  nextSlot: number;
}

export interface PropWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

export interface PropGpuRingDrawResources {
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[];
  instanceA: StorageInstancedBufferAttribute;
  instanceB: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  source: PropGpuRingSourceData;
  maxInstancesPerGroup: number;
}

export interface BucketSlot {
  bucketKey: string;
  slot: number;
}

export interface CellRenderRecord {
  key: string;
  slots: BucketSlot[];
  instancesVisible: number;
  billboardInstances: number;
  shadowCasters: number;
  trianglesByLod: number[];
  debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[];
}

export interface MatrixUploadJob {
  bucketKey: string;
  slot: number;
  matrix: THREE.Matrix4;
  activateSlot?: boolean;
  releaseSlot?: boolean;
}

export interface CellBuildContext {
  camPos: [number, number, number];
  viewportH: number;
  fovY: number;
  visibleInstanceIndices: ReadonlySet<number>;
  debugEnabled: boolean;
}

export function bucketKey(assetId: string, lod: number, kind: BucketKind): string {
  return `${assetId}:${lod}:${kind}`;
}

export function cellKey(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`;
}

export function parseCellKey(key: string): [number, number] {
  const [x, z] = key.split(",").map(Number);
  return [x ?? 0, z ?? 0];
}

export function addLodTotals(target: number[], delta: readonly number[], sign: 1 | -1): void {
  for (let i = 0; i < delta.length; i++) target[i] = (target[i] ?? 0) + (delta[i] ?? 0) * sign;
}

export function lodGeometry(asset: LoadedPropAsset, lod: number): THREE.BufferGeometry | null {
  let geometry: THREE.BufferGeometry | null = null;
  if (asset.lodChain) geometry = asset.lodChain.levels[lod]?.geometry ?? null;
  else {
    let found: THREE.Mesh | null = null;
    asset.root.traverse((obj) => {
      if (!found && obj instanceof THREE.Mesh) found = obj;
    });
    geometry = found?.geometry ?? null;
  }
  return geometry && isRenderableIndirectDrawGeometry(geometry) ? geometry : null;
}

export function lodTriangleCount(asset: LoadedPropAsset, lod: number): number {
  if (asset.lodChain) return asset.lodChain.levels[lod]?.triangleCount ?? asset.metadata.triangleCount;
  return asset.metadata.triangleCount;
}

export function disposeBucket(bucket: RenderBucket): void {
  const mat = bucket.mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
  bucket.mesh.removeFromParent();
}

export function emptyGpuRingSource(): PropGpuRingSourceData {
  return {
    sourceA: new Float32Array([0, 0, 0, 1]),
    sourceB: new Float32Array([0, 0, 0, 0]),
    assetMeta: new Float32Array([0, 0, 0, 0]),
    assetLods: new Float32Array([0, 0, 0, 0]),
    groupMeta: new Uint32Array([0, 0, 0, 0]),
    sourceCount: 0,
    groupCount: 0,
  };
}

export function propGpuStatus(settings: CustomPropsSettings, gpuRingBackendAvailable: boolean): PropGpuStatus {
  if (!settings.gpu.enabled) return "disabled";
  if (settings.gpu.debugForceCpu) return "fallback-cpu";
  if (gpuRingBackendAvailable) return "ring";
  return settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
}
