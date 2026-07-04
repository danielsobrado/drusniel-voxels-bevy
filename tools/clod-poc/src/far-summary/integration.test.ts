import { describe, expect, it } from "vitest";
import { resolveFarSummaryFrameInterval } from "./integration.js";

describe("resolveFarSummaryFrameInterval", () => {
  it("uses the provided default when no query override is present", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams(), "farSummaryBuildInterval", 30)).toBe(30);
  });

  it("accepts a positive integer query override", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=12"), "farSummaryBuildInterval", 30)).toBe(12);
  });

  it("floors fractional values", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=12.9"), "farSummaryBuildInterval", 30)).toBe(12);
  });

  it("rejects invalid values and clamps the default to at least one", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=0"), "farSummaryBuildInterval", 0)).toBe(1);
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=nope"), "farSummaryBuildInterval", 0)).toBe(1);
  });
});
