import { describe, expect, it, vi } from "vitest";
import {
  resolveVegetationSurfaceSample,
  unknownVegetationSurfaceSample,
} from "./terrain_sampling.js";
import {
  VEGETATION_SURFACE_FLAG,
  VEGETATION_SURFACE_VALIDITY,
} from "./constants.js";
import type { VegetationSurfaceSample } from "./types.js";

const canonicalSample: VegetationSurfaceSample = {
  positionWs: [10, 20, 30],
  normalWs: [0, 1, 0],
  materialWeights: [1, 0, 0, 0],
  waterDepthM: 0,
  shoreDistanceM: 12,
  wetness: 0.2,
  moisture: 0.3,
  sediment: 0.1,
  deposition: 0.05,
  hardness: 0.8,
  flow: [0, 0],
  canopyCoverage: 0,
  canopyHeightM: 0,
  caveCoverage: 0,
  structureCoverage: 0,
  validity: VEGETATION_SURFACE_VALIDITY.CANONICAL_HEIGHTFIELD,
  flags: 0,
};

describe("vegetation authority terrain provider order", () => {
  it("applies canonical, voxel, exclusion, and occupancy providers in fixed order", () => {
    const order: string[] = [];
    const resolved = resolveVegetationSurfaceSample([10, 30], {
      canonicalHeightfield: () => { order.push("canonical"); return canonicalSample; },
      voxelOverlay: (_position, current) => {
        order.push("voxel");
        return { ...current!, positionWs: [10, 21, 30], validity: VEGETATION_SURFACE_VALIDITY.CANONICAL_WITH_VOXEL };
      },
      exclusions: (_position, current) => {
        order.push("exclusions");
        return { ...current!, structureCoverage: 1, flags: current!.flags | VEGETATION_SURFACE_FLAG.STRUCTURE_EXCLUDED };
      },
      occupancy: (_position, current) => {
        order.push("occupancy");
        return { ...current!, caveCoverage: 0.4 };
      },
      farSummary: vi.fn(() => { order.push("far"); return null; }),
    });

    expect(order).toEqual(["canonical", "voxel", "exclusions", "occupancy"]);
    expect(resolved.positionWs[1]).toBe(21);
    expect(resolved.validity).toBe(VEGETATION_SURFACE_VALIDITY.CANONICAL_WITH_VOXEL);
    expect(resolved.structureCoverage).toBe(1);
    expect(resolved.caveCoverage).toBe(0.4);
  });

  it("consults far summary last outside exact residency", () => {
    const order: string[] = [];
    const coarse = { ...canonicalSample, validity: VEGETATION_SURFACE_VALIDITY.COARSE };
    const resolved = resolveVegetationSurfaceSample([4096, -2048], {
      canonicalHeightfield: () => { order.push("canonical"); return null; },
      voxelOverlay: (_position, current) => { order.push("voxel"); return current; },
      exclusions: (_position, current) => { order.push("exclusions"); return current; },
      occupancy: (_position, current) => { order.push("occupancy"); return current; },
      farSummary: () => { order.push("far"); return coarse; },
    });

    expect(order).toEqual(["canonical", "voxel", "exclusions", "occupancy", "far"]);
    expect(resolved.validity).toBe(VEGETATION_SURFACE_VALIDITY.COARSE);
  });

  it("returns an explicit unknown sample when every provider misses", () => {
    const sample = resolveVegetationSurfaceSample([-4, 9], {});
    expect(sample).toEqual(unknownVegetationSurfaceSample([-4, 9]));
    expect(sample.validity).toBe(VEGETATION_SURFACE_VALIDITY.MISSING);
  });
});
