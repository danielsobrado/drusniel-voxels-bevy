import { describe, expect, it } from "vitest";
import {
  ensureOceanRimQueryDefault,
  oceanRimEnabled,
  setOceanRimQuery,
} from "./ocean_rim_query.js";

describe("ocean rim query", () => {
  it("defaults the rim off when neither query spelling is present", () => {
    const params = ensureOceanRimQueryDefault(new URLSearchParams("scene=continent"));

    expect(params.get("oceanRim")).toBe("0");
    expect(oceanRimEnabled(params)).toBe(false);
  });

  it("preserves explicit canonical and legacy overrides", () => {
    const canonical = ensureOceanRimQueryDefault(new URLSearchParams("oceanRim=1"));
    const legacy = ensureOceanRimQueryDefault(new URLSearchParams("ocean_rim=true"));

    expect(canonical.toString()).toBe("oceanRim=1");
    expect(legacy.toString()).toBe("ocean_rim=true");
    expect(oceanRimEnabled(canonical)).toBe(true);
    expect(oceanRimEnabled(legacy)).toBe(true);
  });

  it("writes one canonical value when the menu changes the setting", () => {
    const enabled = setOceanRimQuery(new URLSearchParams("scene=infinite-islands&ocean_rim=0"), true);
    const disabled = setOceanRimQuery(enabled, false);

    expect(enabled.toString()).toBe("scene=infinite-islands&oceanRim=1");
    expect(disabled.toString()).toBe("scene=infinite-islands&oceanRim=0");
  });
});
