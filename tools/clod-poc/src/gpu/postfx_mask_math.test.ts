import { describe, expect, it } from "vitest";
import { POSTPROCESS_SHADER_TEST_HOOKS } from "../environment/postprocess.js";
import { inverseSmoothstepReference } from "./postfx_mask_math.js";

describe("inverseSmoothstepReference", () => {
  it("decreases monotonically across ordered edges", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((value) =>
      inverseSmoothstepReference(0, 1, value)
    );

    expect(samples[0]).toBe(1);
    expect(samples.at(-1)).toBe(0);
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]).toBeLessThanOrEqual(samples[index - 1]);
    }
  });

  it("clamps outside the transition range", () => {
    expect(inverseSmoothstepReference(10, 20, 5)).toBe(1);
    expect(inverseSmoothstepReference(10, 20, 25)).toBe(0);
  });

  it("keeps the WebGL shaft falloff on ordered edges", () => {
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment)
      .toContain("1.0 - smoothstep(0.0, 1.4, length(vUv - uSunScreen))");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment)
      .not.toContain("smoothstep(1.4, 0.0");
  });
});
