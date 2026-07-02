import { describe, expect, it } from "vitest";
import type { SelectionParams } from "../../clod/selection.js";
import { buildClodSelectionCacheKey } from "./clod_selection_cache.js";

function params(overrides: Partial<SelectionParams> = {}): SelectionParams {
  return {
    thresholdPx: 1,
    hysteresisMergeFactor: 1.5,
    enforce21: true,
    neighborLevelDeltaMax: 1,
    freezeSelection: false,
    nearField: {
      enabled: true,
      centerX: 10,
      centerZ: 20,
      radius: 64,
      boundaryPadding: 16,
    },
    viewportH: 1080,
    fovY: 1.1,
    camPos: [1, 2, 3],
    forcedMaxLevel: null,
    ...overrides,
  };
}

describe("buildClodSelectionCacheKey", () => {
  it("returns the same key for sub-quantum camera drift", () => {
    const a = buildClodSelectionCacheKey(params(), new Set());
    const b = buildClodSelectionCacheKey(params({ camPos: [1.01, 2.01, 3.01] }), new Set());

    expect(b).toBe(a);
  });

  it("changes the key for meaningful camera movement", () => {
    const a = buildClodSelectionCacheKey(params(), new Set());
    const b = buildClodSelectionCacheKey(params({ camPos: [1.2, 2, 3] }), new Set());

    expect(b).not.toBe(a);
  });

  it("changes the key when selection settings change", () => {
    const a = buildClodSelectionCacheKey(params(), new Set());
    const b = buildClodSelectionCacheKey(params({ thresholdPx: 2 }), new Set());

    expect(b).not.toBe(a);
  });

  it("sorts forced split ids for a stable dirty-ancestor key", () => {
    const a = buildClodSelectionCacheKey(params(), new Set(["L2:0,0", "L1:1,0"]));
    const b = buildClodSelectionCacheKey(params(), new Set(["L1:1,0", "L2:0,0"]));

    expect(b).toBe(a);
  });

  it("changes the key when forced split ids change", () => {
    const a = buildClodSelectionCacheKey(params(), new Set(["L2:0,0"]));
    const b = buildClodSelectionCacheKey(params(), new Set(["L2:0,1"]));

    expect(b).not.toBe(a);
  });
});
