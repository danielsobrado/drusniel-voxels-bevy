import * as THREE from "three";
import type { StorageBufferAttribute } from "three/webgpu";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingGroupIndex,
} from "../gpu/tree_ring_compute.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeDepthPrepassMaxLod } from "./tree_depth_prepass_runtime.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { createTreeRingNodeMaterialHandle, type TreeHydrologyWater, type TreeRingInstanceBuffers } from "./tree_node_material.js";
import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";
import { createTreeRingFarNodeMaterialHandle, treeRingUsesFarMaterial } from "./tree_ring_far_node_material.js";
import { createTreeCrownProxyNodeMaterialHandle } from "./tree_crown_proxy_node_material.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import { decorateTreeMaterialHandle } from "./tree_material_parity.js";
import { decorateTreeRingLodCrossfade } from "./tree_ring_lod_crossfade_material.js";
import {
  TREE_RING_SHADOW_CASCADE_COUNT,
  treeRingShadowCasterGroupIndex,
} from "./tree_ring_shadow_casters.js";
import {
  createTreeGpuRingDrawBuffers,
  createTreeGpuRingInstancedGeometry,
  createTreeGpuRingMesh,
  createTreeGpuRingShadowMesh,
  isRenderableTreeGpuRingGeometry,
  TREE_GPU_RING_INSTANCE_VEC4S,
  type TreeGpuRingMesh,
} from "./tree_system_gpu_ring_draw.js";
import { addTreeGpuRingPrepassTwin } from "./tree_system_gpu_ring_prepass.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import type {
  TreeGpuRingDrawResources,
  TreeWebGpuBackendAccess,
} from "./tree_system_types.js";

export interface TreeGpuRingDrawResourcesInput {
  backend: TreeWebGpuBackendAccess;
  root: THREE.Object3D;
  ringPrepassTwins: THREE.Mesh[];
  settings: TreeSettings;
  worldCells: number;
  currentLighting: EnvironmentLighting | undefined;
  hydrologyWater: TreeHydrologyWater | undefined;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  foliageAtlas: TreeFoliageAtlas;
  crownProxyGeometry: THREE.BufferGeometry;
  useTreePrepass: boolean;
  treePrepassMaxLod: TreeDepthPrepassMaxLod;
  geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
}

export function createTreeSystemGpuRingDrawResources(
  input: TreeGpuRingDrawResourcesInput,
  maxInstancesPerGroup: number,
): TreeGpuRingDrawResources {
  const count = Math.max(1, maxInstancesPerGroup);
  const buffers = createTreeGpuRingDrawBuffers(input.backend, count, TREE_GPU_RING_GROUP_COUNT, {
    maxShadowCastersPerGroup: count,
    shadowCascadeCount: TREE_RING_SHADOW_CASCADE_COUNT,
  });
  if (!buffers.shadowCell || !buffers.shadowIndirect) {
    throw new Error("tree GPU ring requires shadow draw buffers");
  }
  const ringBuffers: TreeRingInstanceBuffers = { cell: buffers.cell, capacity: count * TREE_GPU_RING_GROUP_COUNT };
  const shadowRingBuffers: TreeRingInstanceBuffers = { cell: buffers.shadowCell, capacity: count * TREE_GPU_RING_SHADOW_GROUP_COUNT };
  const materialHandles = {} as Record<string, TreeMaterialHandle>;
  const meshes: TreeGpuRingMesh[] = [];
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      const materialKey = species + ":" + lod;
      materialHandles[materialKey] = createTreeGpuRingMaterialHandle(input, ringBuffers, species, lod);
      const group = treeGpuRingGroupIndex(species, lod);
      const mesh = createGpuRingTierDraw(
        input,
        species,
        lod,
        count,
        buffers.indirect,
        group * 5 * Uint32Array.BYTES_PER_ELEMENT,
        materialHandles[materialKey],
      );
      if (mesh) meshes.push(mesh);
      if (treeLodCastsShadow(input.settings, lod)) {
        for (let cascade = 0; cascade < TREE_RING_SHADOW_CASCADE_COUNT; cascade++) {
          const shadowMaterialKey = "shadow:" + cascade + ":" + materialKey;
          materialHandles[shadowMaterialKey] = createGpuRingShadowMaterialHandle(input, species, lod, shadowRingBuffers);
          const shadowGroup = treeRingShadowCasterGroupIndex(species, lod, cascade);
          const shadowMesh = createGpuRingShadowTierDraw(
            input,
            species,
            lod,
            cascade,
            count,
            buffers.shadowIndirect,
            shadowGroup * 5 * Uint32Array.BYTES_PER_ELEMENT,
            materialHandles[shadowMaterialKey],
          );
          if (shadowMesh) meshes.push(shadowMesh);
        }
      }
    }
  }
  return {
    meshes,
    cell: buffers.cell,
    indirect: buffers.indirect,
    shadowCell: buffers.shadowCell,
    shadowIndirect: buffers.shadowIndirect,
    materialHandles,
    outputBuffers: buffers.outputBuffers,
  };
}

