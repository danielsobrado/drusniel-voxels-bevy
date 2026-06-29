import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_SETTINGS,
  treeCrownProxyCoverage,
  treeCrownProxyDensity,
  treeCrownProxyKeepsSample,
  treeCrownProxySpec,
  treeCrownProxyWorldHash,
} from "./index.js";

describe("tree crown proxy shadow helpers", () => {
  it("fits proxy dimensions from species crown settings", () => {
    const oak = treeCrownProxySpec(DEFAULT_TREE_SETTINGS, "oak", 1.25, 0.75);

    expect(oak.species).toBe("oak");
    expect(oak.radiusXM).toBeGreaterThan(0);
    expect(oak.radiusYM).toBeGreaterThan(0);
    expect(oak.radiusZM).toBeGreaterThan(0);
    expect(oak.centerYM).toBeGreaterThan(oak.radiusYM * 0.5);
    expect(oak.bandFade).toBeCloseTo(0.75);
  });

  it("keeps density inside the proxy contract range", () => {
    for (const species of ["oak", "pine", "dead"] as const) {
      const density = treeCrownProxyDensity(DEFAULT_TREE_SETTINGS.species[species]);

      expect(density).toBeGreaterThanOrEqual(0.18);
      expect(density).toBeLessThanOrEqual(0.92);
    }
  });

  it("has center coverage and fades out at the ellipsoid edge", () => {
    const spec = treeCrownProxySpec(DEFAULT_TREE_SETTINGS, "pine", 1, 1);
    const centerCoverage = treeCrownProxyCoverage({
      localX: 0,
      localY: spec.centerYM,
      localZ: 0,
      worldX: 10,
      worldZ: 20,
    }, spec);
    const edgeCoverage = treeCrownProxyCoverage({
      localX: spec.radiusXM,
      localY: spec.centerYM,
      localZ: 0,
      worldX: 10,
      worldZ: 20,
    }, spec);

    expect(centerCoverage).toBeGreaterThan(edgeCoverage);
    expect(edgeCoverage).toBe(0);
  });

  it("applies impostor-band fade to shadow coverage", () => {
    const full = treeCrownProxySpec(DEFAULT_TREE_SETTINGS, "oak", 1, 1);
    const faded = treeCrownProxySpec(DEFAULT_TREE_SETTINGS, "oak", 1, 0.25);
    const sample = { localX: 0, localY: full.centerYM, localZ: 0, worldX: 8, worldZ: 12 };

    expect(treeCrownProxyCoverage(sample, faded)).toBeCloseTo(treeCrownProxyCoverage(sample, full) * 0.25);
  });

  it("uses a stable world-anchored dither hash", () => {
    const a = treeCrownProxyWorldHash(10, 20, 7331);
    const b = treeCrownProxyWorldHash(10, 20, 7331);
    const c = treeCrownProxyWorldHash(11, 20, 7331);

    expect(a).toBeCloseTo(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(c).not.toBeCloseTo(a);
  });

  it("rejects samples outside the crown ellipsoid", () => {
    const spec = treeCrownProxySpec(DEFAULT_TREE_SETTINGS, "dead", 1, 1);

    expect(treeCrownProxyKeepsSample({
      localX: spec.radiusXM * 2,
      localY: spec.centerYM,
      localZ: 0,
      worldX: 0,
      worldZ: 0,
    }, spec, 7331)).toBe(false);
  });
});
