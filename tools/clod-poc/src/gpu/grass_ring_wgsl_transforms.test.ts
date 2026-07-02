import { describe, expect, it } from "vitest";
import { withConservativeGrassFrustum, withGrassActiveSlotList } from "./grass_ring_wgsl_transforms.js";

describe("grass ring WGSL transforms", () => {
  it("wires legacy one-line grass cull shaders to the active-slot list", () => {
    const source = `
@group(0) @binding(10) var hydro_sampler: sampler;
fn grass_cull(@builtin(global_invocation_id) id: vec3<u32>) { process_slot(id.x); }
`;
    const transformed = withGrassActiveSlotList(source);

    expect(transformed).toContain("@group(0) @binding(11) var<storage, read> active_slots: array<u32>;");
    expect(transformed).toContain("let slot = active_slots[id.x]");
    expect(transformed).toContain("process_slot(slot)");
    expect(transformed).not.toContain("process_slot(id.x)");
  });

  it("accepts already-wired grass cull shaders", () => {
    const source = `
@group(0) @binding(10) var hydro_sampler: sampler;
@group(0) @binding(11) var<storage, read> active_slots: array<u32>;
fn grass_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = active_slots[id.x];
  if (slot == 4294967295u) { return; }
  process_slot(slot);
}
`;

    expect(() => withGrassActiveSlotList(source)).not.toThrow();
  });

  it("updates the current frustum rejection slack", () => {
    const transformed = withConservativeGrassFrustum(
      "if (!in_frustum(vec3<f32>(wpos.x, height + 0.5, wpos.y), 1.4)) { return; }",
    );

    expect(transformed).toContain("max(6.0, params.settings_a.x * 0.75)");
  });
});
