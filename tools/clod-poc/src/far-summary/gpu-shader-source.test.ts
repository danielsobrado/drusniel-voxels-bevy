import { describe, expect, it } from "vitest";
import shaderCode from "./shaders/far_summary_build.wgsl?raw";

describe("far summary WGSL shader source", () => {
  it("does not use reserved WGSL identifiers as struct fields", () => {
    expect(shaderCode).not.toMatch(/\bmeta\s*:/);
    expect(shaderCode).not.toMatch(/\.meta\b/);
  });
});
