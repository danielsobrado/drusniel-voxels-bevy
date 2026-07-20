import { describe, expect, it } from "vitest";
import grassRingEntry from "./shaders/grass_ring.compute.wgsl?raw";
import { withGrassSunVisibility } from "./grass_sun_visibility_wgsl_transform.js";
import { composeGrassRingShader } from "./wgsl_modules.js";

describe("grass canonical forest lighting WGSL", () => {
  it("applies accepted-canopy lighting to direct sun and density", () => {
    const source = withGrassSunVisibility(grassRingEntry);

    expect(source).toContain("@group(0) @binding(16) var forest_lighting_texture");
    expect(source).toContain("fn sample_grass_forest_lighting");
    expect(source).toContain("fn grass_sun_visibility");
    expect(source).toContain("fn grass_forest_density_multiplier");
    expect(source).toContain("terrain_density * grass_forest_density_multiplier");
    expect(source).toContain("grass_sun_visibility(wpos)");
  });

  it("is composed into the production grass shader", () => {
    const source = composeGrassRingShader();

    expect(source).toContain("fn grass_forest_density_multiplier");
    expect(source).toContain("textureLoad(forest_lighting_texture");
  });

  it("is idempotent", () => {
    const once = withGrassSunVisibility(grassRingEntry);
    expect(withGrassSunVisibility(once)).toBe(once);
  });
});
