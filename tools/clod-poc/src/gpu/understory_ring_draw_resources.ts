import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { isRenderableIndirectDrawGeometry } from "./indirect_draw_geometry.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "../understory/understory_config.js";
import {
  createUnderstoryGeometryMap,
  disposeUnderstoryGeometryMap,
  type UnderstoryGeometryDetail,
  type UnderstoryGeometryMap,
} from "../understory/understory_geometry.js";
import { getUnderstoryDepthPrepassEnabled } from "../understory/understory_depth_prepass_runtime.js";
import { createUnderstoryRingNodeMaterialHandle, type UnderstoryRingHydrologyWater, type UnderstoryRingInstanceBuffers } from "../understory/understory_node_material.js";
import type { UnderstoryMaterialHandle } from "../understory/understory_material.js";
import { depthPrepassTwin } from "../rendering/veg_prepass.js";
import {
  understoryRingClassBaseOffset,
  understoryRingGroupIndex,
  UNDERSTORY_RING_TIER_COUNT,
  understoryRingGroupCapacity,
  UNDERSTORY_RING_GROUP_COUNT,
} from "../understory/understory_ring_math.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { UnderstoryGpuRingOutputBuffers, UnderstoryHydrologyData } from "./understory_ring_compute.js";

type UnderstoryGpuRingMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

const TIER_DETAILS: readonly UnderstoryGeometryDetail[] = ["full", "low"];

export interface UnderstoryGpuRingDrawResources {
  /** Group-ordered (class x tier): mesh index == draw group. */
  meshes: UnderstoryGpuRingMesh[];
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: UnderstoryGpuRingOutputBuffers;
  /** Group-ordered material handles (one per class x tier draw). */
  materialHandles: UnderstoryMaterialHandle[];
  geometries: UnderstoryGeometryMap[];
}

export interface UnderstoryWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export function createGpuRingDrawResources(
  settings: UnderstorySettings,
  worldCells: number,
  gpuBackend: UnderstoryWebGpuBackendAccess,
  lighting?: EnvironmentLighting,
  hydrologyData?: UnderstoryHydrologyData | null,
  hydrologyTexture?: THREE.Texture | null,
  usePrepass = getUnderstoryDepthPrepassEnabled(),
): UnderstoryGpuRingDrawResources {
  const maxPerGroup = understoryRingGroupCapacity(settings);
  const count = Math.max(1, maxPerGroup);
  const sharedInstanceCount = count * UNDERSTORY_RING_GROUP_COUNT;

  const indirect = new StorageBufferAttribute(new Uint32Array(UNDERSTORY_RING_GROUP_COUNT * 5), 5);
  indirect.name = "understory-ring-indirect";
  gpuBackend.createIndirectStorageAttribute(indirect);

  const cell = new StorageInstancedBufferAttribute(sharedInstanceCount, 4);
  cell.name = "understory-ring-cell";
  gpuBackend.createStorageAttribute(cell);

  const ringBuffers: UnderstoryRingInstanceBuffers = { cell, capacity: sharedInstanceCount };
  const hydrology: UnderstoryRingHydrologyWater | undefined = hydrologyTexture && hydrologyData
    ? { texture: hydrologyTexture, worldSize: worldCells, res: hydrologyData.res }
    : undefined;

  const geometries = TIER_DETAILS.map((detail) => createUnderstoryGeometryMap(settings, detail));
  const meshes: UnderstoryGpuRingMesh[] = [];
  const materialHandles: UnderstoryMaterialHandle[] = [];

  for (const cls of UNDERSTORY_CLASSES) {
    const clsSettings = settings.classes[cls];
    for (let tier = 0; tier < UNDERSTORY_RING_TIER_COUNT; tier++) {
      const group = understoryRingGroupIndex(cls, tier);
      const classBaseOffset = understoryRingClassBaseOffset(group, count);
      const handle = createUnderstoryRingNodeMaterialHandle(
        settings, ringBuffers, lighting, clsSettings.minScale, clsSettings.maxScale, classBaseOffset, hydrology,
      );
      materialHandles[group] = handle;
      const mesh = createGpuRingTierDraw(
        settings,
        cls,
        tier,
        count,
        indirect,
        group * 5 * Uint32Array.BYTES_PER_ELEMENT,
        handle,
        geometries[tier],
        worldCells,
      );
      if (!mesh) continue;
      if (usePrepass) addPrepassChild(mesh, handle, cls);
      meshes[group] = mesh;
    }
  }

  return {
    meshes,
    cell,
    indirect,
    outputBuffers: {
      cell: gpuBufferForAttribute(cell, gpuBackend),
      indirectArgs: gpuBufferForAttribute(indirect, gpuBackend),
    },
    materialHandles,
    geometries,
  };
}

