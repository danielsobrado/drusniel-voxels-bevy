import { describe, expect, it } from "vitest";
import {
  playableSliceDiscoveryUrl,
  playableSliceGameplayUrl,
} from "./playable_slice_acceptance_environment.js";

describe("playable slice acceptance URLs", () => {
  it("keeps diagnostics visible for discovery but masks them during public gameplay", () => {
    const discovery = new URL(playableSliceDiscoveryUrl());
    const gameplay = new URL(playableSliceGameplayUrl("test-save", {
      spawn: [0, 0],
      yaw: 0,
      direction: [1, 0],
      boundary: [8, 0],
      boundaryDistanceM: 8,
      waterEntry: [16, 0],
      riverCenter: [24, 0],
      riverEnd: [32, 0],
      pageSizeM: 64,
    }));

    expect(discovery.searchParams.get("hud")).toBe("1");
    expect(gameplay.searchParams.get("hud")).toBeNull();
    expect(gameplay.searchParams.get("acceptance")).toBe("1");
  });
});
