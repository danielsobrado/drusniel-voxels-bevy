import { describe, expect, it } from "vitest";
import atlasGridSource from "./water_node_atlas_grid.ts?raw";
import staticGridSource from "./water_node_static_grid.ts?raw";

describe("water node grid ramp guard", () => {
  it.each([
    ["atlas", atlasGridSource],
    ["static", staticGridSource],
  ])("dithers steep near-ring ramps on the %s path", (_name, source) => {
    expect(source).toContain("const rampKeep: TslNode");
    expect(source).toContain("const dither: TslNode");
    expect(source).toContain("return dither.greaterThan(keep);");
    expect(source).not.toContain("return slope.greaterThan(limit)");
  });
});
