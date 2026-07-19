import { describe, expect, it } from "vitest";
import computeSource from "./stone_scatter_compute.ts?raw";
import { composeStoneScatterShader } from "./wgsl_modules.js";

describe("stone-grass contact patch wiring", () => {
  it("composes both contact entry points into the stone scatter shader", () => {
    const shader = composeStoneScatterShader();
    expect(shader).toContain("fn select_contact_patches");
    expect(shader).toContain("fn rasterize_contact_field");
    expect(shader).toContain("grass_contact_patches[STONE_CONTACT_FIELD_OFFSET + field_index]");
  });

  it("creates and dispatches the contact field raster pipeline", () => {
    // The raster pass fills the field the grass material reads; without this
    // dispatch the whole contact effect silently reads zeros.
    expect(computeSource).toContain("makePipeline(\"rasterize_contact_field\")");
    expect(computeSource).toContain("rasterize_contact_field: rasterizeContactField");
    expect(computeSource).toContain("pass.setPipeline(this.pipelines.rasterize_contact_field)");
    expect(computeSource).toContain("pass.setPipeline(this.pipelines.select_contact_patches)");
  });
});
