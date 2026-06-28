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
}

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
  const normal = rotateNormalY(captureNormal, lighting.yawRadians).normalize();
  const sun = Math.max(0, normal.dot(lighting.sunDirection.clone().normalize()));
  const sky = clamp01(normal.y * 0.5 + 0.5);
  const hemi = lighting.groundLight.clone().lerp(lighting.skyLight, sky);
  const direct = lighting.sunColor.clone().multiplyScalar(sun);
  const rgb = new THREE.Color(albedo.x, albedo.y, albedo.z)
    .multiply(hemi.add(direct).addScalar(0.25));
  return [clamp01(rgb.r), clamp01(rgb.g), clamp01(rgb.b), coverage * sample.weight];
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
