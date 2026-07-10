import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createTerrainRaycastService } from "./terrain_raycast_service.js";

describe("terrain edit raycasts", () => {
  it("does not fall back to the procedural heightfield for editable terrain", () => {
    const raycastSurface = vi.fn(() => null);
    const surfaceHeight = vi.fn(() => 0);
    const service = createTerrainRaycastService({
      terrainColliders: { raycastSurface } as never,
      surfaceHeight,
      worldCells: 1024,
      getMode: () => "orbit",
    });
    const ray = new THREE.Ray(new THREE.Vector3(10, 10, 10), new THREE.Vector3(0, -1, 0));

    expect(service.raycastEditableTerrain(ray)).toBeNull();
    expect(raycastSurface).toHaveBeenCalledWith(ray, 4000);
    expect(surfaceHeight).not.toHaveBeenCalled();
    expect(service.raycastTerrainHeightfield(ray)?.pageId).toBe("heightfield");
  });

  it("limits player edit picking to interaction range", () => {
    const raycastSurface = vi.fn(() => null);
    const service = createTerrainRaycastService({
      terrainColliders: { raycastSurface } as never,
      surfaceHeight: () => 0,
      worldCells: 1024,
      getMode: () => "playing",
    });
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

    service.raycastEditableTerrain(ray);
    expect(raycastSurface).toHaveBeenCalledWith(ray, 8);
  });
});
