import { describe, expect, it } from "vitest";
import { cloneWaterConfig, resolveWaterCausticsPolicy } from "./index.js";

describe("water caustics policy", () => {
  it("keeps caustics off by default", () => {
    const config = cloneWaterConfig();
    const policy = resolveWaterCausticsPolicy(config.caustics);

    expect(policy.activeMode).toBe("off");
    expect(policy.computeAvailable).toBe(false);
    expect(policy.proceduralEnabled).toBe(false);
  });

  it("uses procedural shader caustics when enabled", () => {
    const config = cloneWaterConfig();
    config.caustics.enabled = true;
    config.caustics.gain = 1.5;

    const policy = resolveWaterCausticsPolicy(config.caustics);

    expect(policy.activeMode).toBe("procedural_shader");
    expect(policy.computeAvailable).toBe(false);
    expect(policy.gain).toBe(1.5);
    expect(policy.reason).toContain("procedural shader");
  });

  it("clamps exposed tuning values to non-negative stats", () => {
    const config = cloneWaterConfig();
    config.caustics.gain = -1;
    config.caustics.scale = -2;
    config.caustics.speed = -3;

    const policy = resolveWaterCausticsPolicy(config.caustics);

    expect(policy.gain).toBe(0);
    expect(policy.scale).toBe(0);
    expect(policy.speed).toBe(0);
  });
});
