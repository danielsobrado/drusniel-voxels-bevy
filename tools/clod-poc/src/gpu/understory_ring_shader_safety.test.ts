import { describe, expect, it } from "vitest";
import shaderSource from "./shaders/understory_ring.compute.wgsl?raw";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";

describe("understory ring shader safety", () => {
  it("avoids unsigned underflow when selecting indirect index counts", () => {
    // Group index counts use lane math (group / 4, group % 4) so no unsigned
    // subtraction can underflow.
    expect(shaderSource).toContain("params.group_index_counts[group / 4u]");
    expect(shaderSource).toContain("let lane = group % 4u;");
    expect(shaderSource).not.toContain("group - 4u");
  });

  it("uses active-slot dispatch in the composed shader", () => {
    const shader = composeUnderstoryRingShader(64);

    expect(shader).toContain("var<storage, read> active_slots: array<u32>");
    expect(shader).toContain("let slot = active_slots[id.x]");
    expect(shader).not.toContain("process_understory_slot(id.x)");
  });
});
