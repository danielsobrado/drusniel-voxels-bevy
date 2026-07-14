import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "../canopy/canopy_defaults.js";
import { createFarSummaryCanopySource, sampleFarSummaryHydrology } from "./unified-sources.js";

describe("far-summary layout-v2 sources", () => {
  it("maps canonical hydrology channels without re-deriving them", () => {
    const hints: number[] = [];
    const sample = sampleFarSummaryHydrology({
      sample: (_x, _z, cellSizeHint) => {
        hints.push(cellSizeHint ?? -1);
        return {
          bodyMask: 0.75,
          waterY: 14,
          bodyKind: 2,
          shoreDistance: 3,
          flowX: 0.4,
          flowZ: -0.2,
        };
      },
    }, 1, 2, 32);

    expect(sample).toEqual({
      coverage: 0.75,
      waterLevel: 14,
      bodyKind: 2,
      shoreDistance: 3,
      flowX: 0.4,
      flowZ: -0.2,
    });
    expect(hints).toEqual([32]);
  });

  it("uses deterministic near-tree distribution without resampling hydrology", () => {
    const config = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    config.treeDistribution.forestThreshold = 0;
    config.treeDistribution.densityScale = 2;
    let waterSamples = 0;
    const source = createFarSummaryCanopySource({
      getConfig: () => config,
      sampleHeight: () => 20,
      sampleMaterial: () => 1,
      sampleWater: () => {
        waterSamples++;
        return { coverage: 1, waterLevel: 25, bodyKind: 2, shoreDistance: 0, flowX: 0, flowZ: 0 };
      },
    });

    const first = source(0, 0, 32);
    const second = source(0, 0, 32);
    expect(second).toEqual(first);
    expect(first.canopyHeightAvg).toBeGreaterThanOrEqual(20);
    expect(first.coverage).toBeGreaterThanOrEqual(0);
    expect(first.speciesPine + first.speciesBroadleaf + first.speciesDeadwood).toBeLessThanOrEqual(1.000001);
    expect(waterSamples).toBe(0);
  });
});
