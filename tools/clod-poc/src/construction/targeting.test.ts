import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { raycastConstructionTerrain } from "./targeting.js";
import type { ConstructionPlacementConfig } from "./types.js";

const placement: ConstructionPlacementConfig = {
  maxRayDistanceM: 32,
  terrainStepM: 2,
  overlapPaddingM: 0.04,
  storageKey: "test",
  allowHeightfieldFallback: false,
};

const ray = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));

describe("construction targeting", () => {
  it("uses authoritative collider hits and derives an outward density normal", () => {
    const hit = raycastConstructionTerrain({
      ray,
      worldCells: 128,
      placement,
      raycastAuthoritativeTerrain: vi.fn(() => ({ point: new THREE.Vector3(0, 0, 0), distance: 10, pageId: "near-0" })),
      densityAt: (_x, y) => -y,
      surfaceHeightAt: vi.fn(() => 999),
    });
    expect(hit?.pageId).toBe("near-0");
    expect(hit?.normal[1]).toBeGreaterThan(0.99);
  });

  it("does not silently use the heightfield fallback", () => {
    const surfaceHeightAt = vi.fn(() => 0);
    expect(raycastConstructionTerrain({
      ray,
      worldCells: 128,
      placement,
      raycastAuthoritativeTerrain: () => null,
      surfaceHeightAt,
    })).toBeNull();
    expect(surfaceHeightAt).not.toHaveBeenCalled();
  });

  it("allows the heightfield only when explicitly enabled", () => {
    const hit = raycastConstructionTerrain({
      ray,
      worldCells: 128,
      placement: { ...placement, allowHeightfieldFallback: true },
      raycastAuthoritativeTerrain: () => null,
      surfaceHeightAt: () => 0,
    });
    expect(hit?.pageId).toBe("heightfield-debug-fallback");
  });
});
