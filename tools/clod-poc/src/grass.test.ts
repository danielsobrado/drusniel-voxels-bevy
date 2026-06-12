import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRASS_SETTINGS,
  acceptsGrassCandidate,
  generateGrassInstances,
  type GrassSettings,
} from "./grass.js";
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
});
