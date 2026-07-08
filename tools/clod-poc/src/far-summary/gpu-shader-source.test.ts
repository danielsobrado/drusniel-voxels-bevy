import { describe, expect, it } from "vitest";
import shaderEntry from "./shaders/far_summary_build.wgsl?raw";
import { composeFarSummaryGpuBuildShader } from "./gpu-shader.js";

describe("far summary WGSL shader source", () => {
  it("does not use reserved WGSL identifiers as struct fields", () => {
    const shaderCode = composeFarSummaryGpuBuildShader();
    expect(shaderCode).not.toMatch(/\bmeta\s*:/);
    expect(shaderCode).not.toMatch(/\.meta\b/);
  });

  it("uses the shared terrain field instead of synthetic placeholder heights", () => {
    const shaderCode = composeFarSummaryGpuBuildShader();
    expect(shaderCode).toContain("fn surfaceHeightField");
    expect(shaderCode).toContain("sampleIslandMaskField");
    expect(shaderCode).toContain("classifyBiomeMaterial");
    expect(shaderEntry).not.toContain("synthetic_height");
  });

  it("declares the far-summary terrain field bindings", () => {
    const shaderCode = composeFarSummaryGpuBuildShader();
    expect(shaderCode).toContain("@group(0) @binding(2) var<storage, read> digEdits");
    expect(shaderCode).toContain("@group(0) @binding(3) var<uniform> fieldParams");
  });
});
