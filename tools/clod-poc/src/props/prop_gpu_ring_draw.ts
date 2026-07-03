import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { isRenderableIndirectDrawGeometry } from "../gpu/indirect_draw_geometry.js";
import type { CustomPropsSettings } from "./prop_types.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import {
  emptyGpuRingSource,
  lodGeometry,
  type IndirectInstancedBufferGeometry,
  type PropGpuRingDrawResources,
  type PropWebGpuBackendAccess,
} from "./prop_system_support.js";
import { createPropGpuRingMaterial } from "./prop_gpu_ring_material.js";
import {
  propGpuRingGroupCapacity,
  type PropGpuRingSourceData,
} from "../gpu/prop_ring_compute.js";
import type { PropSpatialGrid } from "./prop_spatial_grid.js";

export function buildPropGpuRingSource(input: {
  grid: PropSpatialGrid | null;
  settings: CustomPropsSettings;
  loadedAssets: ReadonlyMap<string, LoadedPropAsset>;
  indexCountFor: (geometry: THREE.BufferGeometry) => number;
}): PropGpuRingSourceData {
  const { grid, settings, loadedAssets, indexCountFor } = input;
  if (!grid) return emptyGpuRingSource();
  const assetDefs = settings.props.filter((def) => loadedAssets.has(def.id));
  const assetIndexById = new Map<string, number>();
  const groupMeta: number[] = [];
  const assetMeta = new Float32Array(Math.max(1, assetDefs.length) * 4);
  const assetLods = new Float32Array(Math.max(1, assetDefs.length) * 4);
  let group = 0;
  assetDefs.forEach((def, assetIndex) => {
    const loaded = loadedAssets.get(def.id)!;
    const lodCount = Math.min(4, Math.max(1, loaded.lodChain?.levels.length ?? def.lod.distances.length));
    assetIndexById.set(def.id, assetIndex);
    assetMeta[assetIndex * 4] = def.culling.maxDistance;
    assetMeta[assetIndex * 4 + 1] = loaded.metadata.boundingSphereRadius;
    assetMeta[assetIndex * 4 + 2] = lodCount;
    assetMeta[assetIndex * 4 + 3] = group;
    for (let lod = 0; lod < 4; lod++) assetLods[assetIndex * 4 + lod] = def.lod.distances[lod] ?? Number.POSITIVE_INFINITY;
    for (let lod = 0; lod < lodCount; lod++) {
      const geometry = lodGeometry(loaded, lod);
      const indexCount = geometry && isRenderableIndirectDrawGeometry(geometry) ? indexCountFor(geometry) : 0;
      groupMeta.push(assetIndex, lod, indexCount, 0);
      group++;
    }
  });
  if (assetDefs.length === 0 || group === 0) return emptyGpuRingSource();

  const sourceA: number[] = [];
  const sourceB: number[] = [];
  for (const inst of grid.instances) {
    const assetIndex = assetIndexById.get(inst.assetId);
    if (assetIndex === undefined) continue;
    sourceA.push(inst.position[0], inst.position[1], inst.position[2], inst.scale);
    sourceB.push(inst.rotationY, assetIndex, 0, 0);
  }

  return {
    sourceA: new Float32Array(sourceA.length > 0 ? sourceA : [0, 0, 0, 1]),
    sourceB: new Float32Array(sourceB.length > 0 ? sourceB : [0, 0, 0, 0]),
    assetMeta,
    assetLods,
    groupMeta: new Uint32Array(groupMeta.length > 0 ? groupMeta : [0, 0, 0, 0]),
    sourceCount: sourceA.length / 4,
    groupCount: group,
  };
}

export function createPropGpuRingDrawResources(input: {
  source: PropGpuRingSourceData;
  settings: CustomPropsSettings;
  loadedAssets: ReadonlyMap<string, LoadedPropAsset>;
  gpuBackend: PropWebGpuBackendAccess | null | undefined;
}): PropGpuRingDrawResources {
  const { source, settings, loadedAssets, gpuBackend } = input;
  if (!gpuBackend) throw new Error("Cannot create WebGPU prop ring resources without a backend");
  const maxInstancesPerGroup = propGpuRingGroupCapacity(settings, source.groupCount);
  const capacity = Math.max(1, maxInstancesPerGroup * source.groupCount);
  const instanceA = createStorageInstancedAttribute(gpuBackend, "instance-a", capacity);
  const instanceB = createStorageInstancedAttribute(gpuBackend, "instance-b", capacity);
  const indirect = new StorageBufferAttribute(new Uint32Array(source.groupCount * 5), 5);
  indirect.name = "prop-ring-indirect";
  gpuBackend.createIndirectStorageAttribute(indirect);

  const meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[] = [];
  let group = 0;
  for (const def of settings.props) {
    const loaded = loadedAssets.get(def.id);
    if (!loaded) continue;
    const lodCount = Math.min(4, Math.max(1, loaded.lodChain?.levels.length ?? def.lod.distances.length));
    for (let lod = 0; lod < lodCount; lod++) {
      const geometry = lodGeometry(loaded, lod);
      if (!geometry || !isRenderableIndirectDrawGeometry(geometry)) {
        group++;
        continue;
      }
      const drawGeometry = createPropGpuRingGeometry(geometry, maxInstancesPerGroup, indirect, group * 5 * Uint32Array.BYTES_PER_ELEMENT);
      const material = createPropGpuRingMaterial(loaded.sourceMaterial, { instanceA, instanceB, capacity });
      const mesh = new THREE.Mesh(drawGeometry, material);
      mesh.name = `props-ring-gpu-${def.id}-lod${lod}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      meshes.push(mesh);
      group++;
    }
  }

  return { meshes, instanceA, instanceB, indirect, source, maxInstancesPerGroup };
}

function createPropGpuRingGeometry(
  source: THREE.BufferGeometry,
  instanceCount: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(source.getIndex());
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name));
  geometry.instanceCount = Math.max(1, instanceCount);
  const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
  if (!indirectGeometry.setIndirect) throw new Error("custom prop GPU ring requires InstancedBufferGeometry.setIndirect support");
  indirectGeometry.setIndirect(indirect, indirectOffset);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, -1024, -1),
    new THREE.Vector3(1_000_000, 4096, 1_000_000),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

function createStorageInstancedAttribute(
  gpuBackend: PropWebGpuBackendAccess,
  name: string,
  count: number,
): StorageInstancedBufferAttribute {
  const attribute = new StorageInstancedBufferAttribute(Math.max(1, Math.floor(count)), 4);
  attribute.name = `prop-ring-${name}`;
  gpuBackend.createStorageAttribute(attribute);
  return attribute;
}
