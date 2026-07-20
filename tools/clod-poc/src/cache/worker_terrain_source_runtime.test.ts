import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "../water/hydrologyConfig.js";
import {
  readGravelBarSettings,
  readGravelBedSettings,
  setGravelBarSettings,
  setGravelBedSettings,
} from "../water/gravel_bar_runtime.js";
import type { TerrainSourceInputs } from "./terrainSource.js";
import { installWorkerTerrainSourceRuntime } from "./worker_terrain_source_runtime.js";

afterEach(() => {
  setGravelBarSettings(DEFAULT_HYDROLOGY_CONFIG.gravelBars);
  setGravelBedSettings(DEFAULT_HYDROLOGY_CONFIG.gravelBed);
});

describe("worker terrain-source runtime", () => {
  it("publishes the serialized gravel settings before CLOD terrain builds", () => {
    const gravelBars = {
      ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
      seedSalt: 90125,
      strength: 0.73,
    };
    const gravelBed = {
      ...DEFAULT_HYDROLOGY_CONFIG.gravelBed,
      enabled: true,
      maxElevationM: 0.44,
    };
    const source = {
      waterConfig: {
        hydrology: { gravelBars, gravelBed },
      },
    } as TerrainSourceInputs;

    installWorkerTerrainSourceRuntime(source);
    gravelBars.strength = 0;
    gravelBed.maxElevationM = 0;

    expect(readGravelBarSettings().seedSalt).toBe(90125);
    expect(readGravelBarSettings().strength).toBe(0.73);
    expect(readGravelBedSettings().enabled).toBe(true);
    expect(readGravelBedSettings().maxElevationM).toBe(0.44);
  });

  it("fails closed when normalized authority settings are absent", () => {
    expect(() => installWorkerTerrainSourceRuntime({
      waterConfig: { hydrology: {} },
    } as TerrainSourceInputs)).toThrow(/missing gravel-bed authority settings/);
  });
});
