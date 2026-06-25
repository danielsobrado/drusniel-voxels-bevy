import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import {
  createDeepOceanSurface,
  deepOceanSurfaceVertexCount,
} from "./deep_ocean_surface.js";

describe("deep ocean surface", () => {
  it("subdivides strips using config.segments instead of four giant quads", () => {
    const worldCells = 512;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      segments: 8,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial());
    expect(surface).not.toBeNull();
    const positions = surface!.mesh.geometry.getAttribute("position");
    const quadVertexCount = 16;
    expect(positions.count).toBeGreaterThan(quadVertexCount);
    expect(positions.count).toBe(deepOceanSurfaceVertexCount(worldCells, config));
    surface!.dispose();
  });

  it("covers the outside skirt beyond the playable square", () => {
    const worldCells = 256;
    const extend = 64;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      extendCells: extend,
      segments: 4,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial())!;
    const box = surface.mesh.geometry.boundingBox!;
    expect(box.min.x).toBeLessThanOrEqual(-extend);
    expect(box.max.x).toBeGreaterThanOrEqual(worldCells + extend);
    expect(box.min.z).toBeLessThanOrEqual(-extend);
    expect(box.max.z).toBeGreaterThanOrEqual(worldCells + extend);
    surface.dispose();
  });
});
