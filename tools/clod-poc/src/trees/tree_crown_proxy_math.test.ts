import { describe, expect, it } from "vitest";
import {
  cloneTreeSettings,
  createTreeCrownProxyGeometry,
  treeCrownProxyDimensions,
  treeCrownProxyImpostorFade,
  treeCrownProxyKeepProbability,
} from "./index.js";

describe("tree crown proxy math", () => {
  it("fits broad oak crowns wider than pine crowns", () => {
    const settings = cloneTreeSettings();
    const oak = treeCrownProxyDimensions(settings, "oak");
    const pine = treeCrownProxyDimensions(settings, "pine");

    expect(oak.radiusX).toBeGreaterThan(pine.radiusX);
    expect(pine.height).toBeGreaterThan(oak.height);
    expect(oak.density).toBeGreaterThan(0.5);
    expect(pine.density).toBeGreaterThan(0.5);
  });

  it("uses a sparse small proxy for dead trees", () => {
    const dead = treeCrownProxyDimensions(cloneTreeSettings(), "dead");

    expect(dead.radiusX).toBeLessThan(1);
    expect(dead.radiusZ).toBeLessThan(1);
    expect(dead.density).toBeLessThan(0.2);
  });

  it("creates a named ellipsoid source geometry", () => {
    const geometry = createTreeCrownProxyGeometry();

    expect(geometry.name).toBe("tree-crown-proxy-ellipsoid");
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("falls off toward crown edge and respects density", () => {
    expect(treeCrownProxyKeepProbability(0, 0.8)).toBeCloseTo(0.8, 5);
    expect(treeCrownProxyKeepProbability(0.9, 0.8)).toBeLessThan(0.8);
    expect(treeCrownProxyKeepProbability(1, 0.8)).toBe(0);
    expect(treeCrownProxyKeepProbability(0, 0.25)).toBeCloseTo(0.25, 5);
  });

  it("fades across the impostor boundary band", () => {
    expect(treeCrownProxyImpostorFade(540, 460, 620, 80)).toBe(1);
    expect(treeCrownProxyImpostorFade(580, 460, 620, 80)).toBeGreaterThan(0);
    expect(treeCrownProxyImpostorFade(580, 460, 620, 80)).toBeLessThan(1);
    expect(treeCrownProxyImpostorFade(620, 460, 620, 80)).toBe(0);
  });
});
