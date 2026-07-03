import { describe, expect, it } from "vitest";
import { WATER_FRAG } from "./water_material_uniforms.js";

describe("water shader world bounds", () => {
  it("only applies the WebGL world-bounds discard when bounds are finite", () => {
    expect(WATER_FRAG).toContain("bool finiteWorldBounds = uWorldBounds.x > 0.0 && uWorldBounds.y > 0.0;");
    expect(WATER_FRAG).toContain("if (finiteWorldBounds && (worldPos.x < 0.0");
  });
});
