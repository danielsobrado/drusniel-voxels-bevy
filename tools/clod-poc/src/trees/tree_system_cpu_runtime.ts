import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { ClodPageNode, PageFootprint } from "../types.js";
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
  type TreePatchCandidate,
} from "./tree_system_patch_planner.js";
import {
  treeDistance2d,
  treeFootprintCenterX,
  treeFootprintCenterZ,
  treeFootprintRadius,
} from "./tree_system_math.js";
import { runtimeWorldUsesCameraRelativeCoordinates } from "../world/runtime_world_policy.js";
import {
  isTreeClusterTerrainOccluded,
  type TreeTerrainOcclusionSampler,
  type TreeTerrainOcclusionSettings,
} from "./tree_terrain_occlusion.js";
import {
  recordTreeEarlyTerrainRejection,
  rejectTreePatchBeforeGeneration,
  resetTreeEarlyTerrainRejectionStats,
  type TreeEarlyTerrainRejectionStats,
} from "./tree_patch_terrain_rejection.js";
import {
  writeTreeImpostorLocalPositionScaleIfChanged,
  writeTreeImpostorUvRectIfChanged,
  writeTreeIdentityIfChanged,
  writeTreeLodDitherRoleIfChanged,
  writeTreeMorphologyIfChanged,
  writeTreeLodFadeIfChanged,
  writeTreeWorldXZIfChanged,
  type TreeLodDitherRole,
} from "./tree_system_instance_attributes.js";
import { setTreeInstanceMatrixWhenChanged } from "./tree_system_matrix_state.js";
import { updateTreeMeshAfterLod as updateTreeMeshAfterLodState, type TreeMeshBoundsState } from "./tree_system_mesh_bounds.js";
import { treeCpuPatchCrossfadeEnabled } from "./tree_system_gpu_policy.js";
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
  terrainOcclusionSampler?: TreeTerrainOcclusionSampler;
  earlyTerrainRejectionStats?: TreeEarlyTerrainRejectionStats;
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
const TREE_CPU_SCALE = new THREE.Vector3();
const TREE_CPU_ROTATION = new THREE.Quaternion();
const TREE_CPU_TRANSLATION = new THREE.Vector3();
const TREE_CPU_UP_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_UNBOUNDED_TREE_PATCH_M = 64;

export function createTreeLodCounts(): TreeLodCounts {
  return { near: 0, mid: 0, far: 0, impostor: 0 };
}

export function resetTreeLodCounts(lodCounts: TreeLodCounts): void {
  lodCounts.near = 0;
  lodCounts.mid = 0;
  lodCounts.far = 0;
  lodCounts.impostor = 0;
}

