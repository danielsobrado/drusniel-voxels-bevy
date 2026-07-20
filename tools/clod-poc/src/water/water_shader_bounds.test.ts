import { describe, expect, it } from "vitest";
import waterNodeMaterialSource from "./waterNodeMaterial_base.ts?raw";
import waterPerfNodeMaterialSource from "./waterPerfNodeMaterial.ts?raw";
import waterFoamNodesSource from "./water_foam_nodes.ts?raw";
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
    expect(waterFoamNodesSource).toContain(
      "const wetFade = smoothstep(0.005, 0.05, input.depth).mul(input.bodyMask);",
    );
    expect(waterFoamNodesSource).toContain(
      "source.mul(pattern).mul(wetFade).mul(shadeCoverage).mul(detailFade)",
    );
    expect(waterFoamNodesSource).toContain("buildWaterFoamDistanceFadeNode");
    expect(waterPerfNodeMaterialSource).toContain("const foam: TslNode = foamNodes.coverage");
    expect(waterPerfNodeMaterialSource).not.toContain("farDetailFade");
    expect(waterPerfNodeMaterialSource).not.toContain("const foamHash:");
  });

  it("fades both WebGPU quality tiers into shallow shore water", () => {
    const shoreFade = "const shoreFade: TslNode = smoothstep(float(0.02), float(0.35), depth);";
    expect(waterNodeMaterialSource).toContain(shoreFade);
    expect(waterPerfNodeMaterialSource).toContain(shoreFade);
  });
});
