import { describe, expect, it } from "vitest";
import { formatHoveredEnvironmentalProp, lookupEnvironmentalPropHit } from "./prop_interaction_lookup.js";

describe("environmental prop interaction lookup", () => {
  it("maps a hit back to a stable id for the debug overlay", () => {
    const hit = lookupEnvironmentalPropHit("world", "tree", [12, 4, 20], 8);
    expect(lookupEnvironmentalPropHit("world", "tree", [12, 99, 20], 8).propId).toBe(hit.propId);
    expect(formatHoveredEnvironmentalProp(hit)).toContain(hit.propId);
  });
});
