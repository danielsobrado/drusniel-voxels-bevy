import { describe, expect, it } from "vitest";
import waterNodeSource from "./waterNodeMaterial.ts?raw";

describe("water reflection normal contract", () => {
  it("uses the stabilized fresnel normal for the fake sky reflection", () => {
    expect(waterNodeSource).toContain("reflect(viewDir.negate(), fresnelNormal)");
  });
});
