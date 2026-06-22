import { describe, expect, it } from "vitest";
import { HeightfieldSampler } from "./heightfield_sampler.js";
import type { Phase1Heightfield } from "./terrain_synthesis.js";

function tinyField(): Phase1Heightfield {
  return {
    size: 2,
    worldSizeM: 10,
    heights: new Float32Array([0, 10, 20, 30]),
    slope: new Float32Array([0, 0.2, 0.4, 0.6]),
    flow: new Float32Array([0, 0.25, 0.5, 1]),
    biome: new Uint8Array([0, 1, 2, 3]),
    minHeight: 0,
    maxHeight: 30,
    signature: 1,
  };
}

describe("HeightfieldSampler", () => {
  it("bilinearly samples a known 2x2 grid", () => {
    const sampler = new HeightfieldSampler(tinyField());
    const sample = sampler.sample(5, 5);
    expect(sample.height).toBeCloseTo(15);
    expect(sample.slope).toBeCloseTo(0.3);
    expect(sample.flow).toBeCloseTo(0.4375);
  });

  it("clamps world coordinates to the heightfield domain", () => {
    const sampler = new HeightfieldSampler(tinyField());
    expect(sampler.sample(-100, -100).height).toBe(0);
    expect(sampler.sample(100, 100).height).toBe(30);
  });

  it("normalAt returns a normalized vector", () => {
    const sampler = new HeightfieldSampler(tinyField());
    const normal = sampler.normalAt(5, 5);
    expect(Math.hypot(...normal)).toBeCloseTo(1);
  });
});
