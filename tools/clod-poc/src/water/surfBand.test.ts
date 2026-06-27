import { describe, expect, it } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { filterPageSourceSections } from "../clod/pageSource.js";
import type { PageMesh } from "../types.js";
import { SurfBand, SURF_BAND_WGSL } from "./surfBand.js";
const config = defaultBorderCoastOceanConfig;

describe("SurfBand", () => {
  it("creates render-only, non-collidable geometry above the water plane", () => {
    const band = new SurfBand({
      config,
      seed: 9,
      cellSizeM: 128,
      verticalOffsetM: 0.08,
    });

    expect(band.renderOnly).toBe(true);
    expect(band.collisionEnabled).toBe(false);
    expect(band.pageSourceKind).toBe("surfFoam");
    expect(band.object.renderOrder).toBeGreaterThan(10);
    expect(band.object.material.depthWrite).toBe(false);
    expect(band.object.userData["maskEvaluation"]).toBe("gpu-wgsl");
    expect(band.object.geometry.getAttribute("aSurfAlpha")).toBeUndefined();
    const positions = band.object.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      expect(positions.getY(vertex)).toBeCloseTo(config.world.water_level + 0.08);
    }
    expect(band.stats().triangles).toBeGreaterThan(0);
    band.dispose();
  });

  it("uses a border ring instead of a full-world sheet", () => {
    const cellSizeM = 128;
    const band = new SurfBand({ config, seed: 9, cellSizeM, verticalOffsetM: 0.08 });
    const maxWidth = Math.max(
      config.surf.beach_foam_width_m,
      config.surf.cliff_foam_width_m,
      config.surf.reef_foam_width_m,
    );
    const fullWidth = config.world.bounds.max_x - config.world.bounds.min_x + maxWidth * 2;
    const fullDepth = config.world.bounds.max_z - config.world.bounds.min_z + maxWidth * 2;
    const fullSheetTriangles = Math.ceil(fullWidth / cellSizeM) * Math.ceil(fullDepth / cellSizeM) * 2;
    expect(band.stats().triangles).toBeLessThan(fullSheetTriangles * 0.35);
    band.dispose();
  });

  it("is rejected by strict CLOD page-source filtering", () => {
    const band = new SurfBand({
      config,
      seed: 9,
      cellSizeM: 256,
      verticalOffsetM: 0.08,
    });
    const geometry = band.object.geometry;
    const positions = geometry.getAttribute("position").array as Float32Array;
    const indices = geometry.getIndex()!.array as Uint32Array;
    const vertexCount = positions.length / 3;
    const mesh: PageMesh = {
      positions,
      normals: new Float32Array(vertexCount * 3),
      paintSlots: new Float32Array(vertexCount),
      materialWeights: new Float32Array(vertexCount * 4),
      materialWeightStride: 4,
      indices,
    };
    const terrain: PageMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      paintSlots: new Float32Array(3),
      materialWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };
    const filtered = filterPageSourceSections([
      { kind: "mainTerrain", terrainClass: "beach", positionSource: "extracted", mesh: terrain },
      { kind: "surfFoam", positionSource: "extracted", mesh },
    ]);

    expect(filtered.includedTriangles).toBe(1);
    expect(filtered.excludedTriangles).toBe(indices.length / 3);
    expect(filtered.excludedSections[0].kind).toBe("surfFoam");
    band.dispose();
  });

  it("ships the procedural WGSL mask module", () => {
    expect(SURF_BAND_WGSL).toContain("fn surf_band_style");
    expect(SURF_BAND_WGSL).toContain("cliff_spray");
    expect(SURF_BAND_WGSL).toContain("reef_center");
  });
});
