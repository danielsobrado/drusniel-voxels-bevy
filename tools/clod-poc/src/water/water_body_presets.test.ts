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
  it("derives neutral clear defaults that reproduce scalar depth response and add no scatter", () => {
    const presets = deriveDefaultWaterBodyPresets(BASE);
    for (const kind of [presets.lake, presets.river, presets.ocean]) {
      expect(kind.absorption).toEqual([0.25, 0.25, 0.25]);
      expect(kind.shallowColor).toEqual(BASE.shallowColor);
      expect(kind.reflectionDamping).toBe(1);
      expect(kind.scatterColor).toEqual([0, 0, 0]);
      expect(kind.scatterExtinction).toBe(0);
      expect(kind.scatterStrength).toBe(0);
      expect(kind.scatterAmbient).toBe(0);
    }
    expect(presets.pond.absorption[0]).toBeGreaterThan(presets.lake.absorption[0]);
    expect(presets.pond.reflectionDamping).toBeLessThan(1);
    expect(presets.marsh.turbidity).toBeGreaterThan(presets.pond.turbidity);
    expect(presets.pond.scatterStrength).toBe(0);
    expect(presets.marsh.scatterStrength).toBe(0);
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
        "        scatter_color: [0.1, 0.4, 0.35]",
        "        scatter_extinction: 0.5",
        "        scatter_strength: 0.7",
        "        scatter_ambient: 0.6",
      ].join("\n"),
      () => {},
    );
    expect(config.visual.bodies.river.absorption).toEqual([0.9, 0.5, 0.4]);
    expect(config.visual.bodies.river.reflectionDamping).toBe(0.8);
    expect(config.visual.bodies.river.scatterColor).toEqual([0.1, 0.4, 0.35]);
    expect(config.visual.bodies.river.scatterExtinction).toBe(0.5);
    expect(config.visual.bodies.river.scatterStrength).toBe(0.7);
    expect(config.visual.bodies.river.scatterAmbient).toBe(0.6);
    expect(config.visual.bodies.lake.absorption).toEqual([0.5, 0.5, 0.5]);
    expect(config.visual.bodies.lake.scatterStrength).toBe(0);
    expect(config.visual.foam.shoreDistanceEnd).toBe(4.5);
    expect(config.visual.foam.shoreDistanceStart).toBe(0.0);
  });
});
