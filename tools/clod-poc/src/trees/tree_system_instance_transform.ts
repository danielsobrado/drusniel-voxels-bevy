import * as THREE from "three";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";

const TREE_UP_AXIS = new THREE.Vector3(0, 1, 0);

export interface TreeInstanceTransformInput {
  instance: TreeInstance;
  lod: TreeLod;
  cameraPosition: THREE.Vector3;
  settings: TreeSettings;
}

export function treeInstanceRotationY(input: TreeInstanceTransformInput): number {
  if (input.lod === "impostor" && input.settings.impostors.axialBillboard) {
    return Math.atan2(
      input.cameraPosition.x - input.instance.position[0],
      input.cameraPosition.z - input.instance.position[2],
    );
  }
  return input.instance.rotationY;
}

export function composeTreeInstanceMatrix(
  input: TreeInstanceTransformInput,
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  return target.compose(
    new THREE.Vector3(input.instance.position[0], input.instance.position[1], input.instance.position[2]),
    new THREE.Quaternion().setFromAxisAngle(TREE_UP_AXIS, treeInstanceRotationY(input)),
    new THREE.Vector3(input.instance.scale, input.instance.scale, input.instance.scale),
  );
}
