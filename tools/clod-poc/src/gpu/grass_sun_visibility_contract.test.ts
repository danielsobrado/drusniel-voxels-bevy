import { describe, expect, it } from "vitest";
import materialSource from "./grass_node_material.ts?raw";
import { composeGrassRingShader } from "./wgsl_modules.js";

describe("grass per-blade sun visibility", () => {
  it("stores one constant visibility value per accepted blade", () => {
    const shader = composeGrassRingShader();

    expect(shader).toContain("out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, grass_sun_visibility(wpos))");
    expect(shader.match(/grass_sun_visibility\(wpos\)/g)).toHaveLength(1);
  });

  it("attenuates direct sun without changing hemisphere or transmission light", () => {
    expect(materialSource).toContain("const aSunVisibility: TslNode = ring ? clamp(aOffset4.w, 0.0, 1.0) : float(1)");
    expect(materialSource).toContain("uSun.mul(sun.mul(0.58).add(wrap.mul(0.22))).mul(aSunVisibility)");
    expect(materialSource).toContain("uSun.mul(pow(sun, 1.25)).mul(0.82).mul(aSunVisibility)");
    expect(materialSource).not.toContain("hemi.mul(aSunVisibility)");
    expect(materialSource).not.toContain("transmission.mul(aSunVisibility)");
  });
});
