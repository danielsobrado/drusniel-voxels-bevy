import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { FarSummaryGpuAtlas } from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";

const atlases: FarSummaryGpuAtlas[] = [];

function createAtlas(options: ConstructorParameters<typeof FarSummaryGpuAtlas>[0]): FarSummaryGpuAtlas {
  const atlas = new FarSummaryGpuAtlas(options);
  atlases.push(atlas);
  return atlas;
}

afterEach(() => {
  for (const atlas of atlases.splice(0)) atlas.dispose();
});

function readyTile(ring: number, x: number, z: number, height: number): any {
  return {
    key: { ring, x, z },
    originX: x * 64,
    originZ: z * 64,
    cellM: 32,
    resolution: 2,
    minHeight: new Float32Array([height - 1, height - 1, height - 1, height - 1]),
    maxHeight: new Float32Array([height + 1, height + 1, height + 1, height + 1]),
    avgHeight: new Float32Array([height, height + 2, height + 4, height + 6]),
    dominantMaterial: new Uint16Array([1, 1, 1, 1]),
    canopyCoverage: new Float32Array([0.25, 0.5, 0.75, 1]),
    waterCoverage: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    revision: 1,
    state: "ready",
  };
}

function testState(farTiles: Map<string, any>, revision = 42): any {
  const config = createTestNaadfConfig();
  config.farClipmap.tileCells = 2;
  config.farClipmap.rings = [
    { name: "near", startM: 0, endM: 4096, cellM: 32 },
    { name: "far", startM: 4096, endM: 8192, cellM: 64 },
  ];
  return { config, farTiles, predictedX: 64, predictedZ: 64, revision };
}

describe("FarSummaryGpuAtlas", () => {
  it("uses a wider 5x5 moving tile window by default", () => {
    const atlas = createAtlas({ tileCells: 2, ringCount: 2 });

    expect(atlas.view.widthCells).toBe(10);
    expect(atlas.view.heightCells).toBe(20);
    expect(atlas.view.rings[0]?.widthCells).toBe(10);
    expect(atlas.view.rings[0]?.heightCells).toBe(10);
    expect(atlas.view.rings[1]?.rowOffsetCells).toBe(10);
  });

  it("packs ready far-summary heights into a float texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    expect(atlas.view.valid).toBe(1);
    expect(atlas.view.widthCells).toBe(6);
    expect(atlas.view.texture.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.texture.minFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.materialTexture.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.materialTexture.minFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.normalTexture.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.normalTexture.minFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.coverageTexture.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.view.coverageTexture.minFilter).toBe(THREE.NearestFilter);
    const data = atlas.view.texture.image.data as Float32Array;
    const firstPackedPixel = ((2 * atlas.view.widthCells) + 2) * 4;
    expect(data[firstPackedPixel]).toBe(20);
    expect(data[firstPackedPixel + 1]).toBe(19);
    expect(data[firstPackedPixel + 2]).toBe(21);
    expect(data[firstPackedPixel + 3]).toBe(1);
  });

  it("packs summary material color into a paired float texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const materialData = atlas.view.materialTexture.image.data as Float32Array;
    const firstPackedPixel = ((2 * atlas.view.widthCells) + 2) * 4;
    expect(materialData[firstPackedPixel]).toBeCloseTo(0.30);
    expect(materialData[firstPackedPixel + 1]).toBeCloseTo(0.48);
    expect(materialData[firstPackedPixel + 2]).toBeCloseTo(0.24);
    expect(materialData[firstPackedPixel + 3]).toBe(1);
  });

  it("packs derived normals into a paired float texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const normalData = atlas.view.normalTexture.image.data as Float32Array;
    const firstPackedPixel = ((2 * atlas.view.widthCells) + 2) * 4;
    expect(normalData[firstPackedPixel]).toBeLessThan(0.5);
    expect(normalData[firstPackedPixel + 1]).toBeGreaterThan(0.5);
    expect(normalData[firstPackedPixel + 2]).toBeLessThan(0.5);
    expect(normalData[firstPackedPixel + 3]).toBe(1);
  });

  it("packs canopy and water coverage into a paired float texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const coverageData = atlas.view.coverageTexture.image.data as Float32Array;
    const firstPackedPixel = ((2 * atlas.view.widthCells) + 2) * 4;
    expect(coverageData[firstPackedPixel]).toBeCloseTo(0.25);
    expect(coverageData[firstPackedPixel + 1]).toBeCloseTo(0.1);
    expect(coverageData[firstPackedPixel + 2]).toBe(0);
    expect(coverageData[firstPackedPixel + 3]).toBe(1);
  });

  it("packs each far-summary ring into a separate atlas band", () => {
    const atlas = createAtlas({ tileCells: 2, ringCount: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));
    farTiles.set("1:1,1", readyTile(1, 1, 1, 80));

    atlas.updateFromState(testState(farTiles));

    expect(atlas.view.valid).toBe(1);
    expect(atlas.view.heightCells).toBe(12);
    expect(atlas.view.rings[0]?.rowOffsetCells).toBe(0);
    expect(atlas.view.rings[1]?.rowOffsetCells).toBe(6);

    const data = atlas.view.texture.image.data as Float32Array;
    const ring1PackedPixel = (((6 + 2) * atlas.view.widthCells) + 2) * 4;
    expect(data[ring1PackedPixel]).toBe(80);
    expect(data[ring1PackedPixel + 3]).toBe(1);
  });

  it("does not repack when only unrelated world revision changes", () => {
    const atlas = createAtlas({ tileCells: 2, ringCount: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles, 42));
    const revisionAfterFirstPack = atlas.view.revision;
    atlas.updateFromState(testState(farTiles, 99));

    expect(atlas.view.revision).toBe(revisionAfterFirstPack);
  });
});
