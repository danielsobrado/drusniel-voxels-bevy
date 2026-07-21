import { describe, expect, it } from "vitest";
import { composeDressingGpuShader } from "../../../gpu/wgsl_modules.js";

describe("dressing GPU shader", () => {
  it("uses canonical mirrors and owns generation, acceptance, compaction and indirect draws", () => {
    const shader = composeDressingGpuShader();
    expect(shader).toContain("placement_ground_height");
    expect(shader).toContain("canonical_height_atlas");
    expect(shader).toContain("canopy_detail_texture");
    expect(shader).toContain("fn dressing_environment_acceptance");
    expect(shader).toContain("fn emit_parent_attachments");
    expect(shader).toContain("fn emit_paired_stump");
    expect(shader).toContain("fn dressing_stable_identity");
    expect(shader).toContain("0x4100u + class_index + 1u");
    expect(shader).toContain("endpoint_a");
    expect(shader).toContain("fn generate_and_compact");
    expect(shader).toContain("fn generate_persistent");
    expect(shader).toContain("fn generate_terrain");
    expect(shader).toContain("fn build_indirect_args");
    expect(shader).toContain("const DRESSING_WORKGROUP_SIZE: u32 = 64u");
    expect(composeDressingGpuShader(32)).toContain("const DRESSING_WORKGROUP_SIZE: u32 = 32u");
  });

  it("avoids Dawn-reserved identifiers and ambiguous bitwise precedence", () => {
    const shader = composeDressingGpuShader();
    expect(shader).not.toMatch(/\blet\s+class\b/);
    expect(shader).not.toMatch(/\blet\s+meta\b/);
    expect(shader).not.toContain(".meta");
    expect(shader).toContain("channel ^ (class_id * 0x9e3779b9u)");
  });
});
