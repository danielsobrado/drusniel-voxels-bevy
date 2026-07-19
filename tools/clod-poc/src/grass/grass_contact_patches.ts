import { load } from "js-yaml";
import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  float,
  floor,
  max,
  mix,
  smoothstep,
  storage,
  uint,
  uniform,
} from "three/tsl";
import configText from "../../config/grass_contact.yaml?raw";

export const GRASS_CONTACT_PATCH_CAPACITY = 32;

export interface GrassContactSettings {
  readonly enabled: boolean;
  readonly maxPatches: number;
  readonly innerRadiusScale: number;
  readonly outerRadiusScale: number;
  readonly fieldGrid: number;
  readonly fieldCellM: number;
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
  fieldGrid: 192,
  fieldCellM: 1,
  minHeightScale: 0.08,
  flattenStrength: 0.72,
  splayStrengthM: 0.38,
  dirtTintStrength: 0.74,
  dirtColor: [0.16, 0.11, 0.065],
};

const settings: { -readonly [K in keyof GrassContactSettings]: GrassContactSettings[K] } =
  parseGrassContactSettings(configText);
export const GRASS_CONTACT_METADATA_INDEX = 0;
export const GRASS_CONTACT_PATCH_OFFSET = 1;
export const GRASS_CONTACT_FIELD_OFFSET = GRASS_CONTACT_PATCH_OFFSET + GRASS_CONTACT_PATCH_CAPACITY;
export const GRASS_CONTACT_FIELD_CAPACITY = settings.fieldGrid * settings.fieldGrid;
export const GRASS_CONTACT_STORAGE_CAPACITY = GRASS_CONTACT_FIELD_OFFSET + GRASS_CONTACT_FIELD_CAPACITY;

const fieldAttribute = new StorageBufferAttribute(GRASS_CONTACT_STORAGE_CAPACITY, 4);
const initializedBackends = new WeakSet<object>();

fieldAttribute.name = "grass-stone-contact-field";

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
    fieldGrid: Math.min(512, Math.max(16, Math.floor(readPositive(raw.field_grid, DEFAULT_SETTINGS.fieldGrid)))),
    fieldCellM: Math.max(0.1, readPositive(raw.field_cell_m, DEFAULT_SETTINGS.fieldCellM)),
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
    dirtColor: [...settings.dirtColor] as [number, number, number],
  };
}

/**
 * Live-tunable subset (GUI): updates the shared material/terrain uniforms
 * immediately; radius scales apply on the next stone rescatter. Field grid and
 * cell size are baked into buffer capacity + WGSL and cannot change here.
 */
export type GrassContactLiveSettings = Partial<Pick<GrassContactSettings,
  "enabled" | "minHeightScale" | "flattenStrength" | "splayStrengthM"
  | "dirtTintStrength" | "dirtColor" | "innerRadiusScale" | "outerRadiusScale"
>>;

export function updateGrassContactSettings(update: GrassContactLiveSettings): void {
  if (update.enabled !== undefined) {
    settings.enabled = update.enabled;
    uEnabled.value = update.enabled ? 1 : 0;
  }
  if (update.minHeightScale !== undefined) {
    settings.minHeightScale = Math.max(0, Math.min(1, update.minHeightScale));
    uMinHeightScale.value = settings.minHeightScale;
  }
  if (update.flattenStrength !== undefined) {
    settings.flattenStrength = Math.max(0, Math.min(1, update.flattenStrength));
    uFlattenStrength.value = settings.flattenStrength;
  }
  if (update.splayStrengthM !== undefined) {
    settings.splayStrengthM = Math.max(0, update.splayStrengthM);
    uSplayStrengthM.value = settings.splayStrengthM;
  }
  if (update.dirtTintStrength !== undefined) {
    settings.dirtTintStrength = Math.max(0, Math.min(1, update.dirtTintStrength));
    uDirtTintStrength.value = settings.dirtTintStrength;
  }
  if (update.dirtColor !== undefined) {
    settings.dirtColor = [...update.dirtColor] as [number, number, number];
    uDirtColor.value.set(...settings.dirtColor);
  }
  if (update.innerRadiusScale !== undefined) {
    settings.innerRadiusScale = Math.max(0, update.innerRadiusScale);
  }
  if (update.outerRadiusScale !== undefined) {
    settings.outerRadiusScale = Math.max(settings.innerRadiusScale + 0.01, update.outerRadiusScale);
  }
}

export function grassContactPatchAttribute(): StorageBufferAttribute {
  return fieldAttribute;
}

export function ensureGrassContactPatchGpuResources(
  backend: GrassContactPatchGpuBackend,
): GrassContactPatchGpuResources {
  if (!initializedBackends.has(backend)) {
    backend.createStorageAttribute(fieldAttribute);
    initializedBackends.add(backend);
  }
  const buffer = backend.get(fieldAttribute).buffer;
  if (!buffer) throw new Error("Missing GPU buffer for grass-stone contact field");
  return { attribute: fieldAttribute, buffer, capacity: GRASS_CONTACT_STORAGE_CAPACITY };
}

export function grassContactPatchInfluence(worldXZ: TslNode): GrassContactInfluenceNodes {
  const field: TslNode = storage(fieldAttribute, "vec4", GRASS_CONTACT_STORAGE_CAPACITY).toReadOnly();
  const metadata: TslNode = field.element(GRASS_CONTACT_METADATA_INDEX);
  const grid: TslNode = max(metadata.w, 1);
  const cellM: TslNode = max(metadata.z, 0.001);
  const halfExtentM: TslNode = grid.mul(cellM).mul(0.5);
  const localCell: TslNode = worldXZ.sub(metadata.xy).add(halfExtentM).div(cellM);
  const cellX: TslNode = floor(localCell.x);
  const cellZ: TslNode = floor(localCell.y);
  const inside: TslNode = metadata.w.greaterThan(0.5)
    .and(cellX.greaterThanEqual(0))
    .and(cellZ.greaterThanEqual(0))
    .and(cellX.lessThan(grid))
    .and(cellZ.lessThan(grid));
  const clampedX: TslNode = clamp(cellX, 0, grid.sub(1));
  const clampedZ: TslNode = clamp(cellZ, 0, grid.sub(1));
  const fieldIndex: TslNode = uint(
    clampedZ.mul(grid).add(clampedX).add(GRASS_CONTACT_FIELD_OFFSET),
  );
  const sample: TslNode = field.element(fieldIndex);
  const active: TslNode = inside.select(float(1), float(0)).mul(uEnabled);
  const suppress: TslNode = sample.x.mul(active);
  const trample: TslNode = sample.y.mul(active);
  const splay: TslNode = sample.zw.mul(active);
  return {
    suppress,
    trample,
    flatten: max(suppress, trample),
    dirt: max(suppress, trample),
    splay,
  };
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
  const nearFade: TslNode = float(1).sub(smoothstep(72, 94, cameraDistance));
  const influence: TslNode = contact.dirt.mul(uDirtTintStrength).mul(nearFade);
  return mix(color, color.mul(uDirtColor.mul(1.6)), influence);
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

function readPositive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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
