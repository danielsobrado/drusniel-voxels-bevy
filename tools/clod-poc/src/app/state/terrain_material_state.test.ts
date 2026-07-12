import { describe, expect, it } from "vitest";
import { createTerrainMaterialSliceState } from "./terrain_material_state.js";

describe("terrain material state", () => {
  it("defaults external terrain textures to visible detail with narrow height blending", () => {
    const state = createTerrainMaterialSliceState({
      queryPerfMode: false,
      queryTerrainMaterialSource: null,
      terrainTriplanar: true,
    });

    expect(state.textureScale).toBe(2);
    expect(state.textureBlendWidth).toBe(2);
  });
});
