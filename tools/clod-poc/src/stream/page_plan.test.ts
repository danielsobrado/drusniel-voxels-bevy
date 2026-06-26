import { describe, expect, it } from "vitest";
import { isVisualPageDistance } from "./page_filter.js";
import { pageRangeForRadius } from "./page_range.js";
import { visualPageKeys } from "./page_plan.js";

describe("visual page planning", () => {
  it("keeps visual pages outside live radius and inside CLOD radius", () => {
    expect(isVisualPageDistance(199, 200, 2048, 64)).toBe(false);
    expect(isVisualPageDistance(256, 200, 2048, 64)).toBe(true);
    expect(isVisualPageDistance(4096, 200, 2048, 64)).toBe(false);
  });

  it("plans deterministic page ranges", () => {
    expect(pageRangeForRadius(0, 0, 128, 64)).toEqual({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
  });

  it("returns sorted visual page keys", () => {
    const keys = visualPageKeys(0, 0, 64, 192, 64, 1);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual([...keys].sort());
  });
});
