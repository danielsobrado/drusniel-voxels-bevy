import { describe, expect, it } from "vitest";
import {
  applyBorderCoastShape,
  coastMask,
  sampleCoastType,
  worldEdgeDistance,
} from "./border_coast.js";

import {
  DEFAULT_BORDER_COAST_OCEAN_CONFIG,
  parseBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
} from "./border_coast_config.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function beachOnlyConfig(): BorderCoastOceanConfig {
  const cfg = structuredClone(DEFAULT_BORDER_COAST_OCEAN_CONFIG) as BorderCoastOceanConfig;
  cfg.coast.cliffHeadlandThreshold = 2;
  return cfg;
}

describe("parseBorderCoastOceanConfig", () => {
  it("loads the unified repo yaml", () => {
    const yaml = readFileSync(
      fileURLToPath(new URL("../../config/border_coast_ocean.yaml", import.meta.url)),
      "utf8",
    );
    const cfg = parseBorderCoastOceanConfig(yaml);
    expect(cfg.enabled).toBe(true);
    expect(cfg.ocean.surfaceY).toBe(18);
    expect(cfg.coast.oceanStartCells).toBe(256);
    expect(cfg.coast.oceanFullDepthCells).toBe(96);
    expect(cfg.coast.shoreBackshoreCells).toBe(128);
    expect(cfg.deepOcean.extendCells).toBe(4096);
    expect(cfg.deepOcean.segments).toBe(256);
  });

  it("keeps legacy nested yaml compatibility", () => {
    const cfg = parseBorderCoastOceanConfig(`
border_coast_ocean:
  enabled: true
  coast:
    ocean_start_cells: 64
    ocean_full_depth_cells: 12
  ocean:
    surface_y: 21
  deep_ocean:
    extend_cells: 512
    segments: 32
`);
    expect(cfg.coast.oceanStartCells).toBe(64);
    expect(cfg.coast.oceanFullDepthCells).toBe(12);
    expect(cfg.ocean.surfaceY).toBe(21);
    expect(cfg.deepOcean.extendCells).toBe(512);
    expect(cfg.deepOcean.segments).toBe(32);
  });
});

describe("border coast shaping", () => {
  const cfg = DEFAULT_BORDER_COAST_OCEAN_CONFIG;
  const worldCells = 256;

  it("reports zero coast mask in the interior", () => {
    expect(coastMask(worldCells * 0.5, worldCells * 0.5, cfg.coast, worldCells)).toBe(0);
  });

  it("ramps coast mask toward the world edge", () => {
    const edge = worldEdgeDistance(0, worldCells * 0.5, worldCells);
    expect(edge).toBe(0);
    expect(coastMask(0, worldCells * 0.5, cfg.coast, worldCells)).toBeGreaterThan(0.9);
  });

  it("places beach waterline at sea level offset on the world edge", () => {
    const inland = 80;
    const shaped = applyBorderCoastShape(0, 0, inland, cfg, worldCells);
    const waterline = cfg.ocean.surfaceY + cfg.coast.beach.waterlineOffset;
    expect(shaped).toBeCloseTo(waterline, 5);
  });

  it("preserves high terrain on the dry side of beach coast shaping", () => {
    const beachCfg = beachOnlyConfig();
    const highMountain = 96;
    const x = beachCfg.coast.oceanStartCells + beachCfg.coast.beach.beachShelfCells + 12;
    const z = worldCells * 0.5;
    const shaped = applyBorderCoastShape(x, z, highMountain, beachCfg, worldCells);

    expect(shaped).toBeGreaterThan(highMountain - 1);
  });

  it("does not keep making beach when water is not imminent", () => {
    const beachCfg = beachOnlyConfig();
    const lowBackshore = beachCfg.ocean.surfaceY + beachCfg.coast.beach.backshoreHeightAboveWater + 1;
    const x = beachCfg.coast.oceanStartCells + beachCfg.coast.beach.beachShelfCells + 4;
    const z = worldCells * 0.5;
    const shaped = applyBorderCoastShape(x, z, lowBackshore, beachCfg, worldCells);

    expect(lowBackshore - shaped).toBeLessThanOrEqual(1);
  });

  it("keeps the repo coast band from swallowing the default playable world", () => {
    const yaml = readFileSync(
      fileURLToPath(new URL("../../config/border_coast_ocean.yaml", import.meta.url)),
      "utf8",
    );
    const repoCfg = parseBorderCoastOceanConfig(yaml);
    const defaultWorldCells = 512;
    const center = defaultWorldCells * 0.5;
    const inland = 86;

    expect(coastMask(center, center, repoCfg.coast, defaultWorldCells)).toBe(0);
    expect(applyBorderCoastShape(center, center, inland, repoCfg, defaultWorldCells)).toBe(inland);
    expect(coastMask(0, center, repoCfg.coast, defaultWorldCells)).toBeGreaterThan(0.9);
  });

  it("preserves the configured coast width when the world has enough inland space", () => {
    const yaml = readFileSync(
      fileURLToPath(new URL("../../config/border_coast_ocean.yaml", import.meta.url)),
      "utf8",
    );
    const repoCfg = parseBorderCoastOceanConfig(yaml);
    const midWorldCells = 1024;
    const center = midWorldCells * 0.5;

    expect(coastMask(300, center, repoCfg.coast, midWorldCells)).toBeGreaterThan(0);
    expect(coastMask(center, center, repoCfg.coast, midWorldCells)).toBe(0);
  });

  it("samples deterministic coast types", () => {
    expect(["beach", "cliff"]).toContain(sampleCoastType(64, 64, cfg.coast));
    expect(sampleCoastType(64, 64, cfg.coast)).toBe(sampleCoastType(64, 64, cfg.coast));
  });

  it("keeps surface height continuous across shoreline macro-cell seams", () => {
    const z = 198;
    const yaml = readFileSync(
      fileURLToPath(new URL("../../config/border_coast_ocean.yaml", import.meta.url)),
      "utf8",
    );
    const repoCfg = parseBorderCoastOceanConfig(yaml);
    const worldCells = 1024;
    const h31 = applyBorderCoastShape(31, z, 80, repoCfg, worldCells);
    const h32 = applyBorderCoastShape(32, z, 80, repoCfg, worldCells);
    expect(Math.abs(h32 - h31)).toBeLessThan(2);
  });
});
