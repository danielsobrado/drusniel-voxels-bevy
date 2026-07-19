import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WATER_NODE_SOURCE = readFileSync(new URL("./waterNodeMaterial.ts", import.meta.url), "utf8");
const FOAM_NODE_SOURCE = readFileSync(new URL("./water_foam_nodes.ts", import.meta.url), "utf8");

describe("HQ water foam shader contract", () => {
  it("uses the shared coherent texture path", () => {
    expect(WATER_NODE_SOURCE).toContain("buildWaterFoamNodes");
    expect(FOAM_NODE_SOURCE).toContain("getWaterFoamNoiseTexture");
    expect(WATER_NODE_SOURCE).not.toContain("foamHashA1");
  });

  it("requires speed and drop together for rapid eligibility", () => {
    expect(WATER_NODE_SOURCE).toContain("rapidSpeed.mul(rapidDrop).mul(riverWeight)");
    expect(FOAM_NODE_SOURCE).toContain("input.rapidSpeed.mul(input.rapidDrop).mul(input.riverWeight)");
  });

  it("applies the breakup pattern to every foam source without a floor", () => {
    expect(FOAM_NODE_SOURCE).toContain("source.mul(pattern).mul(wetFade)");
    expect(WATER_NODE_SOURCE).not.toContain("float(0.18).add(breakup.mul(0.82))");
  });

  it("preserves the newer scatter and glitter optics", () => {
    expect(WATER_NODE_SOURCE).toContain("buildWaterSuspendedScatter");
    expect(WATER_NODE_SOURCE).toContain("buildWaterGlitter");
  });

  it("modulates foam brightness from the water environment", () => {
    expect(WATER_NODE_SOURCE).toContain("waterLuminance");
    expect(WATER_NODE_SOURCE).toContain("const litFoam");
  });
});
