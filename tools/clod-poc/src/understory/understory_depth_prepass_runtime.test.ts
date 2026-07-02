import { describe, expect, it } from "vitest";
import {
  getUnderstoryDepthPrepassEnabled,
  setUnderstoryDepthPrepassEnabled,
  understoryDepthPrepassFromQuery,
} from "./understory_depth_prepass_runtime.js";

describe("understory depth prepass runtime helpers", () => {
  it("defaults to disabled and can be toggled", () => {
    setUnderstoryDepthPrepassEnabled(false);
    expect(getUnderstoryDepthPrepassEnabled()).toBe(false);

    setUnderstoryDepthPrepassEnabled(true);
    expect(getUnderstoryDepthPrepassEnabled()).toBe(true);

    setUnderstoryDepthPrepassEnabled(false);
    expect(getUnderstoryDepthPrepassEnabled()).toBe(false);
  });

  it("reads explicit startup query params", () => {
    expect(understoryDepthPrepassFromQuery(new URLSearchParams("understoryDepthPrepass=1"))).toBe(true);
    expect(understoryDepthPrepassFromQuery(new URLSearchParams("understoryDepthPrepass=true"))).toBe(true);
    expect(understoryDepthPrepassFromQuery(new URLSearchParams("understoryPrepass=1"))).toBe(true);
    expect(understoryDepthPrepassFromQuery(new URLSearchParams("understoryDepthPrepass=0"))).toBe(false);
    expect(understoryDepthPrepassFromQuery(new URLSearchParams(""))).toBe(false);
  });
});
