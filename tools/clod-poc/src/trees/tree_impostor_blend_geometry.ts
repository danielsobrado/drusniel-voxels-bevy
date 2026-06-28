import * as THREE from "three";
import {
  TREE_IMPOSTOR_BLEND_SAMPLE_COUNT,
  TREE_IMPOSTOR_UV_RECT_STRIDE,
  type TreeImpostorBlendAttributes,
} from "./tree_impostor_runtime.js";

export const TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES = [
  "treeImpostorUvRect0",
  "treeImpostorUvRect1",
  "treeImpostorUvRect2",
  "treeImpostorUvRect3",
] as const;
export const TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME = "treeImpostorBlendWeights";

export function createTreeImpostorBlendGeometry(
  source: THREE.BufferGeometry,
  attributes: TreeImpostorBlendAttributes,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.name = source.name ? `${source.name}-impostor-blend` : "tree-impostor-blend";
  geometry.index = source.index?.clone() ?? null;
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute.clone());
  }
  if (source.boundingBox) geometry.boundingBox = source.boundingBox.clone();
  if (source.boundingSphere) geometry.boundingSphere = source.boundingSphere.clone();
  attachTreeImpostorBlendAttributes(geometry, attributes);
  return geometry;
}

export function attachTreeImpostorBlendAttributes(
  geometry: THREE.InstancedBufferGeometry,
  attributes: TreeImpostorBlendAttributes,
): void {
  const instanceCount = attributes.weights.length / TREE_IMPOSTOR_BLEND_SAMPLE_COUNT;
  if (!Number.isInteger(instanceCount)) {
    throw new Error("tree impostor blend weights must contain four weights per instance");
  }
  if (attributes.uvRects.length !== instanceCount * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT * TREE_IMPOSTOR_UV_RECT_STRIDE) {
    throw new Error("tree impostor blend UV rects must contain four vec4 rects per instance");
  }

  for (let sample = 0; sample < TREE_IMPOSTOR_BLEND_SAMPLE_COUNT; sample++) {
    const rects = new Float32Array(instanceCount * TREE_IMPOSTOR_UV_RECT_STRIDE);
    for (let instance = 0; instance < instanceCount; instance++) {
      const sourceOffset = (instance * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT + sample) * TREE_IMPOSTOR_UV_RECT_STRIDE;
      const targetOffset = instance * TREE_IMPOSTOR_UV_RECT_STRIDE;
      rects[targetOffset] = attributes.uvRects[sourceOffset];
      rects[targetOffset + 1] = attributes.uvRects[sourceOffset + 1];
      rects[targetOffset + 2] = attributes.uvRects[sourceOffset + 2];
      rects[targetOffset + 3] = attributes.uvRects[sourceOffset + 3];
    }
    geometry.setAttribute(
      TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES[sample],
      new THREE.InstancedBufferAttribute(rects, TREE_IMPOSTOR_UV_RECT_STRIDE),
    );
  }

  geometry.setAttribute(
    TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
    new THREE.InstancedBufferAttribute(attributes.weights, TREE_IMPOSTOR_BLEND_SAMPLE_COUNT),
  );
}
