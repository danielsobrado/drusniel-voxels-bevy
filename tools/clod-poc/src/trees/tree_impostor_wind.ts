import * as THREE from "three";
import {
  clamp,
  cos,
  dot,
  float,
  fract,
  mix,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { TreeSettings } from "./tree_config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export const TREE_WIND_HASH_X = 127.1;
export const TREE_WIND_HASH_Z = 311.7;
export const TREE_WIND_HASH_SCALE = 43758.5453123;
export const TREE_WIND_PHASE_TAU = 6.2831853;
export const TREE_WIND_PROPAGATION = 0.035;
export const TREE_WIND_GUST_TIME_SCALE = 0.37;
export const TREE_WIND_GUST_PHASE_SCALE = 12.9898;
export const TREE_IMPOSTOR_WIND_HEIGHT_POWER = 2;

export interface TreeImpostorWindUniforms {
  readonly time: TslNode;
  readonly direction: TslNode;
  readonly strength: TslNode;
  readonly speed: TslNode;
  readonly gustStrength: TslNode;
  readonly trunkSwayStrength: TslNode;
}

export interface TreeImpostorWindNodeInput {
  readonly worldXZ: TslNode;
  readonly height01: TslNode;
  readonly instanceScale: TslNode;
  readonly yaw: TslNode;
  readonly age01: TslNode;
  readonly stiffness: TslNode;
}

export interface TreeImpostorWindSampleInput {
  readonly x: number;
  readonly z: number;
  readonly height01: number;
  readonly instanceScale: number;
  readonly yaw: number;
  readonly age01: number;
  readonly stiffness: number;
  readonly timeSeconds: number;
  readonly settings: TreeSettings["wind"];
}

export function createTreeImpostorWindUniforms(settings: TreeSettings): TreeImpostorWindUniforms {
  const uniforms: TreeImpostorWindUniforms = {
    time: uniform(0),
    direction: uniform(new THREE.Vector2(1, 0)),
    strength: uniform(0),
    speed: uniform(0),
    gustStrength: uniform(0),
    trunkSwayStrength: uniform(0),
  };
  updateTreeImpostorWindUniforms(uniforms, settings);
  return uniforms;
}

export function updateTreeImpostorWindUniforms(
  uniforms: TreeImpostorWindUniforms,
  settings: TreeSettings,
): void {
  const direction = normalizedWindDirection(settings.wind.direction);
  uniforms.direction.value.copy(direction);
  const enabled = settings.wind.enabled ? 1 : 0;
  uniforms.strength.value = settings.wind.strength * enabled;
  uniforms.speed.value = settings.wind.speed;
  uniforms.gustStrength.value = settings.wind.gustStrength * enabled;
  uniforms.trunkSwayStrength.value = settings.wind.trunkSwayStrength * enabled;
}

export function treeImpostorWindActive(settings: TreeSettings): boolean {
  return settings.wind.enabled
    && Math.abs(settings.wind.trunkSwayStrength) > 1e-8
    && (Math.abs(settings.wind.strength) > 1e-8 || Math.abs(settings.wind.gustStrength) > 1e-8);
}

export function treeImpostorWindDisplacementNode(
  uniforms: TreeImpostorWindUniforms,
  input: TreeImpostorWindNodeInput,
): TslNode {
  const phase: TslNode = fract(
    sin(dot(input.worldXZ, vec2(TREE_WIND_HASH_X, TREE_WIND_HASH_Z))).mul(TREE_WIND_HASH_SCALE),
  );
  const time: TslNode = uniforms.time.mul(uniforms.speed);
  const waveArgument: TslNode = time
    .add(phase.mul(TREE_WIND_PHASE_TAU))
    .add(dot(input.worldXZ, uniforms.direction).mul(TREE_WIND_PROPAGATION));
  const wave: TslNode = sin(waveArgument).mul(uniforms.strength);
  const gust: TslNode = sin(
    time.mul(TREE_WIND_GUST_TIME_SCALE).add(phase.mul(TREE_WIND_GUST_PHASE_SCALE)),
  ).mul(uniforms.gustStrength);
  const heightWeight: TslNode = smoothstep(0, 1, clamp(input.height01, 0, 1));
  const anchoredWeight: TslNode = heightWeight.mul(heightWeight);
  const windScale: TslNode = float(1)
    .div(clamp(input.stiffness, 0.65, 1.35))
    .mul(mix(0.85, 1.10, clamp(input.age01, 0, 1)));
  const displacement: TslNode = wave.add(gust)
    .mul(anchoredWeight)
    .mul(uniforms.trunkSwayStrength)
    .mul(windScale)
    .mul(input.instanceScale);
  const localX: TslNode = uniforms.direction.x.mul(displacement);
  const localZ: TslNode = uniforms.direction.y.mul(displacement);
  const yawCos: TslNode = cos(input.yaw);
  const yawSin: TslNode = sin(input.yaw);
  return vec3(
    yawCos.mul(localX).add(yawSin.mul(localZ)),
    float(0),
    yawSin.mul(localX).negate().add(yawCos.mul(localZ)),
  );
}

export function sampleTreeImpostorWindDisplacement(input: TreeImpostorWindSampleInput): [number, number] {
  const direction = normalizedWindDirection(input.settings.direction);
  if (!input.settings.enabled) return [0, 0];
  const phase = treeWindPhase(input.x, input.z);
  const time = finiteOr(input.timeSeconds, 0) * finiteOr(input.settings.speed, 0);
  const waveArgument = time
    + phase * TREE_WIND_PHASE_TAU
    + (finiteOr(input.x, 0) * direction.x + finiteOr(input.z, 0) * direction.y) * TREE_WIND_PROPAGATION;
  const wave = Math.sin(waveArgument) * finiteOr(input.settings.strength, 0);
  const gust = Math.sin(time * TREE_WIND_GUST_TIME_SCALE + phase * TREE_WIND_GUST_PHASE_SCALE)
    * finiteOr(input.settings.gustStrength, 0);
  const heightWeight = smoothstep01(clamp01(input.height01));
  const anchoredWeight = heightWeight ** TREE_IMPOSTOR_WIND_HEIGHT_POWER;
  const stiffness = clampNumber(finiteOr(input.stiffness, 1), 0.65, 1.35);
  const windScale = 1 / stiffness * lerp(0.85, 1.10, clamp01(input.age01));
  const displacement = (wave + gust)
    * anchoredWeight
    * finiteOr(input.settings.trunkSwayStrength, 0)
    * windScale
    * Math.max(0, finiteOr(input.instanceScale, 1));
  const localX = direction.x * displacement;
  const localZ = direction.y * displacement;
  const yaw = finiteOr(input.yaw, 0);
  const yawCos = Math.cos(yaw);
  const yawSin = Math.sin(yaw);
  return [
    yawCos * localX + yawSin * localZ,
    -yawSin * localX + yawCos * localZ,
  ];
}

export function treeWindPhase(x: number, z: number): number {
  const value = Math.sin(finiteOr(x, 0) * TREE_WIND_HASH_X + finiteOr(z, 0) * TREE_WIND_HASH_Z)
    * TREE_WIND_HASH_SCALE;
  return value - Math.floor(value);
}

function normalizedWindDirection(direction: readonly [number, number]): THREE.Vector2 {
  const value = new THREE.Vector2(finiteOr(direction[0], 1), finiteOr(direction[1], 0));
  if (value.lengthSq() <= 1e-8) value.set(1, 0);
  else value.normalize();
  return value;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  const safe = Number.isFinite(value) ? value : minimum;
  return Math.max(minimum, Math.min(maximum, safe));
}

function smoothstep01(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
