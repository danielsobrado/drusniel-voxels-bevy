import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_GRASS_SETTINGS,
  acceptsGrassCandidate,
  generateGrassInstances,
  type GrassSettings,
} from "./grass.js";
import { addDigEdit, clearDigEdits, surfaceHeight } from "./terrain.js";
import type { PageFootprint } from "./types.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 16, maxZ: 16 };
const settings: GrassSettings = {
  ...DEFAULT_GRASS_SETTINGS,
  minHeight: 0,
  maxHeight: 128,
  slopeMinY: 0,
  bladeSpacing: 2,
  maxBlades: 1000,
};

describe("grass placement", () => {
  it("is deterministic for the same seed and footprint", () => {
    expect(generateGrassInstances(footprint, settings)).toEqual(generateGrassInstances(footprint, settings));
  });

  it("changes blade attributes when the seed changes", () => {
    const first = generateGrassInstances(footprint, settings);
    const second = generateGrassInstances(footprint, { ...settings, seed: settings.seed + 1 });
    expect(second).not.toEqual(first);
  });

  it("rejects slopes below the configured threshold", () => {
    expect(acceptsGrassCandidate(settings, {
      height: 50,
      normalY: -0.01,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
  });

  it("rejects heights outside the configured range", () => {
    const bounded = { ...settings, minHeight: 20, maxHeight: 80 };
    expect(acceptsGrassCandidate(bounded, {
      height: 19.99,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
    expect(acceptsGrassCandidate(bounded, {
      height: 80.01,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
  });

  it("respects the maximum blade count", () => {
    expect(generateGrassInstances(footprint, settings, 7)).toHaveLength(7);
  });

  afterEach(() => {
    clearDigEdits();
  });

  it("re-samples blade height after terrain is edited", () => {
    clearDigEdits();
    const before = generateGrassInstances(footprint, settings);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];
    addDigEdit({
      x: target.offset[0],
      y: target.offset[1],
      z: target.offset[2],
      r: 3,
      shape: "sphere",
      op: "remove",
    });
    expect(surfaceHeight(target.offset[0], target.offset[2])).toBeLessThan(target.offset[1] - 0.01);
    const after = generateGrassInstances(footprint, settings);
    for (const blade of after) {
      const groundY = surfaceHeight(blade.offset[0], blade.offset[2]);
      expect(blade.offset[1]).toBeCloseTo(groundY + 0.02, 1);
    }
  });
});