export function refreshTreeSystemGpuRingImpostorResources(
  input: TreeGpuRingDrawResourcesInput,
  resources: TreeGpuRingDrawResources,
): boolean {
  const capacity = Math.max(1, Math.floor(resources.cell.count / TREE_GPU_RING_INSTANCE_VEC4S));
  const ringBuffers: TreeRingInstanceBuffers = { cell: resources.cell, capacity };
  let swapped = false;

  for (const species of TREE_SPECIES) {
    const atlas = input.impostorAtlases[species];
    if (!input.settings.impostors.enabled || !atlas?.ready) continue;

    const meshName = `trees-ring-gpu-${species}-impostor`;
    const mesh = resources.meshes.find((candidate) => candidate.name === meshName);
    if (!mesh) continue;

    const source = input.geometryForGpuRing(species, "impostor");
    if (!isRenderableTreeGpuRingGeometry(source)) continue;

    const materialKey = `${species}:impostor`;
    const nextHandle = createTreeGpuRingMaterialHandle(input, ringBuffers, species, "impostor");
    const group = treeGpuRingGroupIndex(species, "impostor");
    const nextGeometry = createTreeGpuRingInstancedGeometry(
      source,
      mesh.geometry.instanceCount,
      resources.indirect,
      group * 5 * Uint32Array.BYTES_PER_ELEMENT,
      input.worldCells,
    );
    const previousGeometry = mesh.geometry;
    const previousHandle = resources.materialHandles[materialKey];

    mesh.geometry = nextGeometry;
    mesh.material = input.settings.render.debugColorByLod
      ? nextHandle.debugMaterials.impostor
      : nextHandle.regularMaterial;
    resources.materialHandles[materialKey] = nextHandle;
    updateTreeGpuRingIndirectIndexCount(resources.indirect, group, source);
    replaceTreeGpuRingPrepassTwin(input, mesh, nextHandle);

    previousGeometry.dispose();
    previousHandle?.dispose();
    swapped = true;
  }

  return swapped;
}

function createTreeGpuRingMaterialHandle(
  input: TreeGpuRingDrawResourcesInput,
  buffers: TreeRingInstanceBuffers,
  species: TreeSpeciesId,
  lod: TreeLod,
): TreeMaterialHandle {
  const atlas = input.impostorAtlases[species];
  if (lod === "impostor" && input.settings.impostors.enabled && atlas?.ready) {
    const impostor = createTreeRingImpostorNodeMaterialHandle(
      input.settings,
      buffers,
      atlas,
      input.currentLighting ?? undefined,
      input.hydrologyWater,
    );
    return decorateTreeRingLodCrossfade(impostor, input.settings, buffers, lod);
  }

  const base = input.settings.render.farCheapMaterial && treeRingUsesFarMaterial(lod)
    ? createTreeRingFarNodeMaterialHandle(
      input.settings,
      buffers,
      lod,
      input.currentLighting ?? undefined,
      input.hydrologyWater,
    )
    : createTreeRingNodeMaterialHandle(
      input.settings,
      buffers,
      lod,
      input.currentLighting ?? undefined,
      input.hydrologyWater,
    );
  const parity = decorateTreeMaterialHandle(base, {
    foliageAtlas: input.foliageAtlas,
    ring: {
      settings: input.settings,
      buffers,
      forestLighting: true,
    },
  });
  return decorateTreeRingLodCrossfade(parity, input.settings, buffers, lod);
}

