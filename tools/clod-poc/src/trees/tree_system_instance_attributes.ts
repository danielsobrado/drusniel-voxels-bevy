import * as THREE from "three";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import { treeImpostorFramesForVariant, type TreeImpostorAtlas } from "./tree_impostor_baker.js";
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
import { packTreeInstanceMorphology } from "./morphology/packing.js";
import type { TreeIdentity } from "./morphology/types.js";

export const TREE_INSTANCE_ATTRIBUTE_EPSILON = 1e-5;
export const TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME = "treeImpostorLocalPositionScale";
export const TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME = "treeImpostorYawSinCos";
export const TREE_LOD_DITHER_PRIMARY = 0;
export const TREE_LOD_DITHER_SECONDARY = 1;
export type TreeLodDitherRole = typeof TREE_LOD_DITHER_PRIMARY | typeof TREE_LOD_DITHER_SECONDARY;
type TreeWritableAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

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
  if (
    Math.abs(attribute.getX(index) - x) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getY(index) - z) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  attribute.setXY(index, x, z);
  return true;
}

export function writeTreeIdentityIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  identity: TreeIdentity,
): boolean {
  const attribute = treeIdentityBitsAttribute(mesh);
  const array = attribute.array as Uint32Array;
  const offset = index * 2;
  const stableIdLo = identity.stableIdLo >>> 0;
  const stableIdHi = identity.stableIdHi >>> 0;
  if (array[offset] === stableIdLo && array[offset + 1] === stableIdHi) return false;
  array[offset] = stableIdLo;
  array[offset + 1] = stableIdHi;
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
  if (
    Math.abs(attribute.getX(index) - localX) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getY(index) - localY) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getZ(index) - localZ) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getW(index) - scale) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  attribute.setXYZW(index, localX, localY, localZ, scale);
  return true;
}

export function writeTreeImpostorYawSinCosIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  rotationY: number,
): boolean {
  const attribute = treeImpostorYawSinCosAttribute(mesh);
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  if (
    Math.abs(attribute.getX(index) - cosine) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getY(index) - sine) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  attribute.setXY(index, cosine, sine);
  return true;
}

export function writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
  const attribute = treeLodFadeAttribute(mesh);
  if (Math.abs(attribute.getX(index) - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  attribute.setX(index, fade);
  return true;
}

export function writeTreeLodDitherRoleIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  role: TreeLodDitherRole,
): boolean {
  const attribute = treeLodDitherRoleAttribute(mesh);
  if (Math.abs(attribute.getX(index) - role) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  attribute.setX(index, role);
  return true;
}

export function writeTreeMorphologyIfChanged(mesh: THREE.InstancedMesh, index: number, instance: TreeInstance): boolean {
  const packed = packTreeInstanceMorphology(instance.morphology);
  let changed = false;
  for (let vector = 0; vector < 3; vector++) {
    const attribute = mesh.geometry.getAttribute(`treeMorphology${vector}`) as TreeWritableAttribute | undefined;
    if (!attribute) continue;
    const sourceOffset = vector * 4;
    const x = packed[sourceOffset] ?? 0;
    const y = packed[sourceOffset + 1] ?? 0;
    const z = packed[sourceOffset + 2] ?? 0;
    const w = packed[sourceOffset + 3] ?? 0;
    if (
      Math.abs(attribute.getX(index) - x) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(attribute.getY(index) - y) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(attribute.getZ(index) - z) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
      Math.abs(attribute.getW(index) - w) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
    ) continue;
    attribute.setXYZW(index, x, y, z, w);
    changed = true;
  }
  return changed;
}

export function writeTreeImpostorUvRectIfChanged(input: TreeImpostorUvWriteInput): boolean {
  const yawChanged = writeTreeImpostorYawSinCosIfChanged(input.mesh, input.index, input.instance.rotationY);
  const attribute = treeImpostorUvRectAttribute(input.mesh);
  const atlas = input.impostorAtlases[input.instance.species];
  if (!atlas?.ready || atlas.frames.length === 0) {
    const singleChanged = writeUvRectIfChanged(attribute, input.index, 0, 0, 1, 1);
    const blendChanged = writeTreeImpostorBlendIfChanged(input.mesh, input.index, fallbackTreeImpostorRuntimeSamples());
    return yawChanged || singleChanged || blendChanged;
  }

  const frames = treeImpostorFramesForVariant(atlas, input.instance.variant);
  const maxFrame = frames.length - 1;
  const frozen = input.settings.impostors.debugFreezeFrame;
  const viewDirection = treeImpostorViewDirection(input.instance, input.cameraPosition);
  const frameIndex = frozen >= 0
    ? Math.min(maxFrame, frozen)
    : octFrameIndexForDirection(viewDirection, atlas.gridSize);
  const frame = frames[frameIndex] ?? frames[0] ?? atlas.frames[0];
  const singleChanged = writeUvRectIfChanged(attribute, input.index, frame.uvMin[0], frame.uvMin[1], frame.uvMax[0], frame.uvMax[1]);
  const blendSamples = frozen >= 0
    ? frozenTreeImpostorRuntimeSamples(frame)
    : treeImpostorRuntimeBlend(atlas, viewDirection, input.instance.variant).samples;
  const blendChanged = writeTreeImpostorBlendIfChanged(input.mesh, input.index, blendSamples);
  return yawChanged || singleChanged || blendChanged;
}

export function writeUvRectIfChanged(
  attribute: TreeWritableAttribute,
  index: number,
  minU: number,
  minV: number,
  maxU: number,
  maxV: number,
): boolean {
  if (
    Math.abs(attribute.getX(index) - minU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getY(index) - minV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getZ(index) - maxU) <= TREE_INSTANCE_ATTRIBUTE_EPSILON &&
    Math.abs(attribute.getW(index) - maxV) <= TREE_INSTANCE_ATTRIBUTE_EPSILON
  ) {
    return false;
  }
  attribute.setXYZW(index, minU, minV, maxU, maxV);
  return true;
}

export function treeWorldXZAttribute(mesh: THREE.InstancedMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute("treeWorldXZ") as unknown as THREE.BufferAttribute;
}

export function treeIdentityBitsAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute("treeIdentityBits") as THREE.InstancedBufferAttribute;
}

