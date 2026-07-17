import { describe, expect, it } from "vitest";
import { expandClodOwnershipToLevelZero } from "./clod_ownership_keys.js";

describe("expandClodOwnershipToLevelZero", () => {
  it("preserves level-zero pages", () => {
    expect(expandClodOwnershipToLevelZero(["L0:2,-3"])).toEqual(["L0:2,-3"]);
  });

  it("expands coarse active pages into complementary level-zero coverage", () => {
    expect(expandClodOwnershipToLevelZero(["L1:1,-1"])).toEqual([
      "L0:2,-2",
      "L0:2,-1",
      "L0:3,-2",
      "L0:3,-1",
    ]);
  });

  it("deduplicates mixed refinement levels and ignores malformed keys", () => {
    expect(expandClodOwnershipToLevelZero([
      "L1:0,0",
      "L0:0,0",
      "bad",
    ])).toEqual([
      "L0:0,0",
      "L0:0,1",
      "L0:1,0",
      "L0:1,1",
    ]);
  });
});
