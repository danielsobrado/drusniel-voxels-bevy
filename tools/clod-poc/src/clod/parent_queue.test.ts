import { describe, expect, it } from "vitest";
import { nextPendingParentLevelOrdered } from "./parent_queue.js";

describe("nextPendingParentLevelOrdered", () => {
  it("drains the lowest pending level first", () => {
    const pending = new Map<number, Set<string>>([
      [1, new Set(["0,0", "1,0"])],
      [2, new Set(["0,0"])],
    ]);
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 1, key: "0,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 1, key: "1,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 2, key: "0,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toBeNull();
  });

  it("blocks higher levels while a lower level still has pending siblings", () => {
    const pending = new Map<number, Set<string>>([
      [1, new Set(["1,0"])],
      [2, new Set(["0,0", "1,0"])],
    ]);
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 1, key: "1,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 2, key: "0,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toEqual({ level: 2, key: "1,0" });
    expect(nextPendingParentLevelOrdered(pending, 3)).toBeNull();
  });
});
