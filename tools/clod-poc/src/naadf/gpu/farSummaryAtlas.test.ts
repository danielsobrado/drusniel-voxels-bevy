import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  FarSummaryGpuAtlas,
  diffAtlasTilePlacements,
  dirtyArea,
  mergeDirtyRects,
  shouldUseFullUpload,
  type PlannedAtlasTileSnapshot,
} from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";
import { unpackUnorm8 } from "../farSummaryAtlasPacking.js";
import { resolveFarSummaryGpuAtlasUploadOptions } from "../farSummaryAtlasUploadConfig.js";

const atlases: FarSummaryGpuAtlas[] = [];

function createAtlas(options: ConstructorParameters<typeof FarSummaryGpuAtlas>[0]): FarSummaryGpuAtlas {
  const atlas = new FarSummaryGpuAtlas(options);
  atlases.push(atlas);
  return atlas;
}

afterEach(() => {
  for (const atlas of atlases.splice(0)) atlas.dispose();
});

function readyTile(ring: number, x: number, z: number, height: number, revision = 1): any {
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
    revision,
    state: "ready",
  };
}

function testState(farTiles: Map<string, any>, revision = 42, predictedX = 64, predictedZ = 64): any {
  const config = createTestNaadfConfig();
  config.farClipmap.tileCells = 2;
  config.farClipmap.rings = [
    { name: "near", startM: 0, endM: 4096, cellM: 32 },
    { name: "far", startM: 4096, endM: 8192, cellM: 64 },
  ];
  return { config, farTiles, predictedX, predictedZ, revision, frame: revision };
}

function atlasPixel(atlas: FarSummaryGpuAtlas, x: number, z: number): number {
  return z * atlas.view.widthCells + x;
}

function placement(key: string, revision: number, atlasTileX: number, atlasTileZ: number): PlannedAtlasTileSnapshot {
  return {
    key,
    revision,
    ringIndex: Number(key.split(":")[0] ?? 0),
    atlasTileX,
    atlasTileZ,
    atlasX: atlasTileX * 2,
    atlasY: atlasTileZ * 2,
    copyCells: 2,
  };
}

