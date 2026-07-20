import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FarReflectionSourceSnapshot } from "../terrain/far_clipmap/far_reflection_source.js";
import { copyFarReflectionSnapshot, type WaterFarReflectionGpuMetadata } from "./water_far_reflection_gpu_source.js";

function metadata(): WaterFarReflectionGpuMetadata {
  return {
    origin: new THREE.Vector2(),
    resolution: 3,
    cellSizeM: 1,
    valid: 0,
    sourceGeneration: 0,
  };
}

function snapshot(): FarReflectionSourceSnapshot {
  return {
    enabled: true,
    generation: 7,
    sourceRevision: 3,
    propGeneration: 2,
    propRevision: 5,
    resolution: 3,
    originX: -10,
    originZ: 20,
    cellSizeM: 8,
    data: new Float32Array(3 * 3 * 4).fill(4),
  };
}

describe("water far reflection GPU source", () => {
  it("copies a matching immutable snapshot and publishes metadata", () => {
    const target = new Float32Array(3 * 3 * 4);
    const meta = metadata();
    const source = snapshot();

    expect(copyFarReflectionSnapshot(target, meta, source, 3)).toBe(true);
    expect(target).toEqual(source.data);
    expect(target).not.toBe(source.data);
    expect(meta).toMatchObject({ resolution: 3, cellSizeM: 8, valid: 1, sourceGeneration: 7 });
    expect(meta.origin.toArray()).toEqual([-10, 20]);
  });

  it("fails closed and clears stale data on missing or incompatible snapshots", () => {
    const target = new Float32Array(3 * 3 * 4).fill(9);
    const meta = metadata();
    const mismatched = { ...snapshot(), resolution: 5 };

    expect(copyFarReflectionSnapshot(target, meta, mismatched, 3)).toBe(false);
    expect(Array.from(target).every((value) => value === 0)).toBe(true);
    expect(meta.valid).toBe(0);

    target.fill(7);
    expect(copyFarReflectionSnapshot(target, meta, null, 3)).toBe(false);
    expect(Array.from(target).every((value) => value === 0)).toBe(true);
  });
});
