import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { WaterFieldResult } from "./waterField.js";
import { RiverCascadeParticleOverlay, cascadeParticleSignal } from "./riverCascadeParticleOverlay.js";
import { DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS } from "./riverCascadeParticlesRuntime.js";

function sample(partial: Partial<WaterFieldResult>): WaterFieldResult {
  return {
    waterY: 10,
    terrainY: 9,
    depth: 1,
    bodyMask: 1,
    bodyKind: 0,
    ...partial,
    shoreDistance: partial.shoreDistance ?? 5,
    flow: { x: 1, z: 0, speed: 0, progress: 0, drop: 0, ...partial.flow },
  };
}

describe("cascade particle signal", () => {
  it("separates fast flat rapids from cascade drops", () => {
    const signal = cascadeParticleSignal(
      sample({ flow: { x: 1, z: 0, speed: 3, progress: 0, drop: 0.05 } }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal.rapid).toBeGreaterThan(0.8);
    expect(signal.cascade).toBe(0);
    expect(signal.foam).toBeGreaterThan(0.6);
  });

  it("uses high drop for cascade mist and splash signal", () => {
    const signal = cascadeParticleSignal(
      sample({ flow: { x: 1, z: 0, speed: 0.4, progress: 0, drop: 9 } }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal.cascade).toBeGreaterThan(0.8);
    expect(signal.foam).toBeGreaterThan(0.8);
  });

  it("does not emit from dry or invalid water samples", () => {
    const signal = cascadeParticleSignal(
      sample({ depth: 0, bodyMask: 1, flow: { x: 1, z: 0, speed: 9, progress: 0, drop: 9 } }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal).toEqual({ cascade: 0, rapid: 0, foam: 0 });
  });

  it("budgets emitter field probes across frames", () => {
    const sampleField = vi.fn(() => sample({ depth: 0, bodyMask: 0 }));
    const overlay = new RiverCascadeParticleOverlay(
      new THREE.Scene(),
      { sample: sampleField } as never,
    );

    overlay.update(1, new THREE.Vector3());

    expect(sampleField.mock.calls.length).toBeGreaterThan(0);
    expect(sampleField.mock.calls.length).toBeLessThanOrEqual(32);
    overlay.dispose();
  });
});
