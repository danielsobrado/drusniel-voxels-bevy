import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { readWaterVisualConfig } from "./water_config_visual_parsing.js";

describe("water foam distance configuration", () => {
  it("keeps the canonical defaults", () => {
    expect(DEFAULT_WATER_VISUAL.foam.detailFadeStartM).toBe(120);
    expect(DEFAULT_WATER_VISUAL.foam.detailFadeEndM).toBe(320);
  });

  it("parses snake-case YAML fields", () => {
    const visual = readWaterVisualConfig({
      foam: {
        detail_fade_start_m: 150,
        detail_fade_end_m: 420,
      },
    }, DEFAULT_WATER_VISUAL);

    expect(visual.foam.detailFadeStartM).toBe(150);
    expect(visual.foam.detailFadeEndM).toBe(420);
  });

  it("parses camel-case fields", () => {
    const visual = readWaterVisualConfig({
      foam: {
        detailFadeStartM: 90,
        detailFadeEndM: 260,
      },
    }, DEFAULT_WATER_VISUAL);

    expect(visual.foam.detailFadeStartM).toBe(90);
    expect(visual.foam.detailFadeEndM).toBe(260);
  });

  it("falls back field-by-field when values are missing", () => {
    const visual = readWaterVisualConfig({
      foam: { detail_fade_start_m: 180 },
    }, DEFAULT_WATER_VISUAL);

    expect(visual.foam.detailFadeStartM).toBe(180);
    expect(visual.foam.detailFadeEndM).toBe(DEFAULT_WATER_VISUAL.foam.detailFadeEndM);
  });
});
