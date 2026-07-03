import { describe, expect, it } from "vitest";
import waterNodeMaterialSource from "./waterNodeMaterial.ts?raw";
import waterPerfNodeMaterialSource from "./waterPerfNodeMaterial.ts?raw";
import { WATER_FRAG } from "./water_material_uniforms.js";

describe("water shader world bounds", () => {
  it("only applies the WebGL world-bounds discard when bounds are finite", () => {
    expect(WATER_FRAG).toContain("bool finiteWorldBounds = uWorldBounds.x > 0.0 && uWorldBounds.y > 0.0;");
    expect(WATER_FRAG).toContain("if (finiteWorldBounds && (worldPos.x < 0.0");
  });

  it("only applies the default WebGPU world-bounds discard when bounds are finite", () => {
    expect(waterNodeMaterialSource).toContain("const finiteWorldBounds: TslNode = uWorldBounds.x.greaterThan(float(0)).and(uWorldBounds.y.greaterThan(float(0)));");
    expect(waterNodeMaterialSource).toContain("const outsideWorld: TslNode = finiteWorldBounds.and(");
  });

  it("only applies the perf WebGPU world-bounds discard when bounds are finite", () => {
    expect(waterPerfNodeMaterialSource).toContain("const finiteWorldBounds: TslNode = uWorldBounds.x.greaterThan(float(0)).and(uWorldBounds.y.greaterThan(float(0)));");
    expect(waterPerfNodeMaterialSource).toContain("const outsideWorld: TslNode = finiteWorldBounds.and(");
  });
});
