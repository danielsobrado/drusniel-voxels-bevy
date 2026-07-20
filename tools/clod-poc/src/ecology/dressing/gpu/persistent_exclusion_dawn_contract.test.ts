import { describe, expect, it } from "vitest";
import { composeDressingGpuShader } from "../../../gpu/wgsl_modules.js";

describe("dressing exclusion Dawn WGSL contract", () => {
  it("uses explicit scalar occupancy and bounded probing", () => {
    const shader = composeDressingGpuShader();
    expect(shader).toContain("array<vec4<u32>>");
    expect(shader).toContain("entry.z == 0u");
    expect(shader).toContain("probe < capacity");
    expect(shader).not.toContain("atomic<vec");
    expect(shader).not.toContain("while (true)");
  });
});
