import { describe, expect, it } from "vitest";
import { planVisualTiles } from "./visual_plan.js";
import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";

const ownership: StreamingOwnershipRadii = {
  liveRadiusM: 16,
  clodRadiusM: 64,
  farShellInnerM: 64,
  farShellOuterM: 128,
  targetVisibleM: 128,
  targetFutureVisibleM: 128,
  streamingScene: true,
};

describe("visual stream planning", () => {
  it("keeps visual tiles outside the live radius and inside the CLOD radius", () => {
    const keys = planVisualTiles({ x: 0, z: 0 }, ownership, { tileSizeM: 16, maxLevel: 0 });

    expect(keys.length).toBeGreaterThan(0);
    expect(keys).not.toContain("0:0,0");
    expect(keys).toContain("0:3,0");
  });
});
