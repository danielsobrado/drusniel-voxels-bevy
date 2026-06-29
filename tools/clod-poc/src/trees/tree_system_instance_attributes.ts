import * as THREE from "three";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { octFrameIndexForDirection } from "./tree_impostor_octahedral.js";

export const TREE_INSTANCE_ATTRIBUTE_EPSILON = 1e-5;
export const TREE_LOD_DITHER_PRIMARY = 0;
export const TREE_LOD_DITHER_SECONDARY = 1;
export type TreeLodDitherRole = typeof TREE_LOD_DITHER_PRIMARY | typeof TREE_LOD_DITHER_SECONDARY;

export interface TreeImpostorUvWriteInput {
  mesh: THREE.InstancedMesh;
  index: number;
  instance: TreeInstance;
  cameraPosition: THREE.Vector3;
  settings: TreeSettings;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
}

export function writeTreeWorldXZIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  z: number,
): boolean {
  const attribute = treeWorldXZAttribute(mesh);
  const array = attribute.array as Float32Array;
  const offset = index * 2;
  if (
    Math.abs(array[offset] - x) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 1] - z) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  array[offset] = x;
  array[offset + 1] = z;
  return true;
}

export function writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
  const attribute = treeLodFadeAttribute(mesh);
  const array = attribute.array as Float32Array;
  if (Math.abs(array[index] - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  array[index] = fade;
  return true;
}

export function writeTreeLodDitherRoleIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  role: TreeLodDitherRole,
): boolean {
  const attribute = treeLodDitherRoleAttribute(mesh);
  const array = attribute.array as Float32Array;
  if (Math.abs(array[index] - role) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  array[index] = role;
  return true;
}

export function writeTreeImpostorUvRectIfChanged(input: TreeImpostorUvWriteInput): boolean {
  const attribute = treeImpostorUvRectAttribute(input.mesh);
  const atlas = input.impostorAtlases[input.instance.species];
  if (!atlas?.ready || atlas.frames.length === 0) return writeUvRectIfChanged(attribute, input.index, 0, 0, 1, 1);

  const maxFrame = atlas.frames.length - 1;
  const frozen = input.settings.impostors.debugFreezeFrame;
  const frameIndex = frozen >= 0
    ? Math.min(maxFrame, frozen)
    : octFrameIndexForDirection(
      new THREE.Vector3(
        input.cameraPosition.x - input.instance.position[0],
        input.cameraPosition.y - input.instance.position[1],
        input.cameraPosition.z - input.instance.position[2],
      ),
      atlas.gridSize,
    );
  const frame = atlas.frames[frameIndex] ?? atlas.frames[0];
  return writeUvRectIfChanged(attribute, input.index, frame.uvMin[0], frame.uvMin[1], frame.uvMax[0], frame.uvMax[1]);
}

export function writeUvRectIfChanged(
  attribute: THREE.InstancedBufferAttribute,
  index: number,
  minU: number,
  minV: number,
  maxU: number,
  maxV: number,
): boolean {
  const array = attribute.array as Float32Array;
  const offset = index * 4;
  if (
    Math.abs(array[offset] - minU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 1] - minV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 2] - maxU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 3] - maxV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  array[offset] = minU;
  array[offset + 1] = minV;
  array[offset + 2] = maxU;
  array[offset + 3] = maxV;
  return true;
}

export function treeWorldXZAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute("treeWorldXZ") as THREE.InstancedBufferAttribute;
}

export function treeLodFadeAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute("treeLodFade") as THREE.InstancedBufferAttribute;
}

export function treeLodDitherRoleAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute("treeLodDitherRole") as THREE.InstancedBufferAttribute;
}

export function treeImpostorUvRectAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute("treeImpostorUvRect") as THREE.InstancedBufferAttribute;
}
