import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_IMPOSTOR_SETTINGS, parseTreeConfig } from "./index.js";

describe("tree impostor parity defaults", () => {
  it("defaults to enabled high-quality 8x8 bake-on-start impostors", () => {
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.bakeOnStart).toBe(true);
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.octahedralGridSize).toBe(8);
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.resolutionPx).toBe(128);
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.bakeAgeLayers).toBe(false);
    expect(DEFAULT_TREE_IMPOSTOR_SETTINGS.futureNormalDepth).toBe(true);
  });

  it("keeps YAML toggles able to disable impostors and enable age pages", () => {
    const parsed = parseTreeConfig(`
trees:
  impostors:
    enabled: false
    bake_on_start: false
    bake_age_layers: true
    octahedral_grid_size: 4
`, null);

    expect(parsed.impostors.enabled).toBe(false);
    expect(parsed.impostors.bakeOnStart).toBe(false);
    expect(parsed.impostors.bakeAgeLayers).toBe(true);
    expect(parsed.impostors.octahedralGridSize).toBe(4);
  });
});
