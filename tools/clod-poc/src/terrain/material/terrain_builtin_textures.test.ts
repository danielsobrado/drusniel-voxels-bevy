import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_TEXTURE_PRESETS } from "./terrain_builtin_textures.js";

describe("default terrain texture presets", () => {
  it("covers low terrain with the grass height band", () => {
    const grass = DEFAULT_TERRAIN_TEXTURE_PRESETS[0];

    expect(grass.id).toBe("grass-2");
    expect(grass.heightMin).toBeLessThanOrEqual(0);
    expect(grass.heightMax).toBeGreaterThanOrEqual(18);
  });

  it("keeps adjacent height bands overlapping for smooth transitions", () => {
    for (let index = 1; index < DEFAULT_TERRAIN_TEXTURE_PRESETS.length; index += 1) {
      expect(DEFAULT_TERRAIN_TEXTURE_PRESETS[index]!.heightMin)
        .toBeLessThan(DEFAULT_TERRAIN_TEXTURE_PRESETS[index - 1]!.heightMax);
    }
  });
});
