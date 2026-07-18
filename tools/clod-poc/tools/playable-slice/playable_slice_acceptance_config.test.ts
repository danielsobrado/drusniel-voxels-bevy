import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYABLE_SLICE_RUNS,
  MAX_PLAYABLE_SLICE_RUNS,
  parsePlayableSliceAcceptanceConfig,
} from "./playable_slice_acceptance_config.js";

describe("parsePlayableSliceAcceptanceConfig", () => {
  it("uses both modes and the default run count", () => {
    expect(parsePlayableSliceAcceptanceConfig([])).toEqual({
      runs: DEFAULT_PLAYABLE_SLICE_RUNS,
      modes: ["diagnostic", "continuous"],
    });
  });

  it("accepts an explicit mode and run count", () => {
    expect(parsePlayableSliceAcceptanceConfig(["--mode=continuous", "--runs=3"])).toEqual({
      runs: 3,
      modes: ["continuous"],
    });
  });

  it.each([
    { args: ["--runs=0"] },
    { args: ["--runs=1.5"] },
    { args: [`--runs=${MAX_PLAYABLE_SLICE_RUNS + 1}`] },
    { args: ["--runs=abc"] },
    { args: ["--mode=fast"] },
    { args: ["--unknown=1"] },
    { args: ["--mode=continuous", "--mode=diagnostic"] },
  ])("rejects invalid arguments: $args", ({ args }) => {
    expect(() => parsePlayableSliceAcceptanceConfig(args)).toThrow();
  });
});
