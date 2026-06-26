import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { shellGridForTriangleBudget, shouldRebuildCanopyShell } from "./canopy_system.js";
import type { CanopyTextureSet } from "./canopy_types.js";

function mockTextureSet(revision: number, syntheticFallback = false): CanopyTextureSet {
  const data = new Float32Array(4);
  return {
    heightTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    coverageTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    speciesTexture: new THREE.DataTexture(data, 2, 2, THREE.RGBFormat, THREE.FloatType),
    roughnessTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    originX: 0,
    originZ: 0,
    extentM: 1024,
    resolution: 2,
    syntheticFallback,
    revision,
  };
}

describe("shellGridForTriangleBudget", () => {
  it("caps grid from the configured triangle budget", () => {
    expect(shellGridForTriangleBudget(250000)).toBe(192);
    expect(shellGridForTriangleBudget(8000)).toBe(63);
    expect(shellGridForTriangleBudget(512)).toBe(16);
  });
});

describe("shouldRebuildCanopyShell", () => {
  it("rebuilds when revision changes", () => {
    const prev = mockTextureSet(1);
    const next = mockTextureSet(2);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(true);
  });

  it("rebuilds when synthetic fallback mode changes", () => {
    const prev = mockTextureSet(1, false);
    const next = mockTextureSet(1, true);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(true);
  });

  it("skips rebuild when revision and mode are unchanged", () => {
    const prev = mockTextureSet(3);
    const next = mockTextureSet(3);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(false);
  });

  it("always rebuilds from null previous set", () => {
    const next = mockTextureSet(1);
    expect(shouldRebuildCanopyShell(null, next)).toBe(true);
  });
});