function createGpuRingTierDraw(
  input: TreeGpuRingDrawResourcesInput,
  species: TreeSpeciesId,
  lod: TreeLod,
  count: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
  materialHandle: TreeMaterialHandle,
): TreeGpuRingMesh | null {
  const source = input.geometryForGpuRing(species, lod);
  if (!isRenderableTreeGpuRingGeometry(source)) return null;
  const geometry = createTreeGpuRingInstancedGeometry(source, count, indirect, indirectOffset, input.worldCells);
  const mesh = createTreeGpuRingMesh(
    geometry,
    materialHandle,
    species,
    lod,
    input.settings.render.debugColorByLod,
    false,
  );
  addTreeGpuRingPrepassTwin({
    root: input.root,
    twins: input.ringPrepassTwins,
    lod,
    mesh,
    materialHandle,
    useTreePrepass: input.useTreePrepass,
    maxLod: input.treePrepassMaxLod,
  });
  return mesh;
}

function createGpuRingShadowMaterialHandle(
  input: TreeGpuRingDrawResourcesInput,
  species: TreeSpeciesId,
  lod: TreeLod,
  buffers: TreeRingInstanceBuffers,
): TreeMaterialHandle {
  if (lod === "far" || lod === "impostor") {
    return createTreeCrownProxyNodeMaterialHandle(input.settings, buffers, species, lod);
  }
  const base = createTreeRingNodeMaterialHandle(
    input.settings,
    buffers,
    lod,
    input.currentLighting ?? undefined,
    input.hydrologyWater,
  );
  return decorateTreeMaterialHandle(base, {
    foliageAtlas: input.foliageAtlas,
    ring: {
      settings: input.settings,
      buffers,
      forestLighting: false,
    },
  });
}

function createGpuRingShadowTierDraw(
  input: TreeGpuRingDrawResourcesInput,
  species: TreeSpeciesId,
  lod: TreeLod,
  cascadeIndex: number,
  count: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
  materialHandle: TreeMaterialHandle,
): TreeGpuRingMesh | null {
  const source = input.geometryForGpuRing(species, lod);
  if (!isRenderableTreeGpuRingGeometry(source)) return null;
  const geometry = createTreeGpuRingInstancedGeometry(source, count, indirect, indirectOffset, input.worldCells);
  return createTreeGpuRingShadowMesh(geometry, materialHandle, species, lod, cascadeIndex);
}

function updateTreeGpuRingIndirectIndexCount(
  indirect: StorageBufferAttribute,
  group: number,
  source: THREE.BufferGeometry,
): void {
  const array = indirect.array as Uint32Array;
  const offset = group * 5;
  array[offset] = source.getIndex()?.count ?? source.getAttribute("position")?.count ?? 0;
  indirect.needsUpdate = true;
}

function replaceTreeGpuRingPrepassTwin(
  input: TreeGpuRingDrawResourcesInput,
  mesh: TreeGpuRingMesh,
  materialHandle: TreeMaterialHandle,
): void {
  const twinName = `${mesh.name}-depth-prepass`;
  const index = input.ringPrepassTwins.findIndex((twin) => twin.name === twinName);
  if (index >= 0) {
    const [previous] = input.ringPrepassTwins.splice(index, 1);
    input.root.remove(previous);
    if (Array.isArray(previous.material)) {
      for (const material of previous.material) material.dispose();
    } else {
      previous.material.dispose();
    }
  }
  addTreeGpuRingPrepassTwin({
    root: input.root,
    twins: input.ringPrepassTwins,
    lod: "impostor",
    mesh,
    materialHandle,
    useTreePrepass: input.useTreePrepass,
    maxLod: input.treePrepassMaxLod,
  });
}
