import { describe, expect, it } from "vitest";
import {
  assertFarShellOutsidePlayable,
  assertGameplayOwnershipDistance,
  classifyOwnershipDistance,
  ownsGameplayAtDistance,
} from "./ownership_classification.js";
import type { StreamingOwnershipRadii } from "./streaming_ownership.js";

const ownership: StreamingOwnershipRadii = {
  liveRadiusM: 200,
  clodRadiusM: 2048,
  farShellInnerM: 2048,
  farShellOuterM: 8192,
  targetVisibleM: 4096,
  targetFutureVisibleM: 8192,
  streamingScene: true,
};

describe("streaming ownership classifier", () => {
  it("classifies live, CLOD, and far shell distances", () => {
    expect(classifyOwnershipDistance(50, ownership)).toBe("live");
    expect(classifyOwnershipDistance(400, ownership)).toBe("clod");
    expect(classifyOwnershipDistance(3000, ownership)).toBe("far-shell");
  });

  it("accepts a far shell outside playable ownership", () => {
    expect(() => assertFarShellOutsidePlayable(ownership)).not.toThrow();
  });

  it("rejects overlap between far shell and playable ownership", () => {
    expect(() => assertFarShellOutsidePlayable({ ...ownership, farShellInnerM: 1000 })).toThrow(/Far shell/i);
  });

  it("rejects gameplay ownership beyond CLOD", () => {
    expect(ownsGameplayAtDistance(100, ownership)).toBe(true);
    expect(ownsGameplayAtDistance(1000, ownership)).toBe(true);
    expect(ownsGameplayAtDistance(3000, ownership)).toBe(false);
    expect(() => assertGameplayOwnershipDistance(3000, ownership)).toThrow(/Gameplay ownership/i);
  });
});
