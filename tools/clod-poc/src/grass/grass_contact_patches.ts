import { load } from "js-yaml";
import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import {
  cameraPosition,
  float,
  max,
  mix,
  smoothstep,
  storage,
  uniform,
  vec2,
} from "three/tsl";
import configText from "../../config/grass_contact.yaml?raw";

export const GRASS_CONTACT_PATCH_CAPACITY = 32;

export interface GrassContactSettings {
  readonly enabled: boolean;
  readonly maxPatches: number;
  readonly innerRadiusScale: number;
  readonly outerRadiusScale: number;
  readonly minHeightScale: number;
  readonly flattenStrength: number;
  readonly splayStrengthM: number;
  readonly dirtTintStrength: number;
  readonly dirtColor: readonly [number, number, number];
}

export interface GrassContactPatchGpuBackend {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface GrassContactPatchGpuResources {
  readonly attribute: StorageBufferAttribute;
  readonly buffer: GPUBuffer;
  readonly capacity: number;
}

export interface GrassContactInfluenceNodes {
  readonly suppress: TslNode;
  readonly trample: TslNode;
  readonly flatten: TslNode;
  readonly dirt: TslNode;
  readonly splay: TslNode;
}

export interface GrassContactInteractionNodes {
  readonly minHeightScale: TslNode;
  readonly flattenStrength: TslNode;
  readonly splayStrengthM: TslNode;
  readonly dirtTintStrength: TslNode;
  readonly dirtColor: TslNode;
}

type TslNode = any;
type RawObject = Record<string, unknown>;

const DEFAULT_SETTINGS: GrassContactSettings = {
  enabled: true,
  maxPatches: GRASS_CONTACT_PATCH_CAPACITY,
  innerRadiusScale: 0.9,
  outerRadiusScale: 1.65,
  minHeightScale: 0.08,
  flattenStrength: 0.72,
  splayStrengthM: 0.38,
  dirtTintStrength: 0.74,
  dirtColor: [0.16, 0.11, 0.065],
};

const settings = parseGrassContactSettings(configText);
const patchAttribute = new StorageBufferAttribute(GRASS_CONTACT_PATCH_CAPACITY, 4);
const initializedBackends = new WeakSet<object>();

patchAttribute.name = "grass-stone-contact-patches";

const uEnabled = uniform(settings.enabled ? 1 : 0);
const uMinHeightScale = uniform(settings.minHeightScale);
const uFlattenStrength = uniform(settings.flattenStrength);
const uSplayStrengthM = uniform(settings.splayStrengthM);
const uDirtTintStrength = uniform(settings.dirtTintStrength);
const uDirtColor = uniform(new THREE.Vector3(...settings.dirtColor));

export function parseGrassContactSettings(text: string): GrassContactSettings {
  const root = objectFrom(load(text));
  const raw = objectFrom(root.grass_contact);
  const innerRadiusScale = readNonNegative(raw.inner_radius_scale, DEFAULT_SETTINGS.innerRadiusScale);
  const outerRadiusScale = Math.max(
    innerRadiusScale + 0.01,
    readNonNegative(raw.outer_radius_scale, DEFAULT_SETTINGS.outerRadiusScale),
  );

  return {
    enabled: readBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
    maxPatches: Math.min(
      GRASS_CONTACT_PATCH_CAPACITY,
      Math.max(0, Math.floor(readNonNegative(raw.max_patches, DEFAULT_SETTINGS.maxPatches))),
    ),
    innerRadiusScale,
    outerRadiusScale,
    minHeightScale: readFraction(raw.min_height_scale, DEFAULT_SETTINGS.minHeightScale),
    flattenStrength: readFraction(raw.flatten_strength, DEFAULT_SETTINGS.flattenStrength),
    splayStrengthM: readNonNegative(raw.splay_strength_m, DEFAULT_SETTINGS.splayStrengthM),
    dirtTintStrength: readFraction(raw.dirt_tint_strength, DEFAULT_SETTINGS.dirtTintStrength),
    dirtColor: readLinearColor(raw.dirt_color, DEFAULT_SETTINGS.dirtColor),
  };
}

export function readGrassContactSettings(): GrassContactSettings {
  return {
    ...settings,
    dirtColor: [...settings.dirtColor],
  };
}

export function grassContactPatchAttribute(): StorageBufferAttribute {
  return patchAttribute;
}

export function ensureGrassContactPatchGpuResources(
  backend: GrassContactPatchGpuBackend,
): GrassContactPatchGpuResources {
  if (!initializedBackends.has(backend)) {
    backend.createStorageAttribute(patchAttribute);
    initializedBackends.add(backend);
  }
  const buffer = backend.get(patchAttribute).buffer;
  if (!buffer) throw new Error("Missing GPU buffer for grass-stone contact patches");
  return { attribute: patchAttribute, buffer, capacity: GRASS_CONTACT_PATCH_CAPACITY };
}

export function grassContactPatchInfluence(worldXZ: TslNode): GrassContactInfluenceNodes {
  const patches: TslNode = storage(patchAttribute, "vec4", GRASS_CONTACT_PATCH_CAPACITY).toReadOnly();
  let suppress: TslNode = float(0);
  let trample: TslNode = float(0);
  let dirt: TslNode = float(0);
  let splaySum: TslNode = vec2(0);

  for (let index = 0; index < GRASS_CONTACT_PATCH_CAPACITY; index++) {
    const patch: TslNode = patches.element(index);
    const active: TslNode = smoothstep(0.0001, 0.001, patch.w).mul(uEnabled);
    const delta: TslNode = worldXZ.sub(patch.xy);
    const distance: TslNode = delta.length();
    const inner: TslNode = max(patch.z, 0.001);
    const outer: TslNode = max(patch.w, inner.add(0.001));
    const core: TslNode = float(1).sub(smoothstep(0.0, inner, distance)).mul(active);
    const contact: TslNode = float(1).sub(smoothstep(inner, outer, distance)).mul(active);
    const influence: TslNode = max(core, contact);
    const direction: TslNode = delta.div(max(distance, 0.001));

    suppress = max(suppress, core);
    trample = max(trample, influence);
    dirt = max(dirt, influence);
    splaySum = splaySum.add(direction.mul(influence.mul(float(1).sub(core.mul(0.65)))));
  }

  const splayLength: TslNode = splaySum.length();
  const splay: TslNode = splaySum.div(max(splayLength, 0.001));
  return { suppress, trample, flatten: max(suppress, trample), dirt, splay };
}

export function grassContactInteractionNodes(): GrassContactInteractionNodes {
  return {
    minHeightScale: uMinHeightScale,
    flattenStrength: uFlattenStrength,
    splayStrengthM: uSplayStrengthM,
    dirtTintStrength: uDirtTintStrength,
    dirtColor: uDirtColor,
  };
}

export function applyGrassContactTerrainTint(color: TslNode, worldXZ: TslNode): TslNode {
  const contact = grassContactPatchInfluence(worldXZ);
  const cameraDistance: TslNode = worldXZ.sub(cameraPosition.xz).length();
  const nearFade: TslNode = float(1).sub(smoothstep(72.0, 112.0, cameraDistance));
  const influence: TslNode = contact.dirt.mul(uDirtTintStrength).mul(nearFade);
  return mix(color, uDirtColor, influence);
}

export function resolveGrassContactRadii(stoneRadiusM: number): { innerRadiusM: number; outerRadiusM: number } {
  const radius = Number.isFinite(stoneRadiusM) ? Math.max(0, stoneRadiusM) : 0;
  const innerRadiusM = radius * settings.innerRadiusScale;
  return {
    innerRadiusM,
    outerRadiusM: Math.max(innerRadiusM, radius * settings.outerRadiusScale),
  };
}

function objectFrom(value: unknown): RawObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawObject : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readFraction(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(1, readNonNegative(value, fallback)));
}

function readLinearColor(
  value: unknown,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const channels = value.map((channel) => readNonNegative(channel, Number.NaN));
  if (channels.some((channel) => !Number.isFinite(channel))) return fallback;
  return [channels[0]!, channels[1]!, channels[2]!];
}
