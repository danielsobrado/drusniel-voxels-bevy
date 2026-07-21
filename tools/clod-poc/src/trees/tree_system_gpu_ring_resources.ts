import * as THREE from "three";
import type { StorageBufferAttribute } from "three/webgpu";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import { renderableIndirectDrawCountForGeometry } from "../gpu/indirect_draw_geometry.js";
import {
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingGroupIndex,
} from "../gpu/tree_ring_compute.js";
import { disposeAfterGpuIdle } from "../rendering/deferred_gpu_dispose.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { TREE_CROWN_PROXY_INDEX_COUNT } from "./tree_crown_proxy_math.js";
import type { TreeDepthPrepassMaxLod } from "./tree_depth_prepass_runtime.js";
import {
  disposeTreeGpuRingGeometry,
  disposeTreeGpuRingMaterialHandle,
  disposeTreeGpuRingMeshState,
  disposeTreeGpuRingOwnedResources,
  disposeTreeGpuRingPrepassTwin,
} from "./tree_gpu_ring_resource_lifecycle.js";
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

export const TREE_GPU_RING_DISABLED_SHADOW_CAPACITY_PER_GROUP = 1;

export interface TreeGpuRingDrawResourcesInput {
  backend: TreeWebGpuBackendAccess;
  root: THREE.Object3D;
  ringPrepassTwins: THREE.Mesh[];
  settings: TreeSettings;
  worldCells: number;
  currentLighting: EnvironmentLighting | undefined;
  currentForestLighting: ForestLightingMaterialState | null;
  hydrologyWater: TreeHydrologyWater | undefined;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  foliageAtlas: TreeFoliageAtlas;
  crownProxyGeometry: THREE.BufferGeometry;
  useTreePrepass: boolean;
  treePrepassMaxLod: TreeDepthPrepassMaxLod;
  geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
}

export function treeGpuRingAllocatedShadowCapacityPerGroup(
  settings: TreeSettings,
  maxInstancesPerGroup: number,
): number {
  const count = Math.max(1, Math.floor(maxInstancesPerGroup));
  return TREE_LODS.some((lod) => treeLodCastsShadow(settings, lod))
    ? count
    : TREE_GPU_RING_DISABLED_SHADOW_CAPACITY_PER_GROUP;
}

export function treeGpuRingUsesCrownProxyShadowGeometry(lod: TreeLod): boolean {
  return lod === "far" || lod === "impostor";
}

export function createTreeSystemGpuRingDrawResources(
  input: TreeGpuRingDrawResourcesInput,
  maxInstancesPerGroup: number,
): TreeGpuRingDrawResources {
  validateTreeGpuRingCrownProxyGeometry(input);
  const count = Math.max(1, Math.floor(maxInstancesPerGroup));
  const shadowCapacity = treeGpuRingAllocatedShadowCapacityPerGroup(input.settings, count);
  const buffers = createTreeGpuRingDrawBuffers(input.backend, count, TREE_GPU_RING_GROUP_COUNT, {
    maxShadowCastersPerGroup: shadowCapacity,
    shadowCascadeCount: TREE_RING_SHADOW_CASCADE_COUNT,
  });
  if (!buffers.shadowCell || !buffers.shadowIndirect) {
    throw new Error("tree GPU ring requires shadow draw buffers");
  }
  const ringBuffers: TreeRingInstanceBuffers = { cell: buffers.cell, capacity: count * TREE_GPU_RING_GROUP_COUNT };
  const shadowRingBuffers: TreeRingInstanceBuffers = {
    cell: buffers.shadowCell,
    capacity: shadowCapacity * TREE_GPU_RING_SHADOW_GROUP_COUNT,
  };
  const materialHandles = {} as Record<string, TreeMaterialHandle>;
  const meshes: TreeGpuRingMesh[] = [];
  const prepassStart = input.ringPrepassTwins.length;

  try {
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
            materialHandles[shadowMaterialKey] = createTreeGpuRingShadowMaterialHandle(input, species, lod, shadowRingBuffers);
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
  } catch (error) {
    const prepassTwins = input.ringPrepassTwins.splice(prepassStart);
    disposeTreeGpuRingOwnedResources({
      root: input.root,
      meshes,
      prepassTwins,
      materialHandles,
    });
    throw error;
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

    // The mesh has already been repointed at the new geometry/material, but the previous
    // frame's submitted draw still references the old buffers. Freeing them now raises
    // "buffer used in submit while destroyed" and drops a frame to black, so hold them
    // until the GPU has drained the work already submitted.
    disposeAfterGpuIdle(() => {
      previousGeometry.dispose();
      previousHandle?.dispose();
    });
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
    let handle = createTreeRingImpostorNodeMaterialHandle(
      input.settings,
      buffers,
      atlas,
      input.currentLighting ?? undefined,
      input.hydrologyWater,
    );
    try {
      handle = decorateTreeRingLodCrossfade(handle, input.settings, buffers, lod);
      return applyCurrentTreeGpuRingForestLighting(handle, input.currentForestLighting);
    } catch (error) {
      disposeTreeGpuRingMaterialHandle(handle);
      throw error;
    }
  }

  let handle = input.settings.render.farCheapMaterial && treeRingUsesFarMaterial(lod)
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
  try {
    handle = decorateTreeMaterialHandle(handle, {
      foliageAtlas: input.foliageAtlas,
      ring: {
        settings: input.settings,
        buffers,
        forestLighting: true,
      },
    });
    handle = decorateTreeRingLodCrossfade(handle, input.settings, buffers, lod);
    return applyCurrentTreeGpuRingForestLighting(handle, input.currentForestLighting);
  } catch (error) {
    disposeTreeGpuRingMaterialHandle(handle);
    throw error;
  }
}

