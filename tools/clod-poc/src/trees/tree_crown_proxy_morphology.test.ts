import { describe, expect, it } from "vitest";
import type { TreeInstanceMorphology } from "./morphology/types.js";
import {
  treeMorphologyCrownProxyDimensions,
  treeMorphologyCrownProxyOffset,
  type TreeCrownProxyDimensions,
} from "./tree_crown_proxy_math.js";

const base: TreeCrownProxyDimensions = {
  radiusX: 2,
  radiusZ: 1,
  height: 4,
  centerY: 10,
  density: 0.5,
};

const morphology: TreeInstanceMorphology = {
  age01: 1,
  leanX: 0.1,
  leanZ: 0.2,
  crownBiasX: 0.2,
  crownBiasZ: 0.3,
  crownWidth: 1.1,
  crownFlattening: 0.9,
  branchDroop: 0.1,
  foliageDensity: 0.8,
  health01: 0.75,
  rootFlare: 1,
  stiffness: 1,
};

describe("tree crown proxy morphology", () => {
  it("applies width, age, flattening and retention to proxy dimensions", () => {
    const dimensions = treeMorphologyCrownProxyDimensions(base, morphology);

    expect(dimensions.radiusX).toBeCloseTo(2.2);
    expect(dimensions.radiusZ).toBeCloseTo(1.1);
    expect(dimensions.height).toBeCloseTo(3.888);
    expect(dimensions.centerY).toBeCloseTo(10.8);
    expect(dimensions.density).toBeCloseTo(0.372);
  });

  it("uses morphed per-axis radii and center height for crown offsets", () => {
    const offset = treeMorphologyCrownProxyOffset(base, morphology);

    expect(offset[0]).toBeCloseTo(0.9692);
    expect(offset[1]).toBeCloseTo(1.3884);
  });
});
