import { describe, expect, it } from "vitest";
import understoryRingEntry from "./shaders/understory_ring.compute.wgsl?raw";
import { withUnderstoryCanopyEcology } from "./understory_canopy_ecology_wgsl_transform.js";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";

describe("understory canopy ecology WGSL", () => {
  it("replaces synthetic forest authority with the canonical canopy texture", () => {
    const source = withUnderstoryCanopyEcology(understoryRingEntry);

    expect(source).toContain("@group(0) @binding(14) var canopy_ecology_texture");
    expect(source).toContain("fn sample_understory_canopy_ecology");
    expect(source).toContain("textureLoad(canopy_ecology_texture");
    expect(source).toContain("let canopy_ecology = sample_understory_canopy_ecology");
    expect(source).toContain("mix(synthetic_forest_influence, canopy_ecology.x, canopy_ecology.w)");
    expect(source).toContain("mix(synthetic_forest_edge, canopy_ecology.y, canopy_ecology.w)");
  });

  it("is composed into the production understory shader", () => {
    const source = composeUnderstoryRingShader();

    expect(source).toContain("@group(0) @binding(14) var canopy_ecology_texture");
    expect(source).toContain("fn sample_understory_canopy_ecology");
    expect(source).toContain("let forest_influence = mix(synthetic_forest_influence");
  });

  it("is idempotent", () => {
    const once = withUnderstoryCanopyEcology(understoryRingEntry);
    expect(withUnderstoryCanopyEcology(once)).toBe(once);
  });
});
