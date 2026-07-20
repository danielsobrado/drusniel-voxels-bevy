import { describe, expect, it } from "vitest";
import { customPropsInitiallyEnabled } from "./custom_props_startup.js";

describe("customPropsInitiallyEnabled", () => {
  it("keeps custom GLB props disabled without an explicit browser URL opt-in", () => {
    expect(customPropsInitiallyEnabled(undefined, null)).toBe(false);
    expect(customPropsInitiallyEnabled(new URLSearchParams(), null)).toBe(false);
    expect(customPropsInitiallyEnabled(new URLSearchParams("customProps=0"), null)).toBe(false);
    expect(customPropsInitiallyEnabled(new URLSearchParams("customProps=1"), "")).toBe(false);
  });

  it("honors the explicit QA browser URL opt-in", () => {
    expect(customPropsInitiallyEnabled(new URLSearchParams(), "?customProps=1")).toBe(true);
  });
});
