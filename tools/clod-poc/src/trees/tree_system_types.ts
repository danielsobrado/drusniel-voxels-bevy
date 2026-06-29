import type * as THREE from "three";
import type { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import type { TreeGpuRingOutputBuffers } from "../gpu/tree_ring_compute.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ClodPageNode, PageFootprint } from "../types.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeGenerationStats, TreeInstance, TreeTerrainSampler } from "./tree_instances.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";
import type { TreeFallingInstance } from "./tree_system_patch_removal.js";
import type { TreeSystemStatsSnapshot } from "./tree_system_stats.js";
import type { TreeSystemLightingProxy } from "./tree_system_lighting_proxies.js";
import type { TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";

export interface TreeSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
  impostorAtlases?: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  /** Use the WebGPU node material path instead of the classic WebGL material. */
  webgpu?: boolean;
  /** Initial lighting for the WebGPU node material path. */
  lighting?: EnvironmentLighting;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: TreeWebGpuBackendAccess | null;
  /** Hydrology water field (RGBA32F; G = wet mask) to drop trees standing in water. */
  hydrologyWaterTexture?: THREE.Texture | null;
  supportsGpuTrees?: boolean;
}

export interface TreeWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export type TreeStats = TreeSystemStatsSnapshot;
export type TreeImpostorStatus = "disabled" | "pending" | "baking" | "baked" | "fallback";
export type TreeLightingProxy = TreeSystemLightingProxy;
export type FallingTree = TreeFallingInstance;

export interface TreePatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  instances: TreeInstance[];
  group: THREE.Group;
  meshes: TreeSystemMeshGrid;
  previousLods: (TreeLod | null)[];
  visible: boolean;
  generationStats: TreeGenerationStats;
}

export interface TreeGpuRingDrawResources {
  meshes: TreeGpuRingMesh[];
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  shadowCell: StorageInstancedBufferAttribute;
  shadowIndirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;
  materialHandles: Record<string, TreeMaterialHandle>;
}

export interface TreeSystemGeometryState {
  settings: TreeSettings;
  geometries: TreeGeometryMap;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>;
}
