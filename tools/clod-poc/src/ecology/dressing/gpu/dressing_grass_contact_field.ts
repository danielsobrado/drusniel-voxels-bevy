import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import {
  clamp,
  float,
  floor,
  max,
  storage,
  uint,
  uniform,
} from "three/tsl";
import type { VegetationGpuBackend } from "../../../runtime/vegetation/vegetation_gpu_backend.js";
import {
  DRESSING_GRASS_CONTACT_STRENGTH_SCALE,
  readDressingGrassContactConfig,
} from "./dressing_grass_contact_config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const config = readDressingGrassContactConfig();
export const DRESSING_GRASS_CONTACT_FIELD_CAPACITY = config.fieldGrid * config.fieldGrid;

const fieldAttribute = new StorageBufferAttribute(
  new Uint32Array(DRESSING_GRASS_CONTACT_FIELD_CAPACITY),
  1,
);
fieldAttribute.name = "dressing-grass-contact-field";

const initializedBackends = new WeakSet<object>();
const uCenter = uniform(new THREE.Vector2());
const uEnabled = uniform(0);

let gpuResourcesReady = false;
let registrationGeneration = 0;
let activeRegistrationGeneration = 0;
let activeContentRevision = 0;
let fieldCommits = 0;

export interface DressingGrassContactGpuResources {
  readonly attribute: StorageBufferAttribute;
  readonly buffer: GPUBuffer;
  readonly capacity: number;
}

export interface DressingGrassContactInfluenceNodes {
  readonly suppress: TslNode;
  readonly trample: TslNode;
}

export interface DressingGrassContactRuntimeStats {
  readonly registrationGeneration: number;
  readonly contentRevision: number;
  readonly commits: number;
  readonly active: boolean;
  readonly readbacks: 0;
}

export interface DressingGrassContactRegistration {
  readonly generation: number;
  commit(centerX: number, centerZ: number, contentRevision: number): void;
  dispose(): void;
}

export function ensureDressingGrassContactGpuResources(
  backend: VegetationGpuBackend,
): DressingGrassContactGpuResources {
  if (!initializedBackends.has(backend)) {
    backend.createStorageAttribute(fieldAttribute);
    initializedBackends.add(backend);
  }
  const buffer = backend.get(fieldAttribute).buffer;
  if (!buffer) throw new Error("dressing grass-contact GPU buffer was not created by the WebGPU backend");
  gpuResourcesReady = true;
  return { attribute: fieldAttribute, buffer, capacity: DRESSING_GRASS_CONTACT_FIELD_CAPACITY };
}

export function dressingGrassContactGpuResourcesReady(): boolean {
  return gpuResourcesReady;
}

export function registerDressingGrassContactField(): DressingGrassContactRegistration {
  const generation = ++registrationGeneration;
  activeRegistrationGeneration = generation;
  activeContentRevision = 0;
  uEnabled.value = 0;

  return {
    generation,
    commit(centerX: number, centerZ: number, contentRevision: number): void {
      if (activeRegistrationGeneration !== generation) return;
      uCenter.value.set(finiteOrZero(centerX), finiteOrZero(centerZ));
      activeContentRevision = Math.max(0, Math.floor(finiteOrZero(contentRevision)));
      fieldCommits += 1;
      uEnabled.value = config.enabled ? 1 : 0;
    },
    dispose(): void {
      if (activeRegistrationGeneration !== generation) return;
      activeRegistrationGeneration = 0;
      activeContentRevision = 0;
      uEnabled.value = 0;
    },
  };
}

export function dressingGrassContactInfluence(worldXZ: TslNode): DressingGrassContactInfluenceNodes {
  const field: TslNode = storage(
    fieldAttribute,
    "uint",
    DRESSING_GRASS_CONTACT_FIELD_CAPACITY,
  ).toReadOnly();
  const grid = float(config.fieldGrid);
  const cellM = float(config.fieldCellM);
  const halfExtentM = grid.mul(cellM).mul(0.5);
  const localCell = worldXZ.sub(uCenter).add(halfExtentM).div(cellM);
  const cellX = floor(localCell.x);
  const cellZ = floor(localCell.y);
  const inside = cellX.greaterThanEqual(0)
    .and(cellZ.greaterThanEqual(0))
    .and(cellX.lessThan(grid))
    .and(cellZ.lessThan(grid));
  const clampedX = clamp(cellX, 0, grid.sub(1));
  const clampedZ = clamp(cellZ, 0, grid.sub(1));
  const index = uint(clampedZ.mul(grid).add(clampedX));
  const packed = field.element(index);
  const active = inside.select(float(1), float(0)).mul(uEnabled);
  const influence = max(
    float(0),
    float(packed).div(DRESSING_GRASS_CONTACT_STRENGTH_SCALE),
  ).mul(active);
  return { suppress: influence, trample: influence };
}

export function dressingGrassContactRuntimeStats(): DressingGrassContactRuntimeStats {
  return {
    registrationGeneration: activeRegistrationGeneration,
    contentRevision: activeContentRevision,
    commits: fieldCommits,
    active: activeRegistrationGeneration > 0 && Number(uEnabled.value) > 0,
    readbacks: 0,
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
