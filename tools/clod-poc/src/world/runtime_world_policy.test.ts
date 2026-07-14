import { describe, expect, it } from "vitest";
import { usesCameraRelativeRuntimeWorld } from "./runtime_world_policy.js";

describe("runtime world policy", () => {
  it.each(["infinite-islands", "continent", "cave-test"])(
    "keeps %s runtime rings on the canonical world center",
    (scene) => expect(usesCameraRelativeRuntimeWorld(scene)).toBe(true),
  );

  it("keeps finite scenes bounded by their startup world", () => {
    expect(usesCameraRelativeRuntimeWorld("sanity")).toBe(false);
    expect(usesCameraRelativeRuntimeWorld(null)).toBe(false);
  });
});
