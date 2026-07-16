import { describe, expect, it } from "vitest";
import thermalShader from "./erosion_thermal.compute.wgsl?raw";

describe("erosion WGSL shader source", () => {
  it("does not use the reserved target identifier for the thermal destination", () => {
    expect(thermalShader).not.toMatch(/\b(?:var|let)\s+target\b/);
    expect(thermalShader).toContain("target_index");
  });
});
