import { describe, expect, it } from "vitest";
import { deriveDefaultWaterBodyPresets, waterBodyPresetsByKind, WATER_BODY_KIND_COUNT } from "./water_body_presets.js";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_MARSH, HYDROLOGY_BODY_POND, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import { parseWaterConfig } from "./water_config_parsing.js";

const BASE = {
  shallowColor: [0.0, 0.32, 0.55] as [number, number, number],
  deepColor: [0.0, 0.025, 0.12] as [number, number, number],
  depthScale: 4.0,
  turbidity: 0.1,
};

describe("water body presets", () => {
  it("derives neutral lake/river/ocean defaults that reproduce the scalar depth response", () => {
    const presets = deriveDefaultWaterBodyPresets(BASE);
    // absorption 1/depthScale on every channel == the old scalar exp(-depth/depthScale).
    for (const kind of [presets.lake, presets.river, presets.ocean]) {
      expect(kind.absorption).toEqual([0.25, 0.25, 0.25]);
      expect(kind.shallowColor).toEqual(BASE.shallowColor);
      expect(kind.reflectionDamping).toBe(1);
    }
    // Ponds/marshes carry the former in-shader murk: stronger absorption, damped sky.
    expect(presets.pond.absorption[0]).toBeGreaterThan(presets.lake.absorption[0]);
    expect(presets.pond.reflectionDamping).toBeLessThan(1);
    expect(presets.marsh.turbidity).toBeGreaterThan(presets.pond.turbidity);
  });

  it("indexes presets by HYDROLOGY_BODY_* kind with the dry slot mirroring lake", () => {
    const presets = deriveDefaultWaterBodyPresets(BASE);
    const byKind = waterBodyPresetsByKind(presets);
    expect(byKind).toHaveLength(WATER_BODY_KIND_COUNT);
    expect(byKind[0]).toBe(presets.lake);
    expect(byKind[HYDROLOGY_BODY_LAKE]).toBe(presets.lake);
    expect(byKind[HYDROLOGY_BODY_RIVER]).toBe(presets.river);
    expect(byKind[HYDROLOGY_BODY_POND]).toBe(presets.pond);
    expect(byKind[HYDROLOGY_BODY_MARSH]).toBe(presets.marsh);
  });

  it("parses yaml overrides per kind and derives unset kinds from the parsed base", () => {
    const config = parseWaterConfig(
      [
        "water:",
        "  enabled: true",
        "  visual:",
        "    color:",
        "      depth_scale: 2.0",
        "    foam:",
        "      shore_distance_end: 4.5",
        "    bodies:",
        "      river:",
        "        absorption: [0.9, 0.5, 0.4]",
        "        reflection_damping: 0.8",
      ].join("\n"),
      () => {},
    );
    expect(config.visual.bodies.river.absorption).toEqual([0.9, 0.5, 0.4]);
    expect(config.visual.bodies.river.reflectionDamping).toBe(0.8);
    // Unconfigured lake derives from the parsed depth_scale (1/2.0), not the default 5.0.
    expect(config.visual.bodies.lake.absorption).toEqual([0.5, 0.5, 0.5]);
    expect(config.visual.foam.shoreDistanceEnd).toBe(4.5);
    expect(config.visual.foam.shoreDistanceStart).toBe(0.0);
  });
});
