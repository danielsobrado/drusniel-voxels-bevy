import { describe, expect, it } from "vitest";
import { resolveGrassGpuPresentation } from "./grass_gpu_presentation.js";

describe("grass GPU presentation", () => {
  it("keeps CPU grass while GPU draw resources are warming", () => {
    expect(resolveGrassGpuPresentation(true, false)).toBe("warming");
  });

  it("switches only after a GPU draw becomes visible", () => {
    expect(resolveGrassGpuPresentation(true, true)).toBe("rendering");
  });

  it("falls back when the GPU update is rejected", () => {
    expect(resolveGrassGpuPresentation(false, false)).toBe("unavailable");
  });
});
