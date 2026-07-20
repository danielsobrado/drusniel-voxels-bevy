import { describe, expect, it } from "vitest";
import { buildDressingPersistentExclusionTable } from "./persistent_exclusion_table.js";

describe("dressing exclusion identities", () => {
  it("does not truncate identities to one word", () => {
    const a = { lo: 1, hi: 2 };
    const b = { lo: 1, hi: 3 };
    const table = buildDressingPersistentExclusionTable([a, b]);
    expect(table.count).toBe(2);
  });
});