function applyCurrentTreeGpuRingForestLighting(
  handle: TreeMaterialHandle,
  state: ForestLightingMaterialState | null,
): TreeMaterialHandle {
  handle.updateForestLighting?.(state);
  return handle;
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
  let mesh: TreeGpuRingMesh | undefined;
  try {
    mesh = createTreeGpuRingMesh(
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
  } catch (error) {
    if (mesh) disposeTreeGpuRingMeshState(mesh);
    disposeTreeGpuRingGeometry(geometry);
    throw error;
  }
}

function createTreeGpuRingShadowMaterialHandle(
  input: TreeGpuRingDrawResourcesInput,
  species: TreeSpeciesId,
  lod: TreeLod,
  buffers: TreeRingInstanceBuffers,
): TreeMaterialHandle {
  if (lod === "far" || lod === "impostor") {
    return createTreeCrownProxyNodeMaterialHandle(input.settings, buffers, species, lod);
  }
  let handle = createTreeRingNodeMaterialHandle(
    input.settings,
    buffers,
    lod,
    input.currentLighting ?? undefined,
    input.hydrologyWater,
  );
  try {
    handle = decorateTreeMaterialHandle(handle, {
      foliageAtlas: input.foliageAtlas,
      ring: {
        settings: input.settings,
        buffers,
        forestLighting: false,
      },
    });
    return handle;
  } catch (error) {
    disposeTreeGpuRingMaterialHandle(handle);
    throw error;
  }
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
  const source = treeGpuRingUsesCrownProxyShadowGeometry(lod)
    ? input.crownProxyGeometry
    : input.geometryForGpuRing(species, lod);
  if (!isRenderableTreeGpuRingGeometry(source)) return null;
  const geometry = createTreeGpuRingInstancedGeometry(source, count, indirect, indirectOffset, input.worldCells);
  let mesh: TreeGpuRingMesh | undefined;
  try {
    mesh = createTreeGpuRingShadowMesh(geometry, materialHandle, species, lod, cascadeIndex);
    return mesh;
  } catch (error) {
    if (mesh) disposeTreeGpuRingMeshState(mesh);
    disposeTreeGpuRingGeometry(geometry);
    throw error;
  }
}

function validateTreeGpuRingCrownProxyGeometry(input: TreeGpuRingDrawResourcesInput): void {
  const usesCrownProxy = TREE_LODS.some((lod) =>
    treeLodCastsShadow(input.settings, lod) && treeGpuRingUsesCrownProxyShadowGeometry(lod));
  if (!usesCrownProxy) return;
  const indexCount = renderableIndirectDrawCountForGeometry(input.crownProxyGeometry);
  if (indexCount !== TREE_CROWN_PROXY_INDEX_COUNT) {
    throw new Error(
      `tree crown proxy geometry has ${indexCount} draw indices; expected ${TREE_CROWN_PROXY_INDEX_COUNT}`,
    );
  }
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
    disposeTreeGpuRingPrepassTwin(input.root, previous);
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
