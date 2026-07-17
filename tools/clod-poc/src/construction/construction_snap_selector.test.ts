import { describe, expect, it } from "vitest";
import { ConstructionSnapSelector } from "./construction_snap_selector.js";
import type { ConstructionSnapResult } from "./types.js";

function candidate(key: string, rayDistanceM: number, score: number): ConstructionSnapResult {
  return {
    key,
    rayDistanceM,
    score,
    target: {
      entityId: "target",
      pieceTypeId: "floor",
      snapIndex: 0,
      worldPos: [0, 0, 0],
      worldDirection: [0, 1, 0],
      group: "generic",
      accepts: ["generic"],
    },
    sourceSnapIndex: 0,
    worldPosition: [0, 0, 0],
    rotationQuarterTurns: 0,
  };
}

describe("ConstructionSnapSelector", () => {
  it("holds the current snap inside the release radius", () => {
    const selector = new ConstructionSnapSelector();
    expect(selector.select([candidate("a", 0.4, 2), candidate("b", 0.5, 1)], 0.85, 1.35)?.key).toBe("a");
    expect(selector.select([candidate("b", 0.2, 5), candidate("a", 1.0, 1)], 0.85, 1.35)?.key).toBe("a");
  });

  it("cycles deterministically through nearby candidates", () => {
    const selector = new ConstructionSnapSelector();
    selector.select([candidate("a", 0.3, 2), candidate("b", 0.4, 1)], 0.85, 1.35);
    selector.cycle(1);
    expect(selector.select([candidate("a", 0.3, 2), candidate("b", 0.4, 1)], 0.85, 1.35)?.key).toBe("b");
  });
});
