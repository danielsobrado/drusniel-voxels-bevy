import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  positionWorld,
  sin,
  vec2,
  vec3,
} from "three/tsl";
import type { DressingClassId } from "./class_registry.js";
import {
  groundDebrisVisualProfile,
  type GroundDebrisVisualProfile,
} from "./gpu/ground_debris_visuals.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const WORLD_HASH_CELL_M = 0.5;
const WORLD_HASH_SCALE = 1 / WORLD_HASH_CELL_M;
const HASH_VECTOR_X = 12.9898;
const HASH_VECTOR_Z = 78.233;
const HASH_MULTIPLIER = 43_758.5453;

export function createGroundDebrisCpuNodeMaterial(
  classId: DressingClassId,
): MeshStandardNodeMaterial | null {
  const profile = groundDebrisVisualProfile(classId);
  if (!profile) return null;

  const alwaysWet = classId === "wet_stone_cluster";
  const color = alwaysWet ? profile.wetColor : profile.baseColor;
  const roughness = alwaysWet ? profile.wetRoughness : profile.dryRoughness;
  const distance: TslNode = vec2(cameraPosition.x, cameraPosition.z)
    .sub(positionWorld.xz)
    .length();
  const visibility: TslNode = clamp(
    float(profile.fadeEndM).sub(distance).div(Math.max(0.001, profile.fadeEndM - profile.fadeStartM)),
    0,
    1,
  );
  const worldCell: TslNode = floor(positionWorld.xz.mul(WORLD_HASH_SCALE));
  const noise: TslNode = fract(
    sin(dot(worldCell, vec2(HASH_VECTOR_X, HASH_VECTOR_Z))).mul(HASH_MULTIPLIER),
  );

  const material = new MeshStandardNodeMaterial();
  material.name = `ground-debris-cpu-webgpu-${classId}`;
  material.color.setRGB(1, 1, 1);
  material.colorNode = linearColorNode(color);
  material.roughnessNode = float(roughness);
  material.maskNode = noise.lessThan(visibility);
  material.metalness = 0;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.alphaTest = 0;
  material.depthWrite = true;
  return material;
}

export function groundDebrisCpuFadeVisibility(
  distanceM: number,
  profile: GroundDebrisVisualProfile,
): number {
  const distance = Number.isFinite(distanceM) ? distanceM : profile.fadeEndM;
  const span = Math.max(0.001, profile.fadeEndM - profile.fadeStartM);
  return clamp01((profile.fadeEndM - distance) / span);
}

export const GROUND_DEBRIS_CPU_WEBGPU_FADE_CELL_M = WORLD_HASH_CELL_M;

function linearColorNode(hex: number): TslNode {
  const color = new THREE.Color(hex).convertSRGBToLinear();
  return vec3(color.r, color.g, color.b);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