export function refreshTreePatchesForCenter(
  input: TreeCpuPatchRuntimeInput,
  center: THREE.Vector3,
  cameraPosition: THREE.Vector3 = center,
): TreePatchRefreshResult {
  resetTreeEarlyTerrainRejectionStats(input.earlyTerrainRejectionStats ?? noopEarlyTerrainRejectionStats());
  const renderRadiusM = treeLodDistances(input.settings).impostor;
  const retained = selectRetainedTreePatches(input.patches, center.x, center.z, renderRadiusM);
  const retainedNodeIds = new Set(retained.map((patch) => patch.nodeId));
  for (const patch of input.patches) {
    if (!retainedNodeIds.has(patch.nodeId)) removeTreePatchResources(input.root, patch);
  }

  const existing = new Set(retained.map((patch) => patch.nodeId));
  const finiteCandidates = selectTreePatchCandidates(input.nodes, existing, center.x, center.z, renderRadiusM);
  const unboundedWorld = treeCpuUnboundedWorld();
  const candidates = finiteCandidates.length > 0
    ? finiteCandidates
    : unboundedWorld
      ? unboundedTreePatchCandidates(center, renderRadiusM, treeFallbackPatchSize(input.nodes), existing)
      : [];
  let totalTrees = countTreePatchInstances(retained);
  let added = 0;
  let deferred = false;
  const patches = [...retained];
  for (const { node } of candidates) {
    if (totalTrees >= input.settings.maxInstances) break;
    if (added >= input.settings.maxNewPatchesPerFrame) { deferred = true; break; }
    const rejection = unboundedWorld
      ? { reject: false, reason: "accepted" as const, skippedCandidateEstimate: 0 }
      : rejectTreePatchBeforeGeneration({
        node,
        settings: input.settings,
        sampler: input.sampler,
        cameraPosition,
        worldCells: input.worldCells,
      });
    recordTreeEarlyTerrainRejection(input.earlyTerrainRejectionStats, rejection);
    if (rejection.reject) continue;

    const patch = createTreePatch(input, node, input.settings.maxInstances - totalTrees, unboundedWorld);
    totalTrees += patch.instances.length;
    patches.push(patch);
    input.root.add(patch.group);
    added++;
  }

  return {
    patches,
    patchesDirty: deferred,
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
  const crossfade = treeCpuPatchCrossfadeEnabled(input.settings);
  for (const patch of input.patches) {
    resetTreeMeshWriteStateForGrid(patch.meshes, write);
    patch.visible = treeDistance2d(center.x, center.z, patch.centerX, patch.centerZ) <= lodDistances.impostor + patch.radius;
    patch.terrainOccluded = patch.visible && isTreeClusterTerrainOccluded({
      sampler: input.terrainOcclusionSampler,
      settings: treeTerrainOcclusionSettings(input.settings),
      cameraX: cameraPosition.x,
      cameraY: cameraPosition.y,
      cameraZ: cameraPosition.z,
      targetX: patch.centerX,
      targetZ: patch.centerZ,
      targetGroundY: treePatchTargetGroundY(input.terrainOcclusionSampler, patch),
      targetRadiusM: patch.radius,
    });
    patch.group.visible = patch.visible && !patch.terrainOccluded;
    if (!patch.visible || patch.terrainOccluded) {
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
      const selection = selectTreeLod(distance, patch.previousLods[instanceIndex], input.settings, { allowCrossfade: crossfade });
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

function createTreePatch(input: TreeCpuPatchRuntimeInput, node: ClodPageNode, capacityLeft: number, unboundedWorld: boolean): TreePatch {
  const generationStats = emptyTreeGenerationStats();
  const instances = generateTreeInstancesForRuntimePatch(input, node.footprint, capacityLeft, generationStats, unboundedWorld);
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
    terrainOccluded: false,
    generationStats,
  };
}

function generateTreeInstancesForRuntimePatch(
  input: TreeCpuPatchRuntimeInput,
  footprint: PageFootprint,
  capacityLeft: number,
  generationStats: ReturnType<typeof emptyTreeGenerationStats>,
  unboundedWorld: boolean,
): TreeInstance[] {
  if (!unboundedWorld || (footprint.minX >= 0 && footprint.minZ >= 0)) {
    return generateTreeInstances(footprint, input.settings, capacityLeft, generationStats, input.sampler, unboundedWorld ? Number.POSITIVE_INFINITY : input.worldCells);
  }
  const shiftX = Math.max(0, 1 - footprint.minX);
  const shiftZ = Math.max(0, 1 - footprint.minZ);
  const shiftedFootprint = {
    minX: footprint.minX + shiftX,
    minZ: footprint.minZ + shiftZ,
    maxX: footprint.maxX + shiftX,
    maxZ: footprint.maxZ + shiftZ,
  };
  const shiftedSampler = input.sampler ? shiftedTreeSampler(input.sampler, shiftX, shiftZ) : undefined;
  return generateTreeInstances(shiftedFootprint, input.settings, capacityLeft, generationStats, shiftedSampler, Number.POSITIVE_INFINITY)
    .map((instance) => ({
      ...instance,
      position: [instance.position[0] - shiftX, instance.position[1], instance.position[2] - shiftZ],
    }));
}

function shiftedTreeSampler(sampler: TreeTerrainSampler, shiftX: number, shiftZ: number): TreeTerrainSampler {
  return {
    sourceRevision: sampler.sourceRevision,
    surfaceHeight: (x, z) => sampler.surfaceHeight(x - shiftX, z - shiftZ),
    surfaceNormal: (x, z) => sampler.surfaceNormal(x - shiftX, z - shiftZ),
    materialWeights: sampler.materialWeights,
  };
}

export function unboundedTreePatchCandidates(
  center: THREE.Vector3,
  distanceM: number,
  patchSizeM: number,
  existingNodeIds: ReadonlySet<string> = new Set(),
): TreePatchCandidate[] {
  const size = Number.isFinite(patchSizeM) && patchSizeM > 0 ? patchSizeM : DEFAULT_UNBOUNDED_TREE_PATCH_M;
  const radius = Math.max(0, Number.isFinite(distanceM) ? distanceM : 0);
  const minX = Math.floor((center.x - radius) / size);
  const maxX = Math.floor((center.x + radius) / size);
  const minZ = Math.floor((center.z - radius) / size);
  const maxZ = Math.floor((center.z + radius) / size);
  const candidates: TreePatchCandidate[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const id = `tree-unbounded:${x},${z}`;
      if (existingNodeIds.has(id)) continue;
      const footprint = { minX: x * size, minZ: z * size, maxX: (x + 1) * size, maxZ: (z + 1) * size };
      const distance = treeDistance2d(center.x, center.z, treeFootprintCenterX(footprint), treeFootprintCenterZ(footprint));
      if (distance > radius + treeFootprintRadius(footprint)) continue;
      candidates.push({ node: syntheticTreeNode(id, footprint), distance });
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}

function syntheticTreeNode(id: string, footprint: PageFootprint): ClodPageNode {
  return {
    id,
    level: 0,
    children: [],
    mesh: {
      positions: new Float32Array(),
      normals: new Float32Array(),
      paintSlots: new Float32Array(),
      materialWeights: new Float32Array(),
      materialWeightStride: 0,
      indices: new Uint32Array(),
    },
    footprint,
    bounds: { center: [treeFootprintCenterX(footprint), 0, treeFootprintCenterZ(footprint)], radius: treeFootprintRadius(footprint), minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function treeFallbackPatchSize(nodes: readonly ClodPageNode[]): number {
  const first = nodes[0]?.footprint;
  const size = first ? Math.max(first.maxX - first.minX, first.maxZ - first.minZ) : DEFAULT_UNBOUNDED_TREE_PATCH_M;
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_UNBOUNDED_TREE_PATCH_M;
}

function treeCpuUnboundedWorld(): boolean {
  return runtimeWorldUsesCameraRelativeCoordinates();
}

function treeTerrainOcclusionSettings(settings: TreeSettings): TreeTerrainOcclusionSettings {
  const visibility = settings.gpu.terrainVisibility;
  return {
    enabled: visibility.enabled,
    minDistanceM: visibility.minDistanceM,
    sampleCount: visibility.sampleCount,
    heightMarginM: visibility.heightMarginM,
    canopyHeightM: visibility.crownHeightM,
  };
}

function treePatchTargetGroundY(sampler: TreeTerrainOcclusionSampler | undefined, patch: TreePatch): number {
  const sampled = sampler?.sampleHeight(patch.centerX, patch.centerZ);
  if (sampled && !sampled.unknown && Number.isFinite(sampled.height)) return sampled.height;
  const instance = patch.instances[0];
  return instance ? instance.position[1] : 0;
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
  const writeIndex = treeMeshWriteCount(mesh, write);
  const resolveLod = input.resolveLod(instance.species, lod);
  const renderLod = resolveLod === lod ? lod : resolveLod;
  const effectiveMesh = patch.meshes[instance.species][renderLod];
  const effectiveIndex = effectiveMesh === mesh ? writeIndex : treeMeshWriteCount(effectiveMesh, write);
  const localX = instance.position[0] - patch.centerX;
  const localY = instance.position[1];
  const localZ = instance.position[2] - patch.centerZ;
  if (writeTreeWorldXZIfChanged(effectiveMesh, effectiveIndex, instance.position[0], instance.position[2])) markTreeMeshWorldXZChanged(effectiveMesh, write);
  if (writeTreeIdentityIfChanged(effectiveMesh, effectiveIndex, instance.identity)) markTreeMeshWorldXZChanged(effectiveMesh, write);
  if (writeTreeLodFadeIfChanged(effectiveMesh, effectiveIndex, fade)) markTreeMeshFadeChanged(effectiveMesh, write);
  if (writeTreeLodDitherRoleIfChanged(effectiveMesh, effectiveIndex, ditherRole)) markTreeMeshFadeChanged(effectiveMesh, write);
  if (writeTreeMorphologyIfChanged(effectiveMesh, effectiveIndex, instance)) markTreeMeshWorldXZChanged(effectiveMesh, write);
  if (renderLod === "impostor") {
    if (writeTreeImpostorLocalPositionScaleIfChanged(effectiveMesh, effectiveIndex, localX, localY, localZ, instance.scale)) markTreeMeshWorldXZChanged(effectiveMesh, write);
    if (writeTreeImpostorUvRectIfChanged({ mesh: effectiveMesh, index: effectiveIndex, instance, cameraPosition, settings: input.settings, impostorAtlases: input.impostorAtlases })) markTreeMeshImpostorUvChanged(effectiveMesh, write);
  }
  TREE_CPU_TRANSLATION.set(localX, localY, localZ);
  TREE_CPU_SCALE.set(instance.scale, instance.scale, instance.scale);
  TREE_CPU_ROTATION.setFromAxisAngle(TREE_CPU_UP_AXIS, instance.rotationY);
  TREE_CPU_MATRIX.compose(TREE_CPU_TRANSLATION, TREE_CPU_ROTATION, TREE_CPU_SCALE);
  if (setTreeInstanceMatrixWhenChanged(effectiveMesh, effectiveIndex, TREE_CPU_MATRIX)) markTreeMeshMatrixChanged(effectiveMesh, write);
  incrementTreeMeshWriteCount(effectiveMesh, write);
}

function noopEarlyTerrainRejectionStats(): TreeEarlyTerrainRejectionStats {
  return {
    testedPatches: 0,
    rejectedPatches: 0,
    acceptedPatches: 0,
    unknownKeptPatches: 0,
    skippedCandidateEstimate: 0,
    cacheHits: 0,
    cacheMisses: 0,
    reasonCounts: {
      accepted: 0,
      visible: 0,
      terrain_hidden: 0,
      unknown_kept: 0,
      near_forced_visible: 0,
      disabled: 0,
      missing_sampler: 0,
      below_water: 0,
      wrong_biome: 0,
      too_steep: 0,
      height_range: 0,
      outside_world: 0,
      not_tested: 0,
    },
  };
}
