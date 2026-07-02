import { describe, expect, it } from "vitest";
import {
  clampGrassDepthPrepassTier,
  DEFAULT_GRASS_DEPTH_PREPASS_TIER,
  grassDepthPrepassTierLabel,
} from "./grass_depth_prepass_runtime.js";

describe("grass depth prepass runtime helpers", () => {
  it("clamps tier to the supported range", () => {
    expect(clampGrassDepthPrepassTier(-1)).toBe(0);
    expect(clampGrassDepthPrepassTier(0)).toBe(0);
    expect(clampGrassDepthPrepassTier(1)).toBe(1);
    expect(clampGrassDepthPrepassTier(2)).toBe(2);
    expect(clampGrassDepthPrepassTier(3)).toBe(2);
    expect(clampGrassDepthPrepassTier(Number.NaN)).toBe(DEFAULT_GRASS_DEPTH_PREPASS_TIER);
  });

  it("labels tiers for lil-gui/debug output", () => {
    expect(grassDepthPrepassTierLabel(0)).toBe("off");
    expect(grassDepthPrepassTierLabel(1)).toBe("near");
    expect(grassDepthPrepassTierLabel(2)).toBe("near+mid");
    expect(grassDepthPrepassTierLabel(99)).toBe("near+mid");
  });
});