function addPrepassChild(mesh: UnderstoryGpuRingMesh, handle: UnderstoryMaterialHandle, cls: UnderstoryClass): void {
  const nodes = handle.prepassNodesFor?.(cls);
  if (!nodes) return;
  const twin = depthPrepassTwin(mesh, nodes, { cloneColorMaterial: false });
  twin.name = `${mesh.name}-depth-prepass`;
  mesh.add(twin);
}

function gpuRingClassCastsShadow(settings: UnderstorySettings, cls: UnderstoryClass): boolean {
  if (!settings.render.shadows) return false;
  return UNDERSTORY_CLASSES.indexOf(cls) <= UNDERSTORY_CLASSES.indexOf(settings.render.maxShadowClass);
}

function createGpuRingTierDraw(
  settings: UnderstorySettings,
  cls: UnderstoryClass,
  tier: number,
  count: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
  materialHandle: UnderstoryMaterialHandle,
  geometries: UnderstoryGeometryMap,
  worldCells: number,
): UnderstoryGpuRingMesh | null {
  const source = geometries[cls];
  if (!isRenderableIndirectDrawGeometry(source)) return null;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(source.getIndex());
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  geometry.instanceCount = count;
  setGpuRingIndirect(geometry, indirect, indirectOffset);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(worldCells + 1, 256, worldCells + 1),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(
    geometry,
    settings.render.debugColorByClass ? materialHandle.debugMaterials[cls] : materialHandle.regularMaterial,
  );
  mesh.name = `understory-ring-gpu-${cls}-${tier === 0 ? "near" : "far"}`;
  mesh.frustumCulled = false;
  mesh.castShadow = gpuRingClassCastsShadow(settings, cls);
  mesh.receiveShadow = false;
  return mesh;
}

function setGpuRingIndirect(
  geometry: THREE.InstancedBufferGeometry,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
): void {
  const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
  if (!indirectGeometry.setIndirect) {
    throw new Error("understory GPU ring requires InstancedBufferGeometry.setIndirect support");
  }
  indirectGeometry.setIndirect(indirect, indirectOffset);
}

function gpuBufferForAttribute(attribute: THREE.BufferAttribute, gpuBackend: UnderstoryWebGpuBackendAccess): GPUBuffer {
  const buffer = gpuBackend.get(attribute).buffer;
  if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "understory ring attribute"}`);
  return buffer;
}

export function clearGpuRingDraw(draw: UnderstoryGpuRingDrawResources | null): void {
  if (!draw) return;
  for (const mesh of draw.meshes) {
    if (!mesh) continue;
    disposePrepassChildren(mesh);
    mesh.geometry.dispose();
  }
  for (const handle of draw.materialHandles) {
    handle?.dispose();
  }
  for (const map of draw.geometries) {
    disposeUnderstoryGeometryMap(map);
  }
}

function disposePrepassChildren(mesh: THREE.Object3D): void {
  for (const child of [...mesh.children]) {
    if (!child.name.endsWith("-depth-prepass")) continue;
    mesh.remove(child);
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else {
      material?.dispose?.();
    }
  }
}
