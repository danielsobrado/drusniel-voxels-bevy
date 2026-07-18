import { describe, expect, it } from "vitest";
import { canonicalWaterEffectUrl } from "./water_effects_url.js";

describe("water effects URL policy", () => {
  it("canonicalizes aliases while preserving unrelated state", () => {
    const next = new URL(canonicalWaterEffectUrl(
      "https://example.test/?rockFlourWater=1&glacialRockFlour=1&seed=7",
      "rockFlour",
      false,
    ));
    expect(next.searchParams.get("waterRockFlour")).toBe("0");
    expect(next.searchParams.has("rockFlourWater")).toBe(false);
    expect(next.searchParams.has("glacialRockFlour")).toBe(false);
    expect(next.searchParams.get("seed")).toBe("7");
  });

  it("uses the stable reflection-tier key", () => {
    const next = new URL(canonicalWaterEffectUrl(
      "https://example.test/?waterMidReflection=0&waterReflectionFallback=0",
      "reflectionTiers",
      true,
    ));
    expect(next.searchParams.get("waterReflectionTiers")).toBe("1");
  });
});
