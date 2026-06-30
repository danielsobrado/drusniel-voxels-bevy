import { describe, expect, it } from "vitest";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";

describe("spell effect noise helpers", () => {
  it("keeps the shared spell noise palette available", () => {
    const nodes = createSpellEffectNoiseNodes({
      hashSeed: 1,
      fbmFreqMul: 2,
      fbmOffset: [1, 2, 3],
    });

    expect(Object.keys(nodes).sort()).toEqual([
      "billow",
      "fbm",
      "gabor2",
      "ign2",
      "noise",
      "ridge",
      "ringCells2",
      "wavelet2",
    ]);
  });
});
