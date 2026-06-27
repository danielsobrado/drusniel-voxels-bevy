import { describe, expect, it } from "vitest";
import { DEEP_OCEAN_WGSL } from "./deepOcean.js";

describe("deep ocean transition gap", () => {
  it("keeps the GPU-node ocean invisible until the configured gap ends", () => {
    expect(DEEP_OCEAN_WGSL).toContain("transition_end");
    expect(DEEP_OCEAN_WGSL).toContain("transition_fade");
    expect(DEEP_OCEAN_WGSL).toContain("smoothstep(transition_end, transition_end + transition_fade, outside_distance)");
  });
});
