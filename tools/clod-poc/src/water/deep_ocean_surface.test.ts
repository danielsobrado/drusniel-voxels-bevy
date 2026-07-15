import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { createDeepOceanSurface, deepOceanSurfaceVertexCount } from "./deep_ocean_surface.js";

describe("deep ocean surface", () => {
  it("subdivides strips using config.segments", () => {
    const worldCells = 512;
    const config = { ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean, segments: 8 };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial());
    expect(surface).not.toBeNull();
    const positions = surface!.mesh.geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(16);
    expect(positions.count).toBe(deepOceanSurfaceVertexCount(worldCells, config));
    surface!.dispose();
  });

  it("builds an outside skirt beyond the playable square", () => {
    const worldCells = 256;
    const extendCells = 128;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 64,
      extendCells,
      segments: 4,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial())!;
    const box = surface.mesh.geometry.boundingBox!;
    expect(box.min.x).toBeLessThan(0);
    expect(box.min.z).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(worldCells);
    expect(box.max.z).toBeGreaterThan(worldCells);
    surface.dispose();
  });

  it("leaves the configured transition gap empty", () => {
    const worldCells = 256;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 32,
      extendCells: 96,
      segments: 4,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial())!;
    const positions = surface.mesh.geometry.getAttribute("position");

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const insideGap = x > -config.startOutsideBorderM
        && x < worldCells + config.startOutsideBorderM
        && z > -config.startOutsideBorderM
        && z < worldCells + config.startOutsideBorderM;
      expect(insideGap).toBe(false);
    }

    surface.dispose();
  });

  it("rebases a camera-relative surface without rebuilding its geometry", () => {
    const center = new THREE.Vector3(10, 0, 20);
    const surface = createDeepOceanSurface(
      256,
      DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      new THREE.MeshBasicMaterial(),
      { mode: "camera-relative", getCenter: () => center, rebaseSnapM: 128 },
    )!;
    const geometry = surface.mesh.geometry;

    center.set(140, 0, 270);
    surface.update(1);

    expect(surface.mesh.geometry).toBe(geometry);
    expect(surface.mesh.position.toArray()).toEqual([128, 0, 256]);
    surface.dispose();
  });
});
