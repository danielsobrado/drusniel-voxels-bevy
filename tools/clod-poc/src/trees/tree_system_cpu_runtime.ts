import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { ClodPageNode } from "../types.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings } from "./tree_config.js";
import { selectTreeLod, treeLodDistances } from "./tree_lod.js";
import { emptyTreeGenerationStats, generateTreeInstances, type TreeInstance, type TreeTerrainSampler } from "./tree_instances.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeSpeciesId } from "./tree_config.js";
import { createTreePatchMeshGroup } from "./tree_system_patch_mesh_factory.js";
import { removeTreePatchResources } from "./tree_system_lifecycle.js";
import {
  countTreePatchInstances,
  selectRetainedTreePatches,
  selectTreePatchCandidates,
  shouldDeferTreePatchRefresh,
} from "./tree_system_patch_planner.js";
import {
  treeDistance2d,
  treeFootprintCenterX,
  treeFootprintCenterZ,
  treeFootprintRadius,
} from "./tree_system_math.js";
import {
  writeTreeImpostorUvRectIfChanged,
  writeTreeLodDitherRoleIfChanged,
  writeTreeLodFadeIfChanged,
  writeTreeWorldXZIfChanged,
  type TreeLodDitherRole,
} from "./tree_system_instance_attributes.js";
import { setTreeInstanceMatrixWhenChanged } from "./tree_system_matrix_state.js";
import { updateTreeMeshAfterLod as updateTreeMeshAfterLodState, type TreeMeshBoundsState } from "./tree_system_mesh_bounds.js";
import {
  createTreeMeshWriteState,
  incrementTreeMeshWriteCount,
  markTreeMeshFadeChanged,
  markTreeMeshImpostorUvChanged,
  markTreeMeshMatrixChanged,
  markTreeMeshWorldXZChanged,
  resetTreeMeshWriteStateForGrid,
  treeMeshWriteCount,
  type TreeMeshWriteState,
} from "./tree_system_write_state.js";
import type { TreePatch } from "./tree_system_types.js";

export type TreeLodCounts = Record<TreeLod, number>;

export interface TreeCpuPatchRuntimeInput {
  root: THREE.Object3D;
  nodes: readonly ClodPageNode[];
  patches: readonly TreePatch[];
  settings: TreeSettings;
  sampler: TreeTerrainSampler | undefined;
  worldCells: number;
  meshBoundsState: WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  geometryFor(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
  materialFor(species: TreeSpeciesId, lod: TreeLod): THREE.Material;
  castsShadow(lod: TreeLod): boolean;
  resolveLod(species: TreeSpeciesId, lod: TreeLod): TreeLod;
  /** TP-3: depth-prepass nodes per species/LOD; absent ⇒ no CPU prepass. */
  prepassNodesFor?(species: TreeSpeciesId, lod: TreeLod): PrepassNodes | undefined;
}

export interface TreePatchRefreshResult {
  patches: TreePatch[];
  patchesDirty: boolean;
}

const TREE_CPU_MATRIX = new THREE.Matrix4();
const TREE_CPU_MATRIX_SCRATCH = new THREE.Matrix4();
const TREE_CPU_SCALE = new THREE.Vector3();
const TREE_CPU_ROTATION = new THREE.Quaternion();
const TREE_CPU_TRANSLATION = new THREE.Vector3();
const TREE_CPU_UP_AXIS = new THREE.Vector3(0, 1, 0);

export function createTreeLodCounts(): TreeLodCounts {
  return { near: 0, mid: 0, far: 0, impostor: 0 };
}

export function resetTreeLodCounts(lodCounts: TreeLodCounts): void {
  lodCounts.near = 0;
  lodCounts.mid = 0;
  lodCounts.far = 0;
  lodCounts.impostor = 0;
}

export function refreshTreePatchesForCenter(input: TreeCpuPatchRuntimeInput, center: THREE.Vector3): TreePatchRefreshResult {
  const retained = selectRetainedTreePatches(input.patches, center.x, center.z, input.settings.distanceM);
  const retainedNodeIds = new Set(retained.map((patch) => patch.nodeId));
  for (const patch of input.patches) {
    if (!retainedNodeIds.has(patch.nodeId)) removeTreePatchResources(input.root, patch);
  }

  const existing = new Set(retained.map((patch) => patch.nodeId));
  const candidates = selectTreePatchCandidates(input.nodes, existing, center.x, center.z, input.settings.distanceM);
  let totalTrees = countTreePatchInstances(retained);
  let added = 0;
  const patches = [...retained];
  for (const { node } of candidates) {
    if (added >= input.settings.maxNewPatchesPerFrame || totalTrees >= input.settings.maxInstances) break;
    const patch = createTreePatch(input, node, input.settings.maxInstances - totalTrees);
    totalTrees += patch.instances.length;
    patches.push(patch);
    input.root.add(patch.group);
    added++;
  }

  return {
    patches,
    patchesDirty: shouldDeferTreePatchRefresh(added, candidates.length),
  };
}

export function updateTreePatchLods(
  input: TreeCpuPatchRuntimeInput,
  center: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  lodCounts: TreeLodCounts,
): void {
  const lodDistances = treeLodDistances(input.settings);
  const write = createTreeMeshWriteState();
  resetTreeLodCounts(lodCounts);
  const crossfade = input.settings.lod.crossfadeEnabled && input.settings.lod.ditherEnabled;
  for (const patch of input.patches) {
    resetTreeMeshWriteStateForGrid(patch.meshes, write);
    patch.visible = treeDistance2d(center.x, center.z, patch.centerX, patch.centerZ) <= lodDistances.impostor + patch.radius;
    patch.group.visible = patch.visible;
    if (!patch.visible) {
      flushPatchMeshes(input, patch, center, write);
      continue;
    }
    for (let instanceIndex = 0; instanceIndex < patch.instances.length; instanceIndex++) {
      const instance = patch.instances[instanceIndex];
      const distance = treeDistance2d(center.x, center.z, instance.position[0], instance.position[2]);
      if (distance > lodDistances.impostor) {
        patch.previousLods[instanceIndex] = null;
        continue;
      }
      const selection = selectTreeLod(distance, patch.previousLods[instanceIndex], input.settings);
      patch.previousLods[instanceIndex] = selection.lod;
      const primaryLod = input.resolveLod(instance.species, selection.lod);
      lodCounts[primaryLod]++;
      placeTreeInstance(input, patch, instance, primaryLod, crossfade ? selection.fade : 1, 0, cameraPosition, write);
      if (crossfade && selection.secondaryLod) {
        const secondaryLod = input.resolveLod(instance.species, selection.secondaryLod);
        if (secondaryLod !== primaryLod) {
          placeTreeInstance(input, patch, instance, secondaryLod, selection.secondaryFade, 1, cameraPosition, write);
        }
      }
    }
    flushPatchMeshes(input, patch, center, write);
  }
}

function createTreePatch(input: TreeCpuPatchRuntimeInput, node: ClodPageNode, capacityLeft: number): TreePatch {
  const generationStats = emptyTreeGenerationStats();
  const instances = generateTreeInstances(
    node.footprint,
    input.settings,
    capacityLeft,
    generationStats,
    input.sampler,
    input.worldCells,
  );
  const centerX = treeFootprintCenterX(node.footprint);
  const centerZ = treeFootprintCenterZ(node.footprint);
  const { group, meshes } = createTreePatchMeshGroup({
    nodeId: node.id,
    instances,
    geometryFor: input.geometryFor,
    materialFor: input.materialFor,
    castsShadow: input.castsShadow,
    prepassNodesFor: input.prepassNodesFor,
  });
  group.position.set(centerX, 0, centerZ);
  return {
    nodeId: node.id,
    footprint: node.footprint,
    centerX,
    centerZ,
    radius: treeFootprintRadius(node.footprint),
    instances,
    group,
    meshes,
    previousLods: instances.map(() => null),
    visible: false,
    generationStats,
  };
}

function flushPatchMeshes(
  input: TreeCpuPatchRuntimeInput,
  patch: TreePatch,
  center: THREE.Vector3,
  write: TreeMeshWriteState,
): void {
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      const mesh = patch.meshes[species][lod];
      input.meshBoundsState.set(mesh, updateTreeMeshAfterLodState({
        mesh,
        nextCount: write.counts.get(mesh) ?? 0,
        center,
        lod,
        matrixChanged: write.matrixChanged.get(mesh) ?? false,
        worldXZChanged: write.worldXZChanged.get(mesh) ?? false,
        impostorUvChanged: write.impostorUvChanged.get(mesh) ?? false,
        fadeChanged: write.fadeChanged.get(mesh) ?? false,
        axialBillboard: input.settings.impostors.axialBillboard,
        previousState: input.meshBoundsState.get(mesh),
      }));
    }
  }
}

