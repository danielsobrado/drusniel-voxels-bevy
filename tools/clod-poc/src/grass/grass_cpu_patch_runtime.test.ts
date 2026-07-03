import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { grassRuntimeFootprint, unboundedGrassPatchSources } from "./grass_cpu_patch_runtime.js";

describe("grassRuntimeFootprint", () => {
  it("clamps finite-world grass footprints", () => {
    expect(grassRuntimeFootprint({ minX: -20, minZ: 10, maxX: 1100, maxZ: 80 }, 1024, false)).toEqual({
      minX: 0,
      minZ: 10,
      maxX: 1024,
      maxZ: 80,
    });
  });

  it("preserves unbounded grass footprints", () => {
    expect(grassRuntimeFootprint({ minX: -20, minZ: 10, maxX: 1100, maxZ: 80 }, 1024, true)).toEqual({
      minX: -20,
      minZ: 10,
      maxX: 1100,
      maxZ: 80,
    });
  });
});

describe("unboundedGrassPatchSources", () => {
  it("creates deterministic patch IDs around out-of-world centers", () => {
    const sources = unboundedGrassPatchSources(new THREE.Vector3(1500, 0, -300), 64, 64);
    const ids = sources.map((source) => source.id);

    expect(ids).toContain("grass-unbounded:23,-5");
    expect(ids.some((id) => id.includes("-"))).toBe(true);
  });
});
