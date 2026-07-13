import { describe, expect, it } from "vitest";
import { farSummaryCanopyEnabled, isLongViewCapableScene } from "./bootstrap_long_view.js";

describe("long-view bootstrap scenes", () => {
  it("activates the long-view integration for the continent scene", () => {
    expect(isLongViewCapableScene("continent")).toBe(true);
  });

  it("allows water acceptance to isolate graph enrichment from canopy cost", () => {
    expect(farSummaryCanopyEnabled(new URLSearchParams())).toBe(true);
    expect(farSummaryCanopyEnabled(new URLSearchParams("farSummaryCanopy=0"))).toBe(false);
  });
});
