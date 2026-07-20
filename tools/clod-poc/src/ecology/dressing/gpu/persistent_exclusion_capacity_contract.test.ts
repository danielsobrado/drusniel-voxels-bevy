import { describe, expect, it } from "vitest";
import { buildDressingPersistentExclusionTable } from "./persistent_exclusion_table.js";

describe("dressing exclusion capacity", () => {
  it("keeps table load at or below one half", () => {
    const identities = Array.from({ length: 33 }, (_, index) => ({ lo: index, hi: 7 }));
    const table = buildDressingPersistentExclusionTable(identities);
    expect(table.count / table.capacity).toBeLessThanOrEqual(0.5);
    expect((table.capacity & (table.capacity - 1))).toBe(0);
  });
});
