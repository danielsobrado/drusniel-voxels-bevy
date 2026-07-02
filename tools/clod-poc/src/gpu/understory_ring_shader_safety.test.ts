import { describe, expect, it } from "vitest";
import shaderSource from "./shaders/understory_ring.compute.wgsl?raw";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";

describe("understory ring shader safety", () => {
  it("avoids unsigned underflow when selecting indirect index counts", () => {
    expect(shaderSource).toContain("if (group < 4u)");
    expect(shaderSource).toContain("index_count = params.class_index_counts[group]");
    expect(shaderSource).toContain("index_count = params.settings_extra[group - 4u]");
    expect(shaderSource).not.toContain("select(params.settings_extra[group - 4u]");
  });

  it("uses active-slot dispatch in the composed shader", () => {
    const shader = composeUnderstoryRingShader(64);

    expect(shader).toContain("var<storage, read> active_slots: array<u32>");
    expect(shader).toContain("let slot = active_slots[id.x]");
    expect(shader).not.toContain("process_understory_slot(id.x)");
  });
});
