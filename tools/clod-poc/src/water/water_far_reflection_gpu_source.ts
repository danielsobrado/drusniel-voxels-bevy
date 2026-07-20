import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import type { FarReflectionSourceSnapshot } from "../terrain/far_clipmap/far_reflection_source.js";
import {
  readActiveFarReflectionSource,
  readActiveFarReflectionSourceGeneration,
} from "../terrain/far_clipmap/far_reflection_source_runtime.js";

export interface WaterFarReflectionGpuMetadata {
  readonly origin: THREE.Vector2;
  resolution: number;
  cellSizeM: number;
  valid: number;
  sourceGeneration: number;
}

export interface WaterFarReflectionGpuHandle {
  readonly attribute: StorageBufferAttribute;
  readonly metadata: WaterFarReflectionGpuMetadata;
  sync(): boolean;
  release(): void;
}

interface SharedGpuSource {
  readonly resolution: number;
  readonly data: Float32Array;
  readonly attribute: StorageBufferAttribute;
  readonly metadata: WaterFarReflectionGpuMetadata;
  refs: number;
  key: string;
  uploads: number;
}

const CELL_STRIDE = 4;
const sharedByResolution = new Map<number, SharedGpuSource>();

export function acquireWaterFarReflectionGpuSource(requestedResolution: number): WaterFarReflectionGpuHandle {
  const resolution = Math.max(2, Math.floor(Number.isFinite(requestedResolution) ? requestedResolution : 2));
  let shared = sharedByResolution.get(resolution);
  if (!shared) {
    const data = new Float32Array(resolution * resolution * CELL_STRIDE);
    shared = {
      resolution,
      data,
      attribute: new StorageBufferAttribute(data, CELL_STRIDE),
      metadata: {
        origin: new THREE.Vector2(),
        resolution,
        cellSizeM: 1,
        valid: 0,
        sourceGeneration: 0,
      },
      refs: 0,
      key: "",
      uploads: 0,
    };
    sharedByResolution.set(resolution, shared);
  }
  shared.refs += 1;
  let released = false;

  return {
    attribute: shared.attribute,
    metadata: shared.metadata,
    sync() {
      const source = readActiveFarReflectionSource();
      const registrationGeneration = readActiveFarReflectionSourceGeneration();
      const snapshot = source?.snapshot() ?? null;
      const key = `${registrationGeneration}|${snapshot?.generation ?? 0}|${snapshot?.enabled ? 1 : 0}`;
      if (key === shared!.key) return false;
      shared!.key = key;
      copyFarReflectionSnapshot(shared!.data, shared!.metadata, snapshot, resolution);
      shared!.attribute.needsUpdate = true;
      shared!.uploads += 1;
      publishCounters(shared!);
      return true;
    },
    release() {
      if (released) return;
      released = true;
      shared!.refs = Math.max(0, shared!.refs - 1);
    },
  };
}

export function copyFarReflectionSnapshot(
  target: Float32Array,
  metadata: WaterFarReflectionGpuMetadata,
  snapshot: FarReflectionSourceSnapshot | null,
  expectedResolution: number,
): boolean {
  target.fill(0);
  const expectedLength = expectedResolution * expectedResolution * CELL_STRIDE;
  const valid = snapshot?.enabled === true
    && snapshot.resolution === expectedResolution
    && snapshot.data.length === expectedLength
    && snapshot.cellSizeM > 0;
  if (!valid || !snapshot) {
    metadata.origin.set(0, 0);
    metadata.resolution = expectedResolution;
    metadata.cellSizeM = 1;
    metadata.valid = 0;
    metadata.sourceGeneration = snapshot?.generation ?? 0;
    return false;
  }

  target.set(snapshot.data);
  metadata.origin.set(snapshot.originX, snapshot.originZ);
  metadata.resolution = snapshot.resolution;
  metadata.cellSizeM = snapshot.cellSizeM;
  metadata.valid = 1;
  metadata.sourceGeneration = snapshot.generation;
  return true;
}

function publishCounters(shared: SharedGpuSource): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["water_far_reflection_source_valid"] = shared.metadata.valid;
  counters["water_far_reflection_source_generation"] = shared.metadata.sourceGeneration;
  counters["water_far_reflection_source_uploads"] = shared.uploads;
  counters["water_far_reflection_source_bytes"] = shared.data.byteLength;
  counters["water_far_reflection_source_readbacks"] = 0;
}
