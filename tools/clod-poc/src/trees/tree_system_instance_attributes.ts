import * as THREE from "three";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { octFrameIndexForDirection } from "./tree_impostor_octahedral.js";
import {
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
} from "./tree_impostor_blend_geometry.js";
import {
  TREE_IMPOSTOR_BLEND_SAMPLE_COUNT,
  treeImpostorRuntimeBlend,
  type TreeImpostorRuntimeSample,
} from "./tree_impostor_runtime.js";

export const TREE_INSTANCE_ATTRIBUTE_EPSILON = 1e-5;
export const TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME = "treeImpostorLocalPositionScale";
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

export function writeTreeImpostorLocalPositionScaleIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  localX: number,
  localY: number,
  localZ: number,
  scale: number,
): boolean {
  const attribute = treeImpostorLocalPositionScaleAttribute(mesh);
  const array = attribute.array as Float32Array;
  const offset = index * 4;
  if (
    Math.abs(array[offset] - localX) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 1] - localY) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 2] - localZ) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(array[offset + 3] - scale) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  array[offset] = localX;
  array[offset + 1] = localY;
  array[offset + 2] = localZ;
  array[offset + 3] = scale;
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
  if (!atlas?.ready || atlas.frames.length === 0) {
    const singleChanged = writeUvRectIfChanged(attribute, input.index, 0, 0, 1, 1);
    const blendChanged = writeTreeImpostorBlendIfChanged(input.mesh, input.index, fallbackTreeImpostorRuntimeSamples());
    return singleChanged || blendChanged;
  }

  const maxFrame = atlas.frames.length - 1;
  const frozen = input.settings.impostors.debugFreezeFrame;
  const viewDirection = treeImpostorViewDirection(input.instance, input.cameraPosition);
  const frameIndex = frozen >= 0
    ? Math.min(maxFrame, frozen)
    : octFrameIndexForDirection(viewDirection, atlas.gridSize);
  const frame = atlas.frames[frameIndex] ?? atlas.frames[0];
  const singleChanged = writeUvRectIfChanged(attribute, input.index, frame.uvMin[0], frame.uvMin[1], frame.uvMax[0], frame.uvMax[1]);
  const blendSamples = frozen >= 0
    ? frozenTreeImpostorRuntimeSamples(frame)
    : treeImpostorRuntimeBlend(atlas, viewDirection).samples;
  const blendChanged = writeTreeImpostorBlendIfChanged(input.mesh, input.index, blendSamples);
  return singleChanged || blendChanged;
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

export function treeImpostorLocalPositionScaleAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME) as THREE.InstancedBufferAttribute;
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

function writeTreeImpostorBlendIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  samples: readonly TreeImpostorRuntimeSample[],
): boolean {
  const weights = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME) as THREE.InstancedBufferAttribute | undefined;
  if (!weights) return false;
  let changed = false;
  for (let sampleIndex = 0; sampleIndex < TREE_IMPOSTOR_BLEND_SAMPLE_COUNT; sampleIndex++) {
    const uvRect = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES[sampleIndex]) as THREE.InstancedBufferAttribute | undefined;
    const sample = samples[sampleIndex] ?? fallbackTreeImpostorRuntimeSamples()[sampleIndex];
    if (uvRect) {
      changed = writeUvRectIfChanged(
        uvRect,
        index,
        sample.uvMin[0],
        sample.uvMin[1],
        sample.uvMax[0],
        sample.uvMax[1],
      ) || changed;
    }
    changed = writeBlendWeightIfChanged(weights, index, sampleIndex, sample.weight) || changed;
  }
  return changed;
}

function writeBlendWeightIfChanged(
  attribute: THREE.InstancedBufferAttribute,
  index: number,
  sampleIndex: number,
  weight: number,
): boolean {
  const array = attribute.array as Float32Array;
  const offset = index * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT + sampleIndex;
  if (Math.abs(array[offset] - weight) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  array[offset] = weight;
  return true;
}

function treeImpostorViewDirection(instance: TreeInstance, cameraPosition: THREE.Vector3): THREE.Vector3 {
  const worldDirection = new THREE.Vector3(
    cameraPosition.x - instance.position[0],
    cameraPosition.y - instance.position[1],
    cameraPosition.z - instance.position[2],
  );
  return rotateTreeImpostorDirectionByYaw(worldDirection, instance.rotationY);
}

function rotateTreeImpostorDirectionByYaw(direction: THREE.Vector3, yawRadians: number): THREE.Vector3 {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return new THREE.Vector3(
    direction.x * cos - direction.z * sin,
    direction.y,
    direction.x * sin + direction.z * cos,
  );
}

function frozenTreeImpostorRuntimeSamples(frame: TreeImpostorAtlas["frames"][number]): TreeImpostorRuntimeSample[] {
  return [
    { uvMin: [...frame.uvMin], uvMax: [...frame.uvMax], weight: 1 },
    { uvMin: [...frame.uvMin], uvMax: [...frame.uvMax], weight: 0 },
    { uvMin: [...frame.uvMin], uvMax: [...frame.uvMax], weight: 0 },
    { uvMin: [...frame.uvMin], uvMax: [...frame.uvMax], weight: 0 },
  ];
}

function fallbackTreeImpostorRuntimeSamples(): TreeImpostorRuntimeSample[] {
  return [
    { uvMin: [0, 0], uvMax: [1, 1], weight: 1 },
    { uvMin: [0, 0], uvMax: [1, 1], weight: 0 },
    { uvMin: [0, 0], uvMax: [1, 1], weight: 0 },
    { uvMin: [0, 0], uvMax: [1, 1], weight: 0 },
  ];
}
