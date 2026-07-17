import { describe, expect, it } from "vitest";
import { parseConstructionConfig } from "./config.js";

describe("construction stability config", () => {
  it("parses and clamps island, collapse, contact, and profile settings", () => {
    const config = parseConstructionConfig(`
construction:
  stability:
    enabled: true
    collapse_threshold: 2
    epsilon: 0
    max_island_size: 0
    max_collapses_per_frame: 0
    collapse_delay_ms: -1
    connection_tolerance_m: 0
    material_profiles:
      wood:
        max_support: 2
        vertical_decay: 0.03
        horizontal_decay: 0.08
        support_class: stone
`);

    expect(config.stability.collapseThreshold).toBe(1);
    expect(config.stability.epsilon).toBe(0.000001);
    expect(config.stability.maxIslandSize).toBe(1);
    expect(config.stability.maxCollapsesPerFrame).toBe(1);
    expect(config.stability.collapseDelayMs).toBe(0);
    expect(config.stability.connectionToleranceM).toBe(0.001);
    expect(config.stability.materialProfiles.wood).toEqual({
      maxSupport: 2,
      verticalDecay: 0.03,
      horizontalDecay: 0.08,
      supportClass: "stone",
    });
  });

  it("provides profiles for every selectable material", () => {
    const profiles = parseConstructionConfig("construction: {}").stability.materialProfiles;
    expect(Object.keys(profiles).sort()).toEqual([
      "brick", "concrete", "marble", "metal", "stone", "thatch", "tiles", "wood",
    ]);
  });
});
