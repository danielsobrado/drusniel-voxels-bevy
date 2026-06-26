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
} from "./border_coast_config.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("parseBorderCoastOceanConfig", () => {
  it("loads the repo yaml", () => {
    const yaml = readFileSync(
      fileURLToPath(new URL("../../config/border_coast_ocean.yaml", import.meta.url)),
      "utf8",
    );
    const cfg = parseBorderCoastOceanConfig(yaml);
    expect(cfg.enabled).toBe(true);
    expect(cfg.coast.oceanStartCells).toBe(48);
    expect(cfg.deepOcean.extendCells).toBe(384);
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
