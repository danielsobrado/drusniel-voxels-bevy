import { describe, expect, it } from "vitest";
import type { SavedPropInstance } from "../../save/save_schema.js";
import {
  buildPersistentDressingExclusionSnapshot,
  parsePersistentDressingSaveId,
  persistentDressingSaveId,
} from "./saved_exclusions.js";

function prop(id: string, state: SavedPropInstance["state"], x: number): SavedPropInstance {
  return {
    id,
    prefabId: "environmental-dressing:dead_log_fresh",
    position: [x, 4, x + 1],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: "r.0.0",
    state,
    tags: ["environmental", "dressing", "dead_log_fresh"],
  };
}

describe("saved persistent dressing exclusions", () => {
  it("round-trips canonical 64-bit save IDs", () => {
    const stableId = { lo: 0x89abcdef, hi: 0xfedcba98 };
    const savedId = persistentDressingSaveId(stableId);
    expect(savedId).toBe("dressing:fedcba9889abcdef");
    expect(parsePersistentDressingSaveId(savedId)).toEqual(stableId);
    expect(parsePersistentDressingSaveId("project:fedcba9889abcdef")).toBeNull();
  });

  it("packs only destroyed dressing props in unsigned 64-bit sort order", () => {
    const first = persistentDressingSaveId({ lo: 7, hi: 1 });
    const second = persistentDressingSaveId({ lo: 3, hi: 9 });
    const snapshot = buildPersistentDressingExclusionSnapshot([
      prop(second, "destroyed", 20),
      prop(first, "destroyed", 10),
      prop(persistentDressingSaveId({ lo: 1, hi: 0 }), "active", 0),
      { ...prop("project:unrelated", "destroyed", 30), tags: ["project"] },
    ], 12);
    expect(snapshot.revision).toBe(12);
    expect(snapshot.count).toBe(2);
    expect([...snapshot.packed]).toEqual([7, 1, 3, 9]);
    expect(snapshot.positions).toEqual([[10, 11], [20, 21]]);
  });
});
