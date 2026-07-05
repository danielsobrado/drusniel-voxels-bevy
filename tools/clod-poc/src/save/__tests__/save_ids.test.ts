import { describe, expect, it } from "vitest";
import { createSaveIdFactory, isFactorySaveId } from "../save_ids.js";

describe("save ids", () => {
  it("is deterministic per seed", () => {
    const first = createSaveIdFactory(42);
    const second = createSaveIdFactory(42);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("does not collide across a large deterministic sequence", () => {
    const nextId = createSaveIdFactory(7);
    const ids = new Set<string>();
    const count = 100000;

    for (let i = 0; i < count; i++) ids.add(nextId());

    expect(ids.size).toBe(count);
    expect([...ids].every((id) => isFactorySaveId(id))).toBe(true);
  });
});
