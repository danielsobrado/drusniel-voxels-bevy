import { describe, expect, it } from "vitest";
import { DEEP_OCEAN_WGSL } from "./deepOcean.js";

describe("deep ocean transition gap", () => {
  it("keeps the GPU-node ocean invisible until the configured gap ends", () => {
    expect(DEEP_OCEAN_WGSL).toContain("start_outside_m");
    expect(DEEP_OCEAN_WGSL).toContain("smoothstep(start_outside_m, start_outside_m + 48.0, outside_distance)");
  });
});
