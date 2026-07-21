import { describe, expect, it } from "vitest";
import {
  DRESSING_GPU_GROUP_COUNT,
  DRESSING_GPU_LOD_COUNT,
  DRESSING_GPU_RECORD_VEC4S,
} from "./layouts.js";
import { dressingGrassContactShader } from "./dressing_grass_contact_compute.js";

const shader = dressingGrassContactShader();

describe("dressing grass-contact compute", () => {
  it("reads only compacted accepted records", () => {
    expect(shader).toContain("let accepted = min(indirect_args[group * INDIRECT_WORDS + 1u], capacity)");
    expect(shader).toContain("if (slot >= accepted) { return; }");
    expect(shader).toContain(`const LOD_COUNT: u32 = ${DRESSING_GPU_LOD_COUNT}u`);
    expect(shader).toContain(`const RECORD_VEC4S: u32 = ${DRESSING_GPU_RECORD_VEC4S}u`);
    expect(DRESSING_GPU_GROUP_COUNT).toBe(87);
  });

  it("clears then atomically rasterizes one shared field", () => {
    expect(shader).toContain("fn clear_field");
    expect(shader).toContain("atomicStore(&field[index], 0u)");
    expect(shader).toContain("fn rasterize_records");
    expect(shader).toContain("atomicMax(&field[field_index], packed)");
  });

  it("uses scale-aware radial policies without readback code", () => {
    expect(shader).toContain("policy.x * max(position_scale.w, 0.01)");
    expect(shader).toContain("1.0 - smoothstep(inner, radius, distance_m)");
    expect(shader).not.toMatch(/mapAsync|getMappedRange|copyBufferToBuffer/);
  });
});
