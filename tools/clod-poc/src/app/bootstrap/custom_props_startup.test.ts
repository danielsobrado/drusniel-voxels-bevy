import { describe, expect, it } from "vitest";
import { customPropsInitiallyEnabled } from "./custom_props_startup.js";

describe("customPropsInitiallyEnabled", () => {
  it("keeps custom GLB props disabled without an explicit opt-in", () => {
    expect(customPropsInitiallyEnabled()).toBe(false);
    expect(customPropsInitiallyEnabled(new URLSearchParams())).toBe(false);
    expect(customPropsInitiallyEnabled(new URLSearchParams("customProps=0"))).toBe(false);
  });

  it("honors the explicit QA URL opt-in", () => {
    expect(customPropsInitiallyEnabled(new URLSearchParams("customProps=1"))).toBe(true);
  });
});