describe("far-summary atlas dirty rect helpers", () => {
  it("merges adjacent and overlapping dirty rects", () => {
    expect(mergeDirtyRects([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 2, height: 2 },
      { x: 10, y: 0, width: 1, height: 1 },
    ])).toEqual([
      { x: 0, y: 0, width: 4, height: 2 },
      { x: 10, y: 0, width: 1, height: 1 },
    ]);
  });

  it("computes unique dirty area after merging", () => {
    expect(dirtyArea([
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 2, y: 0, width: 3, height: 3 },
    ])).toBe(15);
  });

  it("uses full upload when dirty area or rect count crosses configured limits", () => {
    const config = resolveFarSummaryGpuAtlasUploadOptions({
      fullUploadThresholdPct: 0.35,
      maxDirtyRectsPerTexture: 2,
    });

    expect(shouldUseFullUpload({
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
      dirtyPixels: 16,
      fullUpload: false,
    }, 100, config)).toBe(false);
    expect(shouldUseFullUpload({
      rects: [{ x: 0, y: 0, width: 6, height: 6 }],
      dirtyPixels: 36,
      fullUpload: false,
    }, 100, config)).toBe(true);
    expect(shouldUseFullUpload({
      rects: [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 2, y: 0, width: 1, height: 1 },
        { x: 4, y: 0, width: 1, height: 1 },
      ],
      dirtyPixels: 3,
      fullUpload: false,
    }, 100, config)).toBe(true);
  });

  it("diffs unchanged, changed, moved, and removed tile placements", () => {
    const unchanged = placement("0:1:1", 1, 1, 1);
    const changed = placement("0:2:1", 1, 2, 1);
    const moved = placement("0:3:1", 1, 3, 1);
    const removed = placement("0:4:1", 1, 4, 1);
    const previous = new Map([
      [unchanged.key, unchanged],
      [changed.key, changed],
      [moved.key, moved],
      [removed.key, removed],
    ]);
    const nextMoved = { ...moved, atlasTileX: 2, atlasX: 4 };
    const next = new Map([
      [unchanged.key, unchanged],
      [changed.key, { ...changed, revision: 2 }],
      [moved.key, nextMoved],
    ]);

    const diff = diffAtlasTilePlacements(previous, next);

    expect(diff.blitKeys.sort()).toEqual([changed.key, moved.key].sort());
    expect(diff.clearRects).toEqual([
      { x: moved.atlasX, y: moved.atlasY, width: 2, height: 2 },
      { x: removed.atlasX, y: removed.atlasY, width: 2, height: 2 },
    ]);
  });

  it("forces selected tile blits after external signature invalidation", () => {
    const tile = placement("0:1:1", 1, 1, 1);
    const placements = new Map([[tile.key, tile]]);

    const diff = diffAtlasTilePlacements(placements, placements, true);

    expect(diff.clearRects).toEqual([]);
    expect(diff.blitKeys).toEqual([tile.key]);
  });
});

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
    const estimatedBytes = atlas.view.estimatedBytes ?? Number.POSITIVE_INFINITY;
    const debugEstimatedBytes = atlas.view.debugEstimatedBytes ?? 0;

    expect(atlas.view.format).toBe("balanced");
    expect(atlas.view.texture.format).toBe(THREE.RedFormat);
    expect(atlas.view.texture.type).toBe(THREE.FloatType);
    expect(atlas.view.texture.image.data).toBeInstanceOf(Float32Array);
    expect(atlas.view.materialTexture.type).toBe(THREE.UnsignedByteType);
    expect(atlas.view.coverageTexture.type).toBe(THREE.UnsignedByteType);
    expect(atlas.view.normalTexture.image.width).toBe(1);
    expect(estimatedBytes).toBeLessThan(debugEstimatedBytes);
  });

  it("uses half-float height for packed_low_bandwidth", () => {
    const atlas = createAtlas({ tileCells: 2, ringCount: 2, format: "packed_low_bandwidth" });
    const estimatedBytes = atlas.view.estimatedBytes ?? Number.POSITIVE_INFINITY;
    const debugEstimatedBytes = atlas.view.debugEstimatedBytes ?? 0;

    expect(atlas.view.format).toBe("packed_low_bandwidth");
    expect(atlas.view.texture.format).toBe(THREE.RedFormat);
    expect(atlas.view.texture.type).toBe(THREE.HalfFloatType);
    expect(atlas.view.texture.image.data).toBeInstanceOf(Uint16Array);
    expect(atlas.view.materialTexture.type).toBe(THREE.UnsignedByteType);
    expect(atlas.view.coverageTexture.type).toBe(THREE.UnsignedByteType);
    expect(estimatedBytes).toBeLessThan(debugEstimatedBytes);
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

  it("packs low-bandwidth heights into an R16F texture", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, format: "packed_low_bandwidth" });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles));

    const data = atlas.view.texture.image.data as Uint16Array;
    const firstPackedPixel = atlasPixel(atlas, 2, 2);
    expect(data[firstPackedPixel]).toBe(THREE.DataUtils.toHalfFloat(20));
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

  it("uploads only changed tile rects when a selected tile revision changes", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20, 1));

    atlas.updateFromState(testState(farTiles, 1));
    farTiles.set("0:1,1", readyTile(0, 1, 1, 24, 2));
    atlas.updateFromState(testState(farTiles, 2));

    expect(atlas.view.uploadStats.lastUploadMode).toBe("dirty");
    expect(atlas.view.uploadStats.dirtyPixels).toBe(4);
    expect(atlas.view.uploadStats.totalPixels).toBe(36);
    expect(atlas.view.materialTexture.updateRanges).toHaveLength(2);
    expect(atlas.view.coverageTexture.updateRanges).toHaveLength(2);
  });

  it("clears stale rects when a tile is removed from the selected window", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));

    atlas.updateFromState(testState(farTiles, 1));
    farTiles.clear();
    farTiles.set("0:8,8", { ...readyTile(0, 8, 8, 0), state: "pending" });
    atlas.updateFromState(testState(farTiles, 2, 512, 512));

    const data = atlas.view.texture.image.data as Float32Array;
    expect(data[atlasPixel(atlas, 2, 2)]).toBe(0);
    expect(atlas.view.uploadStats.lastUploadMode).toBe("dirty");
    expect(atlas.view.uploadStats.dirtyPixels).toBe(4);
  });

  it("uses dirty uploads for a one-tile camera window shift below the threshold", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, uploadOptions: { fullUploadThresholdPct: 1 } });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20));
    farTiles.set("0:2,1", readyTile(0, 2, 1, 30));

    atlas.updateFromState(testState(farTiles, 1, 64, 64));
    atlas.updateFromState(testState(farTiles, 2, 128, 64));

    expect(atlas.view.uploadStats.lastUploadMode).toBe("dirty");
    expect(atlas.view.uploadStats.dirtyPixels).toBeLessThan(atlas.view.uploadStats.totalPixels);
    expect(atlas.view.uploadStats.dirtyPixels).toBe(12);
    expect(atlas.view.uploadStats.totalPixels).toBe(36);
  });

  it("falls back to full upload when dirty uploads are disabled", () => {
    const atlas = createAtlas({
      tileCells: 2,
      tilesX: 3,
      tilesZ: 3,
      uploadOptions: { dirtyRectUploads: false },
    });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20, 1));

    atlas.updateFromState(testState(farTiles, 1));
    farTiles.set("0:1,1", readyTile(0, 1, 1, 24, 2));
    atlas.updateFromState(testState(farTiles, 2));

    expect(atlas.view.uploadStats.lastUploadMode).toBe("full");
    expect(atlas.view.uploadStats.fullUploads).toBe(2);
    expect(atlas.view.uploadStats.dirtyPixels).toBe(36);
  });

  it("falls back to full upload when dirty area crosses the configured threshold", () => {
    const atlas = createAtlas({
      tileCells: 2,
      tilesX: 3,
      tilesZ: 3,
      uploadOptions: { fullUploadThresholdPct: 0.05 },
    });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20, 1));

    atlas.updateFromState(testState(farTiles, 1));
    farTiles.set("0:1,1", readyTile(0, 1, 1, 24, 2));
    atlas.updateFromState(testState(farTiles, 2));

    expect(atlas.view.uploadStats.lastUploadMode).toBe("full");
    expect(atlas.view.uploadStats.dirtyPixels).toBe(36);
  });
});
