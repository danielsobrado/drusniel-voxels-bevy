import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import {
  bakeTreeFoliageAtlas,
  flipRows,
  validateCapturedFoliageAtlasAlpha,
} from "./tree_foliage_atlas_baker.js";
import {
  TREE_FOLIAGE_ATLAS_COLUMNS,
  TREE_FOLIAGE_ATLAS_ROWS,
} from "./tree_alpha_mask.js";

describe("tree foliage atlas baker", () => {
  it("falls back cleanly when renderer readback is unavailable", async () => {
    const result = await bakeTreeFoliageAtlas({
      renderer: {},
      settings: DEFAULT_TREE_SETTINGS,
      webgpu: true,
    });
    expect(result.supported).toBe(false);
    expect(result.atlas).toBeNull();
    expect(result.reason).toContain("readback");
  });

  it("flips WebGPU readback rows without changing pixels within a row", () => {
    const pixels = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);
    flipRows(pixels, 2, 2);
    expect([...pixels]).toEqual([
      9, 10, 11, 12,
      13, 14, 15, 16,
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]);
  });

  it("rejects a capture whose background alpha is fully opaque", () => {
    const cellSize = 4;
    const width = TREE_FOLIAGE_ATLAS_COLUMNS * cellSize;
    const height = TREE_FOLIAGE_ATLAS_ROWS * cellSize;
    const pixels = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      pixels[pixel * 4] = 80;
      pixels[pixel * 4 + 1] = 120;
      pixels[pixel * 4 + 2] = 60;
      pixels[pixel * 4 + 3] = 255;
    }

    expect(validateCapturedFoliageAtlasAlpha(pixels, width, height, cellSize)).toContain("too opaque");
  });
});
