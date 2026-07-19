import { describe, expect, it } from "vitest";
import { readGravelBedSettings } from "./gravel_bar_runtime.js";
import { parseWaterConfig } from "./water_config_parsing.js";

const yaml = `
water:
  enabled: true
  source: hydrology
  hydrology:
    gravel_bar_bed:
      enabled: true
      max_elevation_m: 0.44
      min_wet_depth_m: 0.21
      continuity_reserve_m: 0.37
      bank_clearance_m: 0.09
`;

describe("gravel bed runtime configuration", () => {
  it("publishes the validated YAML-owned build settings", () => {
    const config = parseWaterConfig(yaml, null);
    expect(readGravelBedSettings()).toEqual(config.hydrology.gravelBed);
    expect(readGravelBedSettings()).toMatchObject({
      enabled: true,
      maxElevationM: 0.44,
      minWetDepthM: 0.21,
      continuityReserveM: 0.37,
      bankClearanceM: 0.09,
    });
  });
});
