import { describe, expect, it } from "vitest";
import { parseTreeConfig } from "./tree_config_parsing.js";

describe("tree config parsing", () => {
  it("parses impostor and far-material runtime policy flags", () => {
    const settings = parseTreeConfig(`
trees:
  impostors:
    enabled: true
    bake_on_start: true
    fallback_to_placeholder: false
    swap_on_bake: false
    source_lod: near
    resolution_px: 256
    octahedral_grid_size: 8
    alpha_test: 0.35
  render:
    far_cheap_material: false
`, null);

    expect(settings.impostors.swapOnBake).toBe(false);
    expect(settings.render.farCheapMaterial).toBe(false);
  });
});
