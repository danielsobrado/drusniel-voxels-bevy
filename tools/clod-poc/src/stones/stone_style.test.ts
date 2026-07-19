import { afterEach, describe, expect, it } from "vitest";
import { buildRock } from "./rock_builder.js";
import { Rng } from "./seed.js";
import {
  readStoneStyle,
  rockFacetRounding,
  setStoneStyle,
  softenRockParams,
  STONE_STYLE_PRESETS,
} from "./stone_style.js";

afterEach(() => setStoneStyle("realistic"));

describe("stone style presets", () => {
  it("keeps the realistic style byte-identical to the pre-style geometry path", () => {
    expect(rockFacetRounding(0)).toBeCloseTo(0.035, 10);
    const params = { macro: 0.38, strata: 0.16, ridged: 0.17, micro: 0.022, cutBite: 0.34 };
    expect(softenRockParams(params, 0)).toBe(params);
  });

  it("builds deterministic geometry per style and softer displacement when stylized", () => {
    setStoneStyle("realistic");
    const realisticA = buildRock("boulder", new Rng(7), 2).geometry.getAttribute("position").array as Float32Array;
    setStoneStyle("realistic");
    const realisticB = buildRock("boulder", new Rng(7), 2).geometry.getAttribute("position").array as Float32Array;
    expect(realisticB).toEqual(realisticA);

    setStoneStyle("toon");
    const toon = buildRock("boulder", new Rng(7), 2).geometry.getAttribute("position").array as Float32Array;
    expect(toon).not.toEqual(realisticA);
    expect(toon.length).toBe(realisticA.length);
  });

  it("applies the selected preset to the live shading uniforms and clamps unknown names", () => {
    setStoneStyle("stylized");
    expect(readStoneStyle().name).toBe("stylized");
    expect(readStoneStyle().wrap).toBe(STONE_STYLE_PRESETS.stylized.wrap);
    setStoneStyle("nonsense" as never);
    expect(readStoneStyle().name).toBe("realistic");
  });
});
