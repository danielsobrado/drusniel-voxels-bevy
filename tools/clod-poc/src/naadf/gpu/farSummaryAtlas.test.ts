import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { FarSummaryGpuAtlas } from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";
import { unpackUnorm8 } from "../farSummaryAtlasPacking.js";

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

function atlasPixel(atlas: FarSummaryGpuAtlas, x: number, z: number): number {
  return z * atlas.view.widthCells + x;
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

  it("uses balanced packed textures by default", () => {
    const atlas = createAtlas({ tileCells: 2, ringCount: 2 });

    expect(atlas.view.format).toBe("balanced");
    expect(atlas.view.texture.format).toBe(THREE.RedFormat);
    expect(atlas.view.texture.type).toBe(THREE.FloatType);
    expect(atlas.view.materialTexture.type).toBe(THREE.UnsignedByteType);
    expect(atlas.view.coverageTexture.type).toBe(THREE.UnsignedByteType);
    expect(atlas.view.normalTexture.image.width).toBe(1);
    expect(atlas.view.estimatedBytes).toBeLessThan(atlas.view.debugEstimatedBytes ?? Number.POSITIVE_INFINITY);
  });

  it("packs ready far-summary heights into an R32F texture", () => {
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
    const firstPackedPixel = atlasPixel(atlas, 2, 2);
    expect(data[firstPackedPixel]).toBe(20);
  });

  it("packs summary material color into an RGBA8 texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const materialData = atlas.view.materialTexture.image.data as Uint8Array;
    const firstPackedPixel = atlasPixel(atlas, 2, 2) * 4;
    expect(unpackUnorm8(materialData[firstPackedPixel] ?? 0)).toBeCloseTo(0.30, 2);
    expect(unpackUnorm8(materialData[firstPackedPixel + 1] ?? 0)).toBeCloseTo(0.48, 2);
    expect(unpackUnorm8(materialData[firstPackedPixel + 2] ?? 0)).toBeCloseTo(0.24, 2);
    expect(materialData[firstPackedPixel + 3]).toBe(255);
  });

  it("derives normals from height in balanced mode instead of storing a full normal atlas", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    expect(atlas.view.normalTexture.image.width).toBe(1);
    expect(atlas.view.normalTexture.image.height).toBe(1);
    expect(atlas.view.normalTexture.image.data).toBeInstanceOf(Uint8Array);
  });

  it("packs canopy, water, terrain, and validity coverage into RGBA8", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const coverageData = atlas.view.coverageTexture.image.data as Uint8Array;
    const firstPackedPixel = atlasPixel(atlas, 2, 2) * 4;
    expect(unpackUnorm8(coverageData[firstPackedPixel] ?? 0)).toBeCloseTo(0.25, 2);
    expect(unpackUnorm8(coverageData[firstPackedPixel + 1] ?? 0)).toBeCloseTo(0.1, 2);
    expect(coverageData[firstPackedPixel + 2]).toBe(255);
    expect(coverageData[firstPackedPixel + 3]).toBe(255);
  });

  it("keeps debug RGBA32F mode for packed-vs-debug validation", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, format: "debug_rgba32f" });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    expect(atlas.view.texture.format).toBe(THREE.RGBAFormat);
    expect(atlas.view.texture.type).toBe(THREE.FloatType);
    const heightData = atlas.view.texture.image.data as Float32Array;
    const firstPackedPixel = atlasPixel(atlas, 2, 2) * 4;
    expect(heightData[firstPackedPixel]).toBe(20);
    expect(heightData[firstPackedPixel + 1]).toBe(19);
    expect(heightData[firstPackedPixel + 2]).toBe(21);
    expect(heightData[firstPackedPixel + 3]).toBe(1);

    const normalData = atlas.view.normalTexture.image.data as Float32Array;
    expect(normalData[firstPackedPixel]).toBeLessThan(0.5);
    expect(normalData[firstPackedPixel + 1]).toBeGreaterThan(0.5);
    expect(normalData[firstPackedPixel + 2]).toBeLessThan(0.5);
    expect(normalData[firstPackedPixel + 3]).toBe(1);
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
    const ring1PackedPixel = atlasPixel(atlas, 2, 8);
    expect(data[ring1PackedPixel]).toBe(80);
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
