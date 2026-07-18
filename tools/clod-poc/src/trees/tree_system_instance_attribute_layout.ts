import * as THREE from "three";
import {
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
} from "./tree_impostor_blend_geometry.js";
import {
  TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME,
  TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME,
} from "./tree_system_instance_attributes.js";

const TREE_INSTANCE_BASE_STRIDE = 16;
const TREE_INSTANCE_IMPOSTOR_STRIDE = 44;

export function attachPackedTreeInstanceAttributes(
  geometry: THREE.BufferGeometry,
  capacity: number,
  includeImpostor: boolean,
): void {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  const stride = includeImpostor ? TREE_INSTANCE_IMPOSTOR_STRIDE : TREE_INSTANCE_BASE_STRIDE;
  const values = new Float32Array(safeCapacity * stride);
  for (let index = 0; index < safeCapacity; index++) {
    values[index * stride + 2] = 1;
    if (includeImpostor) values[index * stride + 40] = 1;
  }
  const buffer = new THREE.InstancedInterleavedBuffer(values, stride, 1);
  geometry.setAttribute("treeWorldXZ", attribute(buffer, 2, 0));
  geometry.setAttribute("treeLodFade", attribute(buffer, 1, 2));
  geometry.setAttribute("treeLodDitherRole", attribute(buffer, 1, 3));
  geometry.setAttribute("treeMorphology0", attribute(buffer, 4, 4));
  geometry.setAttribute("treeMorphology1", attribute(buffer, 4, 8));
  geometry.setAttribute("treeMorphology2", attribute(buffer, 4, 12));
  geometry.setAttribute("treeIdentityBits", new THREE.InstancedBufferAttribute(new Uint32Array(safeCapacity * 2), 2));
  if (!includeImpostor) return;

  geometry.setAttribute("treeImpostorUvRect", attribute(buffer, 4, 16));
  geometry.setAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME, attribute(buffer, 4, 20));
  for (let index = 0; index < TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES.length; index++) {
    geometry.setAttribute(TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES[index], attribute(buffer, 4, 24 + index * 4));
  }
  geometry.setAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME, attribute(buffer, 4, 40));

  const yaw = new Float32Array(safeCapacity * 2);
  for (let index = 0; index < safeCapacity; index++) yaw[index * 2] = 1;
  geometry.setAttribute(TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME, new THREE.InstancedBufferAttribute(yaw, 2));
}

function attribute(
  buffer: THREE.InstancedInterleavedBuffer,
  itemSize: number,
  offset: number,
): THREE.InterleavedBufferAttribute {
  return new THREE.InterleavedBufferAttribute(buffer, itemSize, offset, false);
}
