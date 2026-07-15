import { describe, expect, it } from "vitest";
import type { SavedPropInstance } from "./save_schema.js";
import { savedPropStore } from "./prop_store.js";

function makeProp(overrides: Partial<SavedPropInstance> = {}): SavedPropInstance {
  return {
    id: overrides.id ?? "prop-1",
    prefabId: "asset-a",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    anchor: "terrain",
    seed: 1,
    regionKey: "r_0_0",
    state: "active",
    tags: [],
    revision: 1,
    ...overrides,
  };
}

describe("SavedPropStore mutation revision", () => {
  it("bumps on restore", () => {
    savedPropStore.clear();
    const before = savedPropStore.revision();
    savedPropStore.restore([makeProp({ id: "a" }), makeProp({ id: "b" })]);
    expect(savedPropStore.revision()).toBe(before + 1);
  });

  it("bumps on upsert", () => {
    savedPropStore.clear();
    savedPropStore.restore([makeProp({ id: "a" })]);
    const before = savedPropStore.revision();
    savedPropStore.upsert(makeProp({ id: "a", position: [1, 2, 3] }));
    expect(savedPropStore.revision()).toBe(before + 1);
  });

  it("does not bump when removing a missing id", () => {
    savedPropStore.clear();
    savedPropStore.restore([makeProp({ id: "a" })]);
    const before = savedPropStore.revision();
    expect(savedPropStore.remove("missing")).toBeNull();
    expect(savedPropStore.revision()).toBe(before);
  });

  it("does not bump when clearing an empty store", () => {
    savedPropStore.clear();
    const before = savedPropStore.revision();
    savedPropStore.clear();
    expect(savedPropStore.revision()).toBe(before);
  });

  it("bumps on each successive distinct upsert", () => {
    savedPropStore.clear();
    savedPropStore.restore([makeProp({ id: "a" })]);
    const before = savedPropStore.revision();
    savedPropStore.upsert(makeProp({ id: "b" }));
    savedPropStore.upsert(makeProp({ id: "c" }));
    expect(savedPropStore.revision()).toBe(before + 2);
  });

  it("bumps on clear of a non-empty store", () => {
    savedPropStore.restore([makeProp({ id: "a" })]);
    const before = savedPropStore.revision();
    savedPropStore.clear();
    expect(savedPropStore.revision()).toBe(before + 1);
    expect(savedPropStore.hasProps()).toBe(false);
  });
});