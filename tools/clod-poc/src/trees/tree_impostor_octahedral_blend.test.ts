import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { octFrameBlendForDirection, octFrameIndexForDirection } from "./index.js";

describe("tree impostor octahedral blend", () => {
  it("returns four normalized blend samples", () => {
    const blend = octFrameBlendForDirection(new THREE.Vector3(1, 2, 3), 8, 128, 2);
    expect(blend.samples).toHaveLength(4);
    const weightSum = blend.samples.reduce((sum, sample) => sum + sample.weight, 0);
    expect(weightSum).toBeCloseTo(1, 6);
    for (const sample of blend.samples) {
      expect(sample.weight).toBeGreaterThanOrEqual(0);
      expect(sample.weight).toBeLessThanOrEqual(1);
      expect(sample.frame.index).toBeGreaterThanOrEqual(0);
      expect(sample.frame.index).toBeLessThan(64);
      expect(sample.frame.uvMin[0]).toBeGreaterThanOrEqual(0);
      expect(sample.frame.uvMin[1]).toBeGreaterThanOrEqual(0);
      expect(sample.frame.uvMax[0]).toBeLessThanOrEqual(1);
      expect(sample.frame.uvMax[1]).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the nearest frame compatible with the existing single-frame selector", () => {
    const direction = new THREE.Vector3(-0.25, 0.4, 0.9);
    const blend = octFrameBlendForDirection(direction, 8, 128, 2);
    const strongest = [...blend.samples].sort((a, b) => b.weight - a.weight)[0];
    expect(strongest.frame.index).toBe(octFrameIndexForDirection(direction, 8));
  });

  it("clamps edge samples instead of wrapping across atlas borders", () => {
    const blend = octFrameBlendForDirection(new THREE.Vector3(1000, 0, 1), 8, 128, 2);
    for (const sample of blend.samples) {
      expect(sample.frame.x).toBeGreaterThanOrEqual(0);
      expect(sample.frame.x).toBeLessThan(8);
      expect(sample.frame.y).toBeGreaterThanOrEqual(0);
      expect(sample.frame.y).toBeLessThan(8);
    }
  });
});
