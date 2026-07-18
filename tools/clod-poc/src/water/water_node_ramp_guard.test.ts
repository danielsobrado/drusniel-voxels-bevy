import { describe, expect, it } from "vitest";
import { waterRampGuardEnabled } from "./water_node_static_grid.js";

describe("water ramp guard", () => {
  it("applies to near clipmap levels", () => {
    expect(waterRampGuardEnabled(1.5)).toBe(true);
    expect(waterRampGuardEnabled(6)).toBe(true);
  });

  it("preserves far min-reduced shoreline dips", () => {
    expect(waterRampGuardEnabled(12)).toBe(false);
    expect(waterRampGuardEnabled(48)).toBe(false);
  });
});
