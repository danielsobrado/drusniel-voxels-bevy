import { describe, expect, it } from "vitest";
import stoneSource from "./shaders/stone_scatter.compute.wgsl?raw";
import { withRiverEcologyConstants } from "./wgsl_river_ecology_transforms.js";
import { withUnderwaterRiverCobbles } from "./stone_river_cobble_wgsl_transform.js";

describe("underwater river cobble WGSL transform", () => {
  const shader = withUnderwaterRiverCobbles(withRiverEcologyConstants(stoneSource));

  it("requires canonical river body kind and Layout B flow", () => {
    expect(shader).toContain("const HYDROLOGY_BODY_RIVER: u32 = 3u;");
    expect(shader).toContain("fields.body_kind != HYDROLOGY_BODY_RIVER");
    expect(shader).toContain("textureSampleLevel(hydro_fields_texture");
    expect(shader).toContain("textureLoad(hydro_fields_atlas_texture");
    expect(shader).toContain("StoneHydrologyFieldsSample(length(fields.xy), body_kind, 1.0)");
  });

  it("does not sample Layout B while the feature is disabled", () => {
    expect(shader).toContain("if (params.counts_a.w != 0u)");
    expect(shader).toContain("hydro_fields = hydrology_fields_at(wpos.x, wpos.y);");
    expect(shader).not.toContain("let hydro_fields = hydrology_fields_at(wpos.x, wpos.y);");
  });

  it("restricts underwater candidates to cobble variants and non-large classes", () => {
    expect(shader).toContain("fn pick_river_cobble_class");
    expect(shader).toContain("return select(CLASS_MEDIUM, CLASS_SMALL");
    expect(shader).toContain("let variant = select(sampled_variant, 0u, underwater_cobble);");
  });

  it("preserves underwater metadata through view compaction", () => {
    expect(shader).toContain("const STONE_META_UNDERWATER_FLAG: f32 = 16.0;");
    expect(shader).toContain("let underwater = meta_lane >= STONE_META_UNDERWATER_FLAG;");
    expect(shader).toContain("sink_depth + underwater_meta");
  });

  it("fails closed when the source contract changes", () => {
    expect(() => withUnderwaterRiverCobbles("@compute fn scatter_stones() {}"))
      .toThrow(/anchor missing/);
  });
});
