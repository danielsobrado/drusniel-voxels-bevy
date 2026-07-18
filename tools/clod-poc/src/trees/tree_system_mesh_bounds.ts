import * as THREE from "three";
import type { TreeLod } from "./tree_config.js";
import {
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
} from "./tree_impostor_blend_geometry.js";
import {
  treeImpostorLocalPositionScaleAttribute,
  treeImpostorYawSinCosAttribute,
  treeIdentityBitsAttribute,
  treeImpostorUvRectAttribute,
  treeLodDitherRoleAttribute,
  treeLodFadeAttribute,
  treeWorldXZAttribute,
} from "./tree_system_instance_attributes.js";
import { treeDistance2d } from "./tree_system_math.js";

export const TREE_BOUNDS_REFRESH_DISTANCE_M = 1.0;

export interface TreeMeshBoundsState {
  count: number;
  centerX: number;
  centerZ: number;
  hasBounds: boolean;
  worldMatrix?: THREE.Matrix4;
}

export interface TreeMeshLodUpdateInput {
  mesh: THREE.InstancedMesh;
  nextCount: number;
  center: THREE.Vector3;
  lod: TreeLod;
  matrixChanged: boolean;
  worldXZChanged: boolean;
  impostorUvChanged: boolean;
  fadeChanged: boolean;
  axialBillboard: boolean;
  previousState?: TreeMeshBoundsState;
  boundsRefreshDistanceM?: number;
}

export function updateTreeMeshAfterLod(input: TreeMeshLodUpdateInput): TreeMeshBoundsState {
  const refreshDistance = input.boundsRefreshDistanceM ?? TREE_BOUNDS_REFRESH_DISTANCE_M;
  const countChanged = input.mesh.count !== input.nextCount;
  input.mesh.count = input.nextCount;

  const depthTwin = input.mesh.userData.depthTwin as THREE.InstancedMesh | undefined;
  if (depthTwin) {
    depthTwin.count = input.nextCount;
    depthTwin.visible = input.nextCount > 0;
  }

  if (input.matrixChanged) input.mesh.instanceMatrix.needsUpdate = true;
  if (input.worldXZChanged) {
    treeWorldXZAttribute(input.mesh).needsUpdate = true;
    treeIdentityBitsAttribute(input.mesh).needsUpdate = true;
    for (let index = 0; index < 3; index++) {
      const morphology = input.mesh.geometry.getAttribute(`treeMorphology${index}`) as THREE.InstancedBufferAttribute | undefined;
      if (morphology) morphology.needsUpdate = true;
    }
    if (input.lod === "impostor") treeImpostorLocalPositionScaleAttribute(input.mesh).needsUpdate = true;
  }
  if (input.fadeChanged) {
    treeLodFadeAttribute(input.mesh).needsUpdate = true;
    treeLodDitherRoleAttribute(input.mesh).needsUpdate = true;
  }
  if (input.impostorUvChanged) {
    treeImpostorUvRectAttribute(input.mesh).needsUpdate = true;
    treeImpostorYawSinCosAttribute(input.mesh).needsUpdate = true;
    for (const name of TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES) {
      const attribute = input.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      if (attribute) attribute.needsUpdate = true;
    }
    const weights = input.mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME) as THREE.InstancedBufferAttribute | undefined;
    if (weights) weights.needsUpdate = true;
  }

  if (input.nextCount <= 0) {
    input.mesh.visible = false;
    return {
      count: input.nextCount,
      centerX: input.center.x,
      centerZ: input.center.z,
      hasBounds: false,
      worldMatrix: input.mesh.matrixWorld.clone(),
    };
  }

  input.mesh.visible = true;
  const billboard = input.lod === "impostor" && input.axialBillboard;
  const positionsChanged = billboard ? input.worldXZChanged : input.matrixChanged;
  const centerMoved = input.previousState
    ? treeDistance2d(input.center.x, input.center.z, input.previousState.centerX, input.previousState.centerZ) >= refreshDistance
    : true;
  if (!input.previousState?.hasBounds || countChanged || centerMoved || positionsChanged) {
    updateTreeMeshBounds(input.mesh, billboard);
    return {
      count: input.nextCount,
      centerX: input.center.x,
      centerZ: input.center.z,
      hasBounds: true,
      worldMatrix: input.mesh.matrixWorld.clone(),
    };
  }

  return input.previousState;
}

export function updateTreeMeshBounds(mesh: THREE.InstancedMesh, billboard: boolean): void {
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  if (!billboard) return;
  const margin = mesh.geometry.boundingSphere?.radius ?? 0;
  if (mesh.boundingSphere) mesh.boundingSphere.radius += margin;
  mesh.boundingBox?.expandByScalar(margin);
}
