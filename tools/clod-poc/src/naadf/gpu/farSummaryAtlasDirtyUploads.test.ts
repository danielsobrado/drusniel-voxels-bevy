import { afterEach, describe, expect, it } from "vitest";
import {
  FarSummaryGpuAtlas,
  resolveFullUploadReason,
  type AtlasDirtyUploadPlan,
} from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";
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

function testState(farTiles: Map<string, any>, revision = 1, predictedX = 64, predictedZ = 64): any {
  const config = createTestNaadfConfig();
  config.farClipmap.tileCells = 2;
  config.farClipmap.rings = [{ name: "near", startM: 0, endM: 4096, cellM: 32 }];
  return { config, farTiles, predictedX, predictedZ, revision, frame: revision };
}

describe("far-summary atlas dirty upload edge cases", () => {
  it("keeps the atlas stable when equal-distance selected tiles reorder", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const left = readyTile(0, 0, 1, 10);
    const anchor = readyTile(0, 1, 1, 20);
    const right = readyTile(0, 2, 1, 30);

    const first = new Map<string, any>([
      ["0:1,1", anchor],
      ["0:0,1", left],
      ["0:2,1", right],
    ]);
    const second = new Map<string, any>([
      ["0:2,1", right],
      ["0:1,1", anchor],
      ["0:0,1", left],
    ]);

    atlas.updateFromState(testState(first, 1, 64, 64));
    const revisionAfterFirst = atlas.view.revision;
    atlas.updateFromState(testState(second, 2, 64, 64));

    expect(atlas.view.revision).toBe(revisionAfterFirst);
    expect(atlas.view.uploadStats.lastUploadMode).toBe("full");
    expect(atlas.view.uploadStats.fallbackReason).toBe("initial");
  });

  it("falls back to a full upload when partial texture ranges are unavailable", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, uploadOptions: { fullUploadThresholdPct: 1 } });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20, 1));

    atlas.updateFromState(testState(farTiles, 1));
    (atlas.view.texture as any).addUpdateRange = undefined;
    farTiles.set("0:1,1", readyTile(0, 1, 1, 24, 2));
    atlas.updateFromState(testState(farTiles, 2));

    expect(atlas.view.uploadStats.lastUploadMode).toBe("full");
    expect(atlas.view.uploadStats.fallbackReason).toBe("partial_ranges_unsupported");
    expect(atlas.view.uploadStats.fullUploads).toBe(2);
    expect(atlas.view.uploadStats.dirtyPixels).toBe(atlas.view.uploadStats.totalPixels);
  });

  it("does not dirty the normal fallback texture when normal atlas storage is disabled", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, uploadOptions: { fullUploadThresholdPct: 1 } });
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", readyTile(0, 1, 1, 20, 1));

    atlas.updateFromState(testState(farTiles, 1));
    farTiles.set("0:1,1", readyTile(0, 1, 1, 24, 2));
    atlas.updateFromState(testState(farTiles, 2));

    expect(atlas.view.normalTexture.image.width).toBe(1);
    expect(atlas.view.normalTexture.image.height).toBe(1);
    expect(atlas.view.normalTexture.updateRanges).toHaveLength(0);
    expect(atlas.view.uploadStats.lastUploadMode).toBe("dirty");
    expect(atlas.view.uploadStats.fallbackReason).toBeNull();
  });

  it("reports full-upload fallback reasons for threshold and rect-count guards", () => {
    const config = resolveFarSummaryGpuAtlasUploadOptions({
      fullUploadThresholdPct: 0.25,
      maxDirtyRectsPerTexture: 1,
    });
    const manyRects: AtlasDirtyUploadPlan = {
      rects: [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 4, y: 0, width: 1, height: 1 },
      ],
      dirtyPixels: 2,
      fullUpload: false,
    };
    const tooLarge: AtlasDirtyUploadPlan = {
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
      dirtyPixels: 16,
      fullUpload: false,
    };

    expect(resolveFullUploadReason(manyRects, 100, config)).toBe("too_many_rects");
    expect(resolveFullUploadReason(tooLarge, 32, config)).toBe("threshold");
    expect(resolveFullUploadReason(tooLarge, 32, config, false)).toBe("partial_ranges_unsupported");
  });
});
