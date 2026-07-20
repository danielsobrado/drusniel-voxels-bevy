import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { parseProbeGiConfig } from "./config.js";
import { PROBE_GI_TOTAL_PROBES } from "./constants.js";
import { probeGiProbeCount } from "./cascade_layout.js";

describe("probe GI config", () => {
  it("loads the fixed three-cascade architecture default-off before PGI-8", () => {
    const config = parseProbeGiConfig(configText);
    expect(config.schemaVersion).toBe(1);
    expect(config.enabled).toBe(false);
    expect(config.cascades.map((cascade) => cascade.id)).toEqual(["near", "mid", "far"]);
    expect(config.cascades.reduce((total, cascade) => total + probeGiProbeCount(cascade), 0)).toBe(PROBE_GI_TOTAL_PROBES);
    expect(config.cascades[0].layerHeightsM).toEqual([1, 2.5, 5, 9, 15, 24, 38, 60]);
  });

  it("fails unknown keys and architecture drift", () => {
    expect(() => parseProbeGiConfig("probe_gi:\n  schema_version: 1\n  surprise: true\n")).toThrow(/unknown key/);
    expect(() => parseProbeGiConfig(configText.replace("dimensions: [32, 8, 32]", "dimensions: [16, 8, 16]"))).toThrow(/must be \[32, 8, 32\]/);
    expect(() => parseProbeGiConfig(configText.replace("spacing_m: 4", "spacing_m: 5"))).toThrow(/fixed near architecture/);
  });
});
