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
    expect(shader).not.toContain("DRESSING_WORKGROUP_SIZE: u32 = 64u");
  });

  it("rejects saved persistent identities before parent-derived emission", () => {
    const shader = composeDressingGpuShader();
    expect(shader).toContain("@group(0) @binding(15) var<storage, read> persistent_exclusions");
    expect(shader).toContain("fn dressing_identity_excluded");
    expect(shader).toContain("class_data.class_meta.y == DRESSING_PERSISTENT_OWNERSHIP && dressing_identity_excluded(identity)");
    expect(shader).toContain("pairing_roll >= pairing_probability || dressing_identity_excluded(stump_identity)");
    const exclusionIndex = shader.indexOf("dressing_identity_excluded(identity)");
    const parentEmissionIndex = shader.indexOf("emit_paired_stump(class_index");
    expect(exclusionIndex).toBeGreaterThanOrEqual(0);
    expect(parentEmissionIndex).toBeGreaterThan(exclusionIndex);
  });

  it("avoids Dawn-reserved identifiers and ambiguous bitwise precedence", () => {
    const shader = composeDressingGpuShader();
    expect(shader).not.toMatch(/\blet\s+class\b/);
    expect(shader).not.toMatch(/\blet\s+meta\b/);
    expect(shader).not.toContain(".meta");
    expect(shader).toContain("channel ^ (class_id * 0x9e3779b9u)");
  });
});
