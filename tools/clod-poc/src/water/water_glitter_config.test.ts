import { describe, expect, it } from "vitest";
import { cloneWaterConfig } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import { parseWaterConfig } from "./water_config_parsing.js";

const YAML = [
  "water:",
  "  visual:",
  "    glitter:",
  "      enabled: false",
  "      tight_exponent: 420",
  "      tight_gain: 1.3",
  "      broad_exponent: 84",
  "      broad_gain: 0.31",
  "      low_sun_gain: 0.55",
].join("\n");

describe("water glitter config", () => {
  it("parses every two-lobe control", () => {
    const parsed = parseWaterConfig(YAML, () => {});
    expect(parsed.visual.glitter).toEqual({
      enabled: false,
      tightExponent: 420,
      tightGain: 1.3,
      broadExponent: 84,
      broadGain: 0.31,
      lowSunGain: 0.55,
    });
  });

  it("deep-clones glitter state and preserves stable defaults", () => {
    const cloned = cloneWaterConfig(DEFAULT_WATER_CONFIG);
    expect(cloned.visual.glitter).not.toBe(DEFAULT_WATER_CONFIG.visual.glitter);
    expect(DEFAULT_WATER_CONFIG.visual.glitter).toEqual({
      enabled: true,
      tightExponent: 160,
      tightGain: 0.28,
      broadExponent: 48,
      broadGain: 0.06,
      lowSunGain: 0.20,
    });
  });
});
