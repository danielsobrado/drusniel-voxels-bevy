import { describe, expect, it } from "vitest";
import {
  BiomeVisualStateConfigError,
  parseBiomeVisualStateConfig,
} from "./biome_visual_state_config.js";

const VALID_CONFIG = `
biome_visual_state:
  enabled: true
  season_keyframes:
    - at: 0.0
      green: 0.2
      autumn: 0.0
      bloom: 0.0
      snowline_m: 900
      glacial_murkiness: 0.7
      pollen_amount: 0.0
      frost_amount: 1.0
    - at: 0.5
      green: 1.0
      autumn: 0.0
      bloom: 0.4
      snowline_m: 2200
      glacial_murkiness: 0.5
      pollen_amount: 0.3
      frost_amount: 0.0
  morning_mist:
    start_sun_elevation_deg: -4
    peak_sun_elevation_deg: 5
    end_sun_elevation_deg: 18
    strength: 0.65
  wetness:
    default: 0.1
`;

describe("biome visual state config", () => {
  it("parses and sorts required seasonal state", () => {
    const settings = parseBiomeVisualStateConfig(VALID_CONFIG);

    expect(settings.enabled).toBe(true);
    expect(settings.seasonKeyframes).toHaveLength(2);
    expect(settings.seasonKeyframes[0]?.at).toBe(0);
    expect(settings.seasonKeyframes[1]?.snowlineM).toBe(2200);
    expect(settings.morningMist.peakSunElevationDeg).toBe(5);
    expect(settings.defaultWetness).toBeCloseTo(0.1, 6);
  });

  it("rejects missing required keyframe fields", () => {
    const invalid = VALID_CONFIG.replace("      frost_amount: 0.0\n", "");
    expect(() => parseBiomeVisualStateConfig(invalid)).toThrow(BiomeVisualStateConfigError);
  });

  it("rejects duplicate season positions", () => {
    const invalid = VALID_CONFIG.replace("    - at: 0.5", "    - at: 0.0");
    expect(() => parseBiomeVisualStateConfig(invalid)).toThrow(/duplicate at=0/);
  });

  it("rejects invalid morning mist ordering", () => {
    const invalid = VALID_CONFIG.replace("    peak_sun_elevation_deg: 5", "    peak_sun_elevation_deg: 20");
    expect(() => parseBiomeVisualStateConfig(invalid)).toThrow(/start < peak < end/);
  });
});
