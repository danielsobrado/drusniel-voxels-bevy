import * as THREE from "three";
import type { StorageBufferAttribute } from "three/webgpu";
import { treeGpuRingGroupIndex } from "../gpu/tree_ring_compute.js";
import { TREE_SPECIES, type TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";
import { decorateTreeRingLodCrossfade } from "./tree_ring_lod_crossfade_material.js";
import {
  createTreeGpuRingInstancedGeometry,
  isRenderableTreeGpuRingGeometry,
  TREE_GPU_RING_INSTANCE_VEC4S,
  type TreeGpuRingMesh,
} from "./tree_system_gpu_ring_draw.js";
import { addTreeGpuRingPrepassTwin } from "./tree_system_gpu_ring_prepass.js";
import type { TreeGpuRingDrawResourcesInput } from "./tree_system_gpu_ring_resources.js";
import type { TreeGpuRingDrawResources } from "./tree_system_types.js";

export interface TreeGpuRingImpostorRefreshFactory {
  createMaterialHandle(
    input: TreeGpuRingDrawResourcesInput,
    buffers: TreeRingInstanceBuffers,
    species: TreeSpeciesId,
    atlas: TreeImpostorAtlas,
  ): TreeMaterialHandle;
  createGeometry(
    source: THREE.BufferGeometry,
    instanceCount: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    worldCells: number,
  ): THREE.InstancedBufferGeometry;
  createPrepassTwin(
    input: TreeGpuRingDrawResourcesInput,
    mesh: TreeGpuRingMesh,
    materialHandle: TreeMaterialHandle,
  ): THREE.Mesh | null;
}

interface PreparedTreeGpuRingImpostorRefresh {
  mesh: TreeGpuRingMesh;
  materialKey: string;
  group: number;
  indexCount: number;
  nextGeometry: THREE.InstancedBufferGeometry;
  nextHandle: TreeMaterialHandle;
  nextTwin: THREE.Mesh | null;
}

const DEFAULT_FACTORY: TreeGpuRingImpostorRefreshFactory = {
  createMaterialHandle(input, buffers, _species, atlas) {
    const base = createTreeRingImpostorNodeMaterialHandle(
      input.settings,
      buffers,
      atlas,
      input.currentLighting,
      input.hydrologyWater,
    );
    let decorated: TreeMaterialHandle | undefined;
    try {
      decorated = decorateTreeRingLodCrossfade(base, input.settings, buffers, "impostor");
      decorated.updateForestLighting?.(input.currentForestLighting);
      return decorated;
    } catch (error) {
      (decorated ?? base).dispose();
      throw error;
    }
  },
  createGeometry: createTreeGpuRingInstancedGeometry,
  createPrepassTwin(input, mesh, materialHandle) {
    return addTreeGpuRingPrepassTwin({
      root: input.root,
      twins: input.ringPrepassTwins,
      lod: "impostor",
      mesh,
      materialHandle,
      useTreePrepass: input.useTreePrepass,
      maxLod: input.treePrepassMaxLod,
    });
  },
};

export function refreshTreeGpuRingImpostorsTransactionally(
  input: TreeGpuRingDrawResourcesInput,
  resources: TreeGpuRingDrawResources,
  factory: TreeGpuRingImpostorRefreshFactory = DEFAULT_FACTORY,
): boolean {
  if (!input.settings.impostors.enabled) return false;

  const capacity = Math.max(1, Math.floor(resources.cell.count / TREE_GPU_RING_INSTANCE_VEC4S));
  const ringBuffers: TreeRingInstanceBuffers = { cell: resources.cell, capacity };
  const stagingRoot = new THREE.Group();
  const stagingTwins: THREE.Mesh[] = [];
  const stagingInput: TreeGpuRingDrawResourcesInput = {
    ...input,
    root: stagingRoot,
    ringPrepassTwins: stagingTwins,
  };
  const prepared: PreparedTreeGpuRingImpostorRefresh[] = [];

  try {
    for (const species of TREE_SPECIES) {
      const atlas = input.impostorAtlases[species];
      if (!atlas?.ready) continue;

      const mesh = resources.meshes.find((candidate) => candidate.name === gpuImpostorMeshName(species));
      if (!mesh) continue;

      const source = input.geometryForGpuRing(species, "impostor");
      if (!isRenderableTreeGpuRingGeometry(source)) continue;

      const materialKey = `${species}:impostor`;
      const group = treeGpuRingGroupIndex(species, "impostor");
      let nextHandle: TreeMaterialHandle | undefined;
      let nextGeometry: THREE.InstancedBufferGeometry | undefined;
      try {
        nextHandle = factory.createMaterialHandle(stagingInput, ringBuffers, species, atlas);
        nextGeometry = factory.createGeometry(
          source,
          mesh.geometry.instanceCount,
          resources.indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          input.worldCells,
        );
        const stagingMesh = new THREE.Mesh(
          nextGeometry,
          selectedImpostorMaterial(input, nextHandle),
        ) as TreeGpuRingMesh;
        stagingMesh.name = mesh.name;
        const nextTwin = factory.createPrepassTwin(stagingInput, stagingMesh, nextHandle);
        prepared.push({
          mesh,
          materialKey,
          group,
          indexCount: source.getIndex()?.count ?? source.getAttribute("position")?.count ?? 0,
          nextGeometry,
          nextHandle,
          nextTwin,
        });
      } catch (error) {
        nextGeometry?.dispose();
        nextHandle?.dispose();
        throw error;
      }
    }
  } catch (error) {
    disposePreparedRefresh(prepared, stagingTwins);
    throw error;
  }

  if (prepared.length === 0) return false;

  const retiredGeometries = new Set<THREE.BufferGeometry>();
  const retiredHandles = new Set<TreeMaterialHandle>();
  const retiredTwins = new Set<THREE.Mesh>();
  const indirect = resources.indirect.array as Uint32Array;

  for (const replacement of prepared) {
    retiredGeometries.add(replacement.mesh.geometry);
    const previousHandle = resources.materialHandles[replacement.materialKey];
    if (previousHandle) retiredHandles.add(previousHandle);

    replacement.mesh.geometry = replacement.nextGeometry;
    replacement.mesh.material = selectedImpostorMaterial(input, replacement.nextHandle);
    resources.materialHandles[replacement.materialKey] = replacement.nextHandle;
    indirect[replacement.group * 5] = replacement.indexCount;
  }

  for (const replacement of prepared) {
    const previousTwin = commitPreparedPrepassTwin(input, replacement.mesh, replacement.nextTwin);
    if (previousTwin) retiredTwins.add(previousTwin);
  }

  resources.indirect.needsUpdate = true;
  for (const twin of retiredTwins) disposePrepassTwin(twin);
  for (const geometry of retiredGeometries) geometry.dispose();
  for (const handle of retiredHandles) handle.dispose();
  return true;
}

function selectedImpostorMaterial(
  input: TreeGpuRingDrawResourcesInput,
  handle: TreeMaterialHandle,
): THREE.Material {
  return input.settings.render.debugColorByLod
    ? handle.debugMaterials.impostor
    : handle.regularMaterial;
}

function gpuImpostorMeshName(species: TreeSpeciesId): string {
  return `trees-ring-gpu-${species}-impostor`;
}

function commitPreparedPrepassTwin(
  input: TreeGpuRingDrawResourcesInput,
  mesh: TreeGpuRingMesh,
  nextTwin: THREE.Mesh | null,
): THREE.Mesh | null {
  const twinName = `${mesh.name}-depth-prepass`;
  const previousIndex = input.ringPrepassTwins.findIndex((twin) => twin.name === twinName);
  const previous = previousIndex >= 0
    ? input.ringPrepassTwins.splice(previousIndex, 1)[0]
    : undefined;
  if (previous) input.root.remove(previous);

  if (nextTwin) {
    nextTwin.parent?.remove(nextTwin);
    input.ringPrepassTwins.push(nextTwin);
    input.root.add(nextTwin);
  }
  return previous ?? null;
}

function disposePreparedRefresh(
  prepared: readonly PreparedTreeGpuRingImpostorRefresh[],
  stagingTwins: readonly THREE.Mesh[],
): void {
  const twins = new Set<THREE.Mesh>(stagingTwins);
  for (const replacement of prepared) {
    if (replacement.nextTwin) twins.add(replacement.nextTwin);
  }
  for (const twin of twins) disposePrepassTwin(twin);
  for (const replacement of prepared) {
    replacement.nextGeometry.dispose();
    replacement.nextHandle.dispose();
  }
}

function disposePrepassTwin(twin: THREE.Mesh): void {
  twin.parent?.remove(twin);
  if (Array.isArray(twin.material)) {
    for (const material of twin.material) material.dispose();
  } else {
    twin.material.dispose();
  }
  (twin as THREE.Mesh & { dispose?: () => void }).dispose?.();
}
