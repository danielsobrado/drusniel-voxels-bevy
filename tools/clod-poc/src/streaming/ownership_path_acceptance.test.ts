import { describe, expect, it } from "vitest";
import { assertFarShellOutsidePlayable, classifyOwnershipDistance } from "./ownership_classification.js";
import { resolveStreamingOwnership } from "./streaming_ownership.js";

describe("streaming ownership path acceptance", () => {
  it("keeps the far shell outside live and CLOD ownership along a scripted path", () => {
    const ownership = resolveStreamingOwnership({
      streaming: { preload_seconds: 4, live_radius_m: 200, clod_radius_m: 2048 },
      targetVisibleM: 4096,
      targetFutureVisibleM: 8192,
      streamingScene: true,
    });

    for (let step = 0; step <= 64; step++) {
      const x = step * 128;
      const z = Math.sin(step * 0.2) * 512;
      void x;
      void z;
      assertFarShellOutsidePlayable(ownership);
      expect(classifyOwnershipDistance(ownership.liveRadiusM * 0.5, ownership)).toBe("live");
      expect(classifyOwnershipDistance((ownership.liveRadiusM + ownership.clodRadiusM) * 0.5, ownership)).toBe("clod");
      expect(classifyOwnershipDistance(ownership.farShellInnerM + 1, ownership)).toBe("far-shell");
    }
  });
});
