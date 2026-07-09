import * as THREE from "three";
import {
  decodeTreeImpostorAlbedo,
  decodeTreeImpostorNormalComponent,
  type TreeImpostorAtlas,
} from "./tree_impostor_baker.js";
import { octFrameBlendForDirection, type OctahedralBlendSample } from "./tree_impostor_octahedral.js";

export const TREE_IMPOSTOR_BLEND_SAMPLE_COUNT = 4;
export const TREE_IMPOSTOR_UV_RECT_STRIDE = 4;

export interface TreeImpostorRuntimeSample {
  uvMin: [number, number];
  uvMax: [number, number];
  weight: number;
}

export interface TreeImpostorRuntimeBlend {
  samples: [TreeImpostorRuntimeSample, TreeImpostorRuntimeSample, TreeImpostorRuntimeSample, TreeImpostorRuntimeSample];
}

export interface TreeImpostorBlendAttributes {
  uvRects: Float32Array;
  weights: Float32Array;
}

export interface TreeImpostorPackedSample {
  albedoCoverage: [number, number, number, number];
  normalDepth: [number, number, number, number];
  weight: number;
}

export interface TreeImpostorLightingInput {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
  yawRadians: number;
  billboardNormal?: THREE.Vector3;
  normalDetailWeight?: number;
}

export interface TreeImpostorNormalBlendSample {
  normalDepth: [number, number, number, number];
  weight: number;
}

const TREE_IMPOSTOR_LIGHT_AMBIENT = 0.25;
const TREE_IMPOSTOR_LIGHT_TRANSMISSION = 0.22;
const TREE_IMPOSTOR_LIGHT_SUN_MAX = 0.85;
export const TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT = 0.65;

export function createTreeImpostorBlendAttributes(instanceCount: number): TreeImpostorBlendAttributes {
  const safeCount = Math.max(0, Math.floor(instanceCount));
  return {
    uvRects: new Float32Array(safeCount * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT * TREE_IMPOSTOR_UV_RECT_STRIDE),
    weights: new Float32Array(safeCount * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT),
  };
}

export function writeTreeImpostorBlendAttributes(
  attributes: TreeImpostorBlendAttributes,
  instanceIndex: number,
  blend: TreeImpostorRuntimeBlend,
): void {
  const index = Math.max(0, Math.floor(instanceIndex));
  const uvBase = index * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT * TREE_IMPOSTOR_UV_RECT_STRIDE;
  const weightBase = index * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT;
  for (let i = 0; i < TREE_IMPOSTOR_BLEND_SAMPLE_COUNT; i++) {
    const sample = blend.samples[i];
    const uvOffset = uvBase + i * TREE_IMPOSTOR_UV_RECT_STRIDE;
    attributes.uvRects[uvOffset] = sample.uvMin[0];
    attributes.uvRects[uvOffset + 1] = sample.uvMin[1];
    attributes.uvRects[uvOffset + 2] = sample.uvMax[0];
    attributes.uvRects[uvOffset + 3] = sample.uvMax[1];
    attributes.weights[weightBase + i] = sample.weight;
  }
}

export function treeImpostorRuntimeBlend(
  atlas: TreeImpostorAtlas,
  viewDirection: THREE.Vector3,
): TreeImpostorRuntimeBlend {
  const blend = octFrameBlendForDirection(
    viewDirection,
    atlas.gridSize,
    atlas.resolutionPx,
    inferAtlasPaddingPx(atlas),
  );
  return {
    samples: blend.samples.map(toRuntimeSample) as TreeImpostorRuntimeBlend["samples"],
  };
}

