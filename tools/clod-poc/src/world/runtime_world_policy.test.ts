import { describe, expect, it } from "vitest";
import { usesCameraRelativeRuntimeWorld, usesStreamingRuntimeWorld } from "./runtime_world_policy.js";

describe("runtime world policy", () => {
  it.each(["infinite-islands", "continent", "cave-test", "rpg-village", "rpg-player-base"])(
    "keeps %s runtime rings on the canonical world center",
    (scene) => expect(usesCameraRelativeRuntimeWorld(scene)).toBe(true),
  );

  it("keeps finite scenes bounded by their startup world", () => {
    expect(usesCameraRelativeRuntimeWorld("sanity")).toBe(false);
    expect(usesCameraRelativeRuntimeWorld(null)).toBe(false);
  });

  it.each(["infinite-islands", "infinite-stream-fast-turn", "continent", "rpg-village", "rpg-player-base"])(
    "classifies %s as a streaming runtime world",
    (scene) => expect(usesStreamingRuntimeWorld(scene)).toBe(true),
  );

  it("does not conflate camera-relative test scenes with streaming worlds", () => {
    expect(usesStreamingRuntimeWorld("cave-test")).toBe(false);
    expect(usesStreamingRuntimeWorld("sanity")).toBe(false);
  });
});
