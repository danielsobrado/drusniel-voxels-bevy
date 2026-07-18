import { describe, expect, it } from "vitest";
import atlasGridSource from "./water_node_atlas_grid.ts?raw";
import staticGridSource from "./water_node_static_grid.ts?raw";

describe("water node grid ramp guard", () => {
  it("dithers steep near-ring ramps in the shared static helper", () => {
    expect(staticGridSource).toContain("const rampKeep: TslNode");
    expect(staticGridSource).toContain("const dither: TslNode");
    expect(staticGridSource).toContain("return dither.greaterThan(keep);");
    expect(staticGridSource).not.toContain("return slope.greaterThan(limit)");
  });

  it("reuses the shared ramp discard helper on the atlas path", () => {
    expect(atlasGridSource).toContain("buildWaterRampDiscard");
    expect(atlasGridSource).not.toContain("return slope.greaterThan(limit)");
  });
});
