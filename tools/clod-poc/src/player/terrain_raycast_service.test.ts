import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createTerrainRaycastService } from "./terrain_raycast_service.js";

describe("terrain edit raycasts", () => {
  it("falls back to the procedural heightfield for orbit editing", () => {
    const raycastSurface = vi.fn(() => null);
    const surfaceHeight = vi.fn(() => 0);
    const service = createTerrainRaycastService({
      terrainColliders: { raycastSurface } as never,
      surfaceHeight,
      worldCells: 1024,
      getMode: () => "orbit",
    });
    const ray = new THREE.Ray(new THREE.Vector3(10, 10, 10), new THREE.Vector3(0, -1, 0));

    expect(service.raycastEditableTerrain(ray)?.pageId).toBe("heightfield");
    expect(raycastSurface).toHaveBeenCalledWith(ray, 4000);
    expect(surfaceHeight).toHaveBeenCalled();
  });

  it("limits player edit picking to collider interaction range", () => {
    const raycastSurface = vi.fn(() => null);
    const surfaceHeight = vi.fn(() => 0);
    const service = createTerrainRaycastService({
      terrainColliders: { raycastSurface } as never,
      surfaceHeight,
      worldCells: 1024,
      getMode: () => "playing",
    });
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

    expect(service.raycastEditableTerrain(ray)).toBeNull();
    expect(raycastSurface).toHaveBeenCalledWith(ray, 8);
    expect(surfaceHeight).not.toHaveBeenCalled();
  });

  it("allows orbit editing on streamed terrain beyond the configured world", () => {
    const service = createTerrainRaycastService({
      terrainColliders: { raycastSurface: vi.fn(() => null) } as never,
      surfaceHeight: () => 12,
      worldCells: 512,
      allowOutOfWorld: true,
      getMode: () => "orbit",
    });

    const hit = service.raycastEditableTerrain(new THREE.Ray(
      new THREE.Vector3(576, 100, 320),
      new THREE.Vector3(0, -1, 0),
    ));
    expect(hit?.point.y).toBeCloseTo(12, 2);
  });
});
