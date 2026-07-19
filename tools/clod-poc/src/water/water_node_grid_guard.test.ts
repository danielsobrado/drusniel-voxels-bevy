import { describe, expect, it } from "vitest";
import atlasGridSource from "./water_node_atlas_grid.ts?raw";
import staticGridSource from "./water_node_static_grid.ts?raw";

describe("water node grid ramp guard", () => {
  it("rejects steep near-ring ramps without a visible world-space dither", () => {
    expect(staticGridSource).toContain("const rampKeep: TslNode");
    expect(staticGridSource).toContain("return keep.lessThan(float(0.5));");
    expect(staticGridSource).not.toContain("const dither: TslNode");
    expect(staticGridSource).not.toContain("return slope.greaterThan(limit)");
  });

  it("reuses the shared ramp discard helper on the atlas path", () => {
    expect(atlasGridSource).toContain("buildWaterRampDiscard");
    expect(atlasGridSource).not.toContain("return slope.greaterThan(limit)");
  });
});
