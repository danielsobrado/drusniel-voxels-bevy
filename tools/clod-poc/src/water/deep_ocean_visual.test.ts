import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { DEFAULT_WATER_VISUAL } from "./waterConfig.js";
import { resolveDeepOceanVisual } from "./deep_ocean_visual.js";

describe("deep ocean visual config", () => {
  it("uses border ocean shading colors", () => {
    const visual = resolveDeepOceanVisual(DEFAULT_WATER_VISUAL, {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      shading: {
        ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.shading,
        deepColor: [0.1, 0.2, 0.3],
        shallowColor: [0.4, 0.5, 0.6],
        foamColor: [0.7, 0.8, 0.9],
      },
    });

    expect(visual.deepColor).toEqual([0.1, 0.2, 0.3]);
    expect(visual.shallowColor).toEqual([0.4, 0.5, 0.6]);
    expect(visual.foamColor).toEqual([0.7, 0.8, 0.9]);
  });
});
