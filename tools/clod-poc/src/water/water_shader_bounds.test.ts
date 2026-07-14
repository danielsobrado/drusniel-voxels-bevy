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

  it("fades perf shoreline foam across partially wet edge fragments", () => {
    expect(waterPerfNodeMaterialSource).toContain(
      "const wetFade: TslNode = smoothstep(0.005, 0.05, depth).mul(aBodyMask);",
    );
    expect(waterPerfNodeMaterialSource).toContain(
      "bankContact.mul(wetFade).mul(foamBreakup).mul(uFoamShoreStrength)",
    );
    expect(waterPerfNodeMaterialSource).toContain(
      "const shoreDetailFade: TslNode = float(1).sub(smoothstep(0.25, 1.25, aLevel));",
    );
    expect(waterPerfNodeMaterialSource).not.toContain("const foamHash:");
  });
});
