import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { readWaterVisualConfig } from "./water_config_visual_parsing.js";
import { resolveWaterFoamAlbedo } from "./water_foam_albedo.js";

describe("water foam albedo config authority", () => {
  it("normalizes configured brightness before every renderer consumes foamColor", () => {
    const configured = [0.90, 0.95, 0.96] as const;
    const parsed = readWaterVisualConfig({ foam_color: configured }, DEFAULT_WATER_VISUAL);

    expect(parsed.foamColor).toEqual(resolveWaterFoamAlbedo(configured));
    expect(parsed.foamColor[0]).toBeLessThan(0.8);
    expect(parsed.foamColor[1]).toBeLessThan(0.8);
    expect(parsed.foamColor[2]).toBeLessThan(0.8);
  });

  it("uses the same normalization for camelCase authoring", () => {
    const configured = [1, 0.75, 0.55] as const;
    const parsed = readWaterVisualConfig({ foamColor: configured }, DEFAULT_WATER_VISUAL);

    expect(parsed.foamColor).toEqual(resolveWaterFoamAlbedo(configured));
  });
});
