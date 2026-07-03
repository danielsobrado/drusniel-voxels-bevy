import { describe, expect, it } from "vitest";
import { hydrologySampleCoord } from "./hydrologySystem.js";

describe("hydrologySampleCoord", () => {
  it("leaves finite-world samples unchanged", () => {
    expect(hydrologySampleCoord(1100, 1024, false)).toBe(1100);
    expect(hydrologySampleCoord(-20, 1024, false)).toBe(-20);
  });

  it("wraps unbounded infinite-islands samples into the source grid", () => {
    expect(hydrologySampleCoord(1100, 1024, true)).toBe(76);
    expect(hydrologySampleCoord(-20, 1024, true)).toBe(1004);
  });
});
