import { describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";
import { createGravelBarBedAuthority } from "./gravel_bar_bed_authority.js";
import { buildHydrologyTileData, type HydrologyWorldSampler } from "./hydrologyTileSource.js";

function baseSample(): HydrologySample {
  return {
    terrainY: 10,
    waterY: 11,
    depth: 1,
    bodyMask: 1,
    lakeMask: 0,
    riverMask: 1,
    flowX: 1,
    flowZ: 0,
    flowStrength: 0.4,
    riverDepth: 1,
    waterYFar: 11,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: 41,
    shoreDistance: 2,
  };
}

function enabledConfig() {
  const config = cloneHydrologyConfig();
  config.gravelBars.enabled = true;
  config.gravelBars.strength = 1;
  config.gravelBars.patternStart = 0;
  config.gravelBars.patternEnd = 0.01;
  config.gravelBars.breakupStrength = 0;
  config.gravelBars.minShoreDistanceM = 0;
  config.gravelBars.maxShoreDistanceM = 10;
  config.gravelBars.minDepthM = 0;
  config.gravelBars.maxDepthM = 2;
  config.gravelBars.minFlowStrength = 0;
  config.gravelBars.maxFlowStrength = 1;
  config.gravelBed.enabled = true;
  config.gravelBed.maxElevationM = 0.5;
  config.gravelBed.minWetDepthM = 0.2;
  config.gravelBed.continuityReserveM = 0.1;
  config.gravelBed.bankClearanceM = 0.05;
  return config;
}

describe("gravel bed hydrology tile parity", () => {
  it("matches direct wrapped samples at every tile vertex", () => {
    const config = enabledConfig();
    const terrain = { surfaceHeight: () => 12 };
    const base: HydrologyWorldSampler = () => baseSample();
    const authority = createGravelBarBedAuthority(
      config.gravelBars,
      config.gravelBed,
      terrain,
    );
    const wrapped = authority.wrap(base);
    const options = { tileSizeM: 32, tileRes: 8, drySentinelDepthM: 2 };
    const tile = buildHydrologyTileData(0, 0, terrain, options, wrapped);

    const vertices = tile.res + 1;
    for (let z = 0; z < vertices; z += 1) {
      for (let x = 0; x < vertices; x += 1) {
        const worldX = tile.originX + x * tile.cellSize;
        const worldZ = tile.originZ + z * tile.cellSize;
        const expected = wrapped(worldX, worldZ, terrain, { drySentinelDepthM: 2 });
        const index = z * vertices + x;
        expect(tile.terrainY[index]).toBe(expected.terrainY);
        expect(tile.waterY[index]).toBe(expected.waterY);
        expect(tile.riverDepth[index]).toBe(expected.riverDepth);
      }
    }
  });

  it("keeps feature-off tiles byte-identical to the base sampler", () => {
    const config = enabledConfig();
    config.gravelBed.enabled = false;
    const terrain = { surfaceHeight: () => 12 };
    const base: HydrologyWorldSampler = () => baseSample();
    const wrapped = createGravelBarBedAuthority(
      config.gravelBars,
      config.gravelBed,
      terrain,
    ).wrap(base);
    const options = { tileSizeM: 32, tileRes: 8, drySentinelDepthM: 2 };
    const direct = buildHydrologyTileData(0, 0, terrain, options, base);
    const disabled = buildHydrologyTileData(0, 0, terrain, options, wrapped);

    expect(Array.from(disabled.terrainY)).toEqual(Array.from(direct.terrainY));
    expect(Array.from(disabled.waterY)).toEqual(Array.from(direct.waterY));
    expect(Array.from(disabled.riverDepth)).toEqual(Array.from(direct.riverDepth));
  });
});