export function decodeAndLightTreeImpostorSample(
  sample: TreeImpostorPackedSample,
  lighting: TreeImpostorLightingInput,
): [number, number, number, number] {
  const albedo = new THREE.Vector3(
    decodeTreeImpostorAlbedo(sample.albedoCoverage[0]),
    decodeTreeImpostorAlbedo(sample.albedoCoverage[1]),
    decodeTreeImpostorAlbedo(sample.albedoCoverage[2]),
  );
  const coverage = clamp01(sample.albedoCoverage[3]);
  const captureNormal = new THREE.Vector3(
    decodeTreeImpostorNormalComponent(sample.normalDepth[0]),
    decodeTreeImpostorNormalComponent(sample.normalDepth[1]),
    decodeTreeImpostorNormalComponent(sample.normalDepth[2]),
  );
  const rotatedNormal = rotateNormalY(safeNormalize(captureNormal), lighting.yawRadians).normalize();
  const normal = billboardBlendedTreeImpostorNormal(rotatedNormal, lighting);
  const lightDir = lighting.sunDirection.clone().normalize();
  const sun = Math.min(Math.max(0, normal.dot(lightDir)), TREE_IMPOSTOR_LIGHT_SUN_MAX);
  const sky = clamp01(normal.y * 0.5 + 0.5);
  const hemi = colorToVector(lighting.groundLight).lerp(colorToVector(lighting.skyLight), sky);
  const direct = colorToVector(lighting.sunColor).multiplyScalar(sun);
  const transmission = albedo.clone()
    .multiply(colorToVector(lighting.sunColor))
    .multiplyScalar(Math.max(0, normal.clone().negate().dot(lightDir)) * TREE_IMPOSTOR_LIGHT_TRANSMISSION);
  const rgb = albedo.clone()
    .multiply(hemi.add(direct).addScalar(TREE_IMPOSTOR_LIGHT_AMBIENT))
    .add(transmission);
  return [clamp01(rgb.x), clamp01(rgb.y), clamp01(rgb.z), coverage * sample.weight];
}

export function blendTreeImpostorPackedNormals(
  samples: readonly TreeImpostorNormalBlendSample[],
): [number, number, number] {
  const blended = new THREE.Vector3();
  for (const sample of samples) {
    blended.addScaledVector(new THREE.Vector3(
      decodeTreeImpostorNormalComponent(sample.normalDepth[0]),
      decodeTreeImpostorNormalComponent(sample.normalDepth[1]),
      decodeTreeImpostorNormalComponent(sample.normalDepth[2]),
    ), sample.weight);
  }
  const normal = safeNormalize(blended);
  return [normal.x, normal.y, normal.z];
}

function billboardBlendedTreeImpostorNormal(
  rotatedNormal: THREE.Vector3,
  lighting: TreeImpostorLightingInput,
): THREE.Vector3 {
  if (!lighting.billboardNormal) return rotatedNormal;
  const weight = clamp01(lighting.normalDetailWeight ?? TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT);
  return safeNormalize(lighting.billboardNormal).lerp(rotatedNormal, weight).normalize();
}

function toRuntimeSample(sample: OctahedralBlendSample): TreeImpostorRuntimeSample {
  return {
    uvMin: [...sample.frame.uvMin],
    uvMax: [...sample.frame.uvMax],
    weight: sample.weight,
  };
}

function inferAtlasPaddingPx(atlas: TreeImpostorAtlas): number {
  const first = atlas.frames[0];
  if (!first) return 0;
  const atlasSize = atlas.gridSize * atlas.resolutionPx;
  return Math.max(0, Math.round(first.uvMin[0] * atlasSize));
}

function rotateNormalY(normal: THREE.Vector3, yawRadians: number): THREE.Vector3 {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return new THREE.Vector3(
    cos * normal.x + sin * normal.z,
    normal.y,
    -sin * normal.x + cos * normal.z,
  );
}

function colorToVector(color: THREE.Color): THREE.Vector3 {
  return new THREE.Vector3(color.r, color.g, color.b);
}

function safeNormalize(vector: THREE.Vector3): THREE.Vector3 {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
    return new THREE.Vector3(0, 1, 0);
  }
  if (vector.lengthSq() <= 1e-12) return new THREE.Vector3(0, 1, 0);
  return vector.clone().normalize();
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
