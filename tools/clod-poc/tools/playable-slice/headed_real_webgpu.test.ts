import { describe, expect, it } from "vitest";
import { softwareGpuReason } from "./headed_real_webgpu.js";

const HARDWARE = {
  vendor: "NVIDIA",
  architecture: "ada",
  device: "RTX 4090",
  description: "Discrete GPU",
  fallbackAdapter: false,
};

describe("headed real WebGPU certification", () => {
  it("accepts a non-fallback hardware adapter", () => {
    expect(softwareGpuReason(HARDWARE)).toBeNull();
  });

  it("rejects fallback adapters even without a software name", () => {
    expect(softwareGpuReason({ ...HARDWARE, fallbackAdapter: true })).toContain("isFallbackAdapter=true");
  });

  it("rejects adapters whose identity cannot be certified", () => {
    expect(softwareGpuReason({
      vendor: "",
      architecture: "",
      device: "",
      description: "",
      fallbackAdapter: false,
    })).toContain("identity is unavailable");
  });

  it.each([
    ["Google", "", "SwiftShader Device", ""],
    ["Mesa", "llvmpipe", "", ""],
    ["Mesa", "", "lavapipe", ""],
    ["", "", "", "Software Rasterizer"],
    ["Microsoft", "", "Microsoft Basic Render Driver", ""],
    ["Microsoft", "", "WARP Adapter", ""],
  ])("rejects named software adapters", (vendor, architecture, device, description) => {
    expect(softwareGpuReason({ vendor, architecture, device, description, fallbackAdapter: false }))
      .toContain("software GPU marker");
  });
});
