import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "../canopy/canopy_defaults.js";
import { cloneHydrologyConfig } from "../water/hydrologyConfig.js";
import { HydrologySystem } from "../water/hydrologySystem.js";
import { createFarSummaryCanopySource, sampleFarSummaryHydrology } from "./unified-sources.js";

describe("far-summary layout-v2 sources", () => {
  it("maps canonical hydrology channels without re-deriving them", () => {
    const sample = sampleFarSummaryHydrology({
      sample: () => ({
        bodyMask: 0.75,
        waterY: 14,
        bodyKind: 2,
        shoreDistance: 3,
        flowX: 0.4,
        flowZ: -0.2,
      }),
    }, 1, 2, 32);

    expect(sample).toEqual({
      coverage: 0.75,
      waterLevel: 14,
      bodyKind: 2,
      shoreDistance: 3,
      flowX: 0.4,
      flowZ: -0.2,
    });
  });

  it("uses the deterministic near-tree distribution for canopy channels", () => {
    const config = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    config.treeDistribution.forestThreshold = 0;
    config.treeDistribution.densityScale = 2;
    const source = createFarSummaryCanopySource({
      getConfig: () => config,
      sampleHeight: () => 20,
      sampleMaterial: () => 1,
    });

    const first = source(0, 0, 32);
    const second = source(0, 0, 32);
    expect(second).toEqual(first);
    expect(first.canopyHeightAvg).toBeGreaterThanOrEqual(20);
    expect(first.coverage).toBeGreaterThanOrEqual(0);
    expect(first.speciesPine + first.speciesBroadleaf + first.speciesDeadwood).toBeLessThanOrEqual(1.000001);
  });

  it("never builds fine hydrology tiles for far-summary cells", () => {
    const hydrologyConfig = cloneHydrologyConfig();
    hydrologyConfig.simRes = 8;
    hydrologyConfig.accumulation.particles = 0;
    hydrologyConfig.fill.iterations = 0;
    const hydrology = HydrologySystem.build(
      hydrologyConfig,
      64,
      { surfaceHeight: () => 20 },
      {
        infiniteWorldSamples: true,
        worldSampler: () => ({
          terrainY: 20,
          carvedBedY: 20,
          waterY: -2,
          depth: -22,
          bodyMask: 0,
          lakeMask: 0,
          riverMask: 0,
          shoreDistance: 64,
          flowX: 0,
          flowZ: 0,
          flowStrength: 0,
          riverDepth: 0,
          waterYFar: -2,
          moisture: 0,
          bodyKind: 0,
          bodyId: 0,
        }),
      },
    );
    for (const cellSizeM of [32, 64, 128]) {
      sampleFarSummaryHydrology(hydrology, 0, 0, cellSizeM);
    }

    expect(hydrology.tileCacheStats()?.builds).toBe(0);
  });
});
