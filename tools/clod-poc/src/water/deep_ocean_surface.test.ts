import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import {
  createDeepOceanSurface,
  deepOceanSurfaceVertexCount,
} from "./deep_ocean_surface.js";
import { deepOceanWaveVerticalBounds } from "./deep_ocean_waves.js";

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
    expect(box.min.x).toBeLessThanOrEqual(-extend - deepOceanWaveVerticalBounds());
    expect(box.max.x).toBeGreaterThanOrEqual(worldCells + extend + deepOceanWaveVerticalBounds());
    expect(box.min.z).toBeLessThanOrEqual(-extend - deepOceanWaveVerticalBounds());
    expect(box.max.z).toBeGreaterThanOrEqual(worldCells + extend + deepOceanWaveVerticalBounds());
    surface.dispose();
  });

  it("can extend into the playable border ocean band", () => {
    const worldCells = 256;
    const innerBand = 48;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      extendCells: 64,
      segments: 8,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial(), innerBand)!;
    const positions = surface.mesh.geometry.getAttribute("position");
    let minInsideX = Number.POSITIVE_INFINITY;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      if (x >= 0 && x <= worldCells && z >= 0 && z <= worldCells) {
        minInsideX = Math.min(minInsideX, x);
      }
    }
    expect(minInsideX).toBeLessThanOrEqual(innerBand);
    expect(positions.count).toBe(deepOceanSurfaceVertexCount(worldCells, config, innerBand));
    surface.dispose();
  });

  it("keeps CPU geometry immutable because waves run in the GPU material", () => {
    const worldCells = 128;
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      extendCells: 32,
      segments: 4,
    };
    const surface = createDeepOceanSurface(worldCells, config, new THREE.MeshBasicMaterial(), 24)!;
    const positions = surface.mesh.geometry.getAttribute("position");
    const x0 = positions.getX(0);
    const y0 = positions.getY(0);
    const z0 = positions.getZ(0);
    surface.update(2.0);
    expect(positions.getX(0)).toBe(x0);
    expect(positions.getY(0)).toBe(y0);
    expect(positions.getZ(0)).toBe(z0);
    surface.dispose();
  });
});