function placeTreeInstance(
  input: TreeCpuPatchRuntimeInput,
  patch: TreePatch,
  instance: TreeInstance,
  lod: TreeLod,
  fade: number,
  ditherRole: TreeLodDitherRole,
  cameraPosition: THREE.Vector3,
  write: TreeMeshWriteState,
): void {
  const mesh = patch.meshes[instance.species][lod];
  const index = treeMeshWriteCount(mesh, write);
  if (index >= mesh.instanceMatrix.count) return;
  TREE_CPU_TRANSLATION.set(
    instance.position[0] - patch.centerX,
    instance.position[1],
    instance.position[2] - patch.centerZ,
  );
  const rotationY = lod === "impostor" && input.settings.impostors.axialBillboard
    ? Math.atan2(cameraPosition.x - instance.position[0], cameraPosition.z - instance.position[2])
    : instance.rotationY;
  TREE_CPU_ROTATION.setFromAxisAngle(TREE_CPU_UP_AXIS, rotationY);
  TREE_CPU_SCALE.setScalar(instance.scale);
  TREE_CPU_MATRIX.compose(TREE_CPU_TRANSLATION, TREE_CPU_ROTATION, TREE_CPU_SCALE);
  if (setTreeInstanceMatrixWhenChanged(mesh, index, TREE_CPU_MATRIX, TREE_CPU_MATRIX_SCRATCH)) markTreeMeshMatrixChanged(mesh, write);
  if (writeTreeWorldXZIfChanged(mesh, index, instance.position[0], instance.position[2])) {
    markTreeMeshWorldXZChanged(mesh, write);
  }
  if (
    writeTreeLodFadeIfChanged(mesh, index, fade) ||
    writeTreeLodDitherRoleIfChanged(mesh, index, ditherRole)
  ) markTreeMeshFadeChanged(mesh, write);
  if (lod === "impostor" && writeTreeImpostorUvRectIfChanged({
    mesh,
    index,
    instance,
    cameraPosition,
    settings: input.settings,
    impostorAtlases: input.impostorAtlases,
  })) {
    markTreeMeshImpostorUvChanged(mesh, write);
  }
  incrementTreeMeshWriteCount(mesh, write);
}
