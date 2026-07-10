import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, TREE_SPECIES } from "./tree_config.js";
import {
  createTreeFoliageAtlas,
  foliageAtlasUvAt,
  TREE_FOLIAGE_ATLAS_COLUMNS,
  TREE_FOLIAGE_ATLAS_ROWS,
  treeSpeciesAtlasIndex,
} from "./tree_alpha_mask.js";

describe("tree foliage cluster atlas", () => {
  it("allocates one four-variant row per runtime species", () => {
    const atlas = createTreeFoliageAtlas(DEFAULT_TREE_SETTINGS);
    try {
      expect(atlas.columns).toBe(TREE_FOLIAGE_ATLAS_COLUMNS);
      expect(atlas.rows).toBe(TREE_FOLIAGE_ATLAS_ROWS);
      expect(atlas.rows).toBe(TREE_SPECIES.length);
      expect(atlas.texture.image.width).toBe(atlas.cellSize * TREE_FOLIAGE_ATLAS_COLUMNS);
      expect(atlas.texture.image.height).toBe(atlas.cellSize * TREE_FOLIAGE_ATLAS_ROWS);
      expect(atlas.texture.generateMipmaps).toBe(true);
    } finally {
      atlas.dispose();
    }
  });

  it("contains cutout coverage for leafy species and none for the snag", () => {
    const atlas = createTreeFoliageAtlas(DEFAULT_TREE_SETTINGS);
    try {
      const data = atlas.texture.image.data as Uint8Array;
      const width = atlas.texture.image.width;
      const rowAlpha = (speciesIndex: number): number => {
        let alpha = 0;
        const y0 = speciesIndex * atlas.cellSize;
        for (let y = y0; y < y0 + atlas.cellSize; y++) {
          for (let x = 0; x < width; x++) alpha += data[(y * width + x) * 4 + 3] as number;
        }
        return alpha;
      };

      expect(rowAlpha(treeSpeciesAtlasIndex("oak"))).toBeGreaterThan(0);
      expect(rowAlpha(treeSpeciesAtlasIndex("pine"))).toBeGreaterThan(0);
      expect(rowAlpha(treeSpeciesAtlasIndex("birch"))).toBeGreaterThan(0);
      expect(rowAlpha(treeSpeciesAtlasIndex("willow"))).toBeGreaterThan(0);
      expect(rowAlpha(treeSpeciesAtlasIndex("spruce"))).toBeGreaterThan(0);
      expect(rowAlpha(treeSpeciesAtlasIndex("dead"))).toBe(0);
    } finally {
      atlas.dispose();
    }
  });

  it("maps local 2x2 card UVs into the requested species row", () => {
    const oak = foliageAtlasUvAt(0.25, 0.25, treeSpeciesAtlasIndex("oak"));
    const spruce = foliageAtlasUvAt(0.25, 0.25, treeSpeciesAtlasIndex("spruce"));
    expect(oak[0]).toBeGreaterThanOrEqual(0);
    expect(oak[0]).toBeLessThanOrEqual(1);
    expect(spruce[1]).toBeGreaterThan(oak[1]);
    expect(spruce[1]).toBeLessThanOrEqual(1);
  });
});
