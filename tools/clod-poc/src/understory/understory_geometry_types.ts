import * as THREE from "three";
import type { UnderstoryClass } from "./understory_config.js";

export interface LeafShape {
  len: number;
  width: number;
  shapePow: number;
  fold: number;
  curl: number;
}

export interface NeedleShape {
  len: number;
  width: number;
  needleCount: number;
  brush: number;
}

export interface Rng {
  float(): number;
  int(count: number): number;
}

export const GREEN_DARK = new THREE.Color(0x2f5f35);
export const GREEN_LIGHT = new THREE.Color(0x6f9f49);
export const FERN_GREEN = new THREE.Color(0x3c7a3f);
export const FLOWER_STEM = new THREE.Color(0x3d6c35);
export const FLOWER_PINK = new THREE.Color(0xdb7fa7);
export const FLOWER_CENTER = new THREE.Color(0xffe06b);
export const BARK = new THREE.Color(0x6a4932);
export const BARK_DARK = new THREE.Color(0x3f2a1e);
export const DEAD_WOOD = new THREE.Color(0x80694e);

export const CLASS_SALT: Record<UnderstoryClass, number> = {
  shrub: 101,
  fern: 211,
  sapling: 307,
  flower: 401,
  dead_log: 509,
  stump: 601,
};

export const SHRUB_LEAF: LeafShape = { len: 0.14, width: 0.085, shapePow: 1.2, fold: 0.3, curl: 0.25 };
export const SAPLING_LEAF: LeafShape = { len: 0.12, width: 0.07, shapePow: 1.2, fold: 0.28, curl: 0.2 };
export const FERN_NEEDLE: NeedleShape = { len: 0.065, width: 0.03, needleCount: 9, brush: 0 };

export const _p = new THREE.Vector3();
export const _n = new THREE.Vector3();
export const AXIS_Y = new THREE.Vector3(0, 1, 0);
export const AXIS_Z = new THREE.Vector3(0, 0, 1);