export function treeImpostorLocalPositionScaleAttribute(mesh: THREE.InstancedMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME) as unknown as THREE.BufferAttribute;
}

export function treeImpostorYawSinCosAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  return mesh.geometry.getAttribute(TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME) as THREE.InstancedBufferAttribute;
}

export function treeLodFadeAttribute(mesh: THREE.InstancedMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute("treeLodFade") as unknown as THREE.BufferAttribute;
}

export function treeLodDitherRoleAttribute(mesh: THREE.InstancedMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute("treeLodDitherRole") as unknown as THREE.BufferAttribute;
}

export function treeImpostorUvRectAttribute(mesh: THREE.InstancedMesh): THREE.BufferAttribute {
  return mesh.geometry.getAttribute("treeImpostorUvRect") as unknown as THREE.BufferAttribute;
}

function writeTreeImpostorBlendIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  samples: readonly TreeImpostorRuntimeSample[],
): boolean {
  const weights = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME) as TreeWritableAttribute | undefined;
  if (!weights) return false;
  let changed = false;
  for (let sampleIndex = 0; sampleIndex < TREE_IMPOSTOR_BLEND_SAMPLE_COUNT; sampleIndex++) {
    const uvRect = mesh.geometry.getAttribute(TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES[sampleIndex]) as TreeWritableAttribute | undefined;
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
    changed = writeBlendWeightIfChanged(weights, inputIndex(index), sampleIndex, sample.weight) || changed;
  }
  return changed;
}

function inputIndex(index: number): number {
  return index;
}

function writeBlendWeightIfChanged(
  attribute: TreeWritableAttribute,
  index: number,
  sampleIndex: number,
  weight: number,
): boolean {
  let x = attribute.getX(index);
  let y = attribute.getY(index);
  let z = attribute.getZ(index);
  let w = attribute.getW(index);
  const current = sampleIndex === 0 ? x : sampleIndex === 1 ? y : sampleIndex === 2 ? z : w;
  if (Math.abs(current - weight) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
  if (sampleIndex === 0) x = weight;
  else if (sampleIndex === 1) y = weight;
  else if (sampleIndex === 2) z = weight;
  else w = weight;
  attribute.setXYZW(index, x, y, z, w);
  return true;
}

const TREE_IMPOSTOR_VIEW_DIRECTION_SCRATCH = new THREE.Vector3();

function treeImpostorViewDirection(instance: TreeInstance, cameraPosition: THREE.Vector3): THREE.Vector3 {
  const dx = cameraPosition.x - instance.position[0];
  const dy = cameraPosition.y - instance.position[1];
  const dz = cameraPosition.z - instance.position[2];
  const cos = Math.cos(instance.rotationY);
  const sin = Math.sin(instance.rotationY);
  return TREE_IMPOSTOR_VIEW_DIRECTION_SCRATCH.set(
    dx * cos - dz * sin,
    dy,
    dx * sin + dz * cos,
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
