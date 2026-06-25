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
import borderCoastYaml from "../../config/border_coast_ocean.yaml?raw";

describe("parseBorderCoastOceanConfig", () => {
  it("loads the repo yaml", () => {
    const cfg = parseBorderCoastOceanConfig(borderCoastYaml);
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

  it("lowers beach shoreline heights toward the waterline", () => {
    const inland = 80;
    const beachX = 4;
    const shaped = applyBorderCoastShape(beachX, worldCells * 0.5, inland, cfg, worldCells);
    expect(shaped).toBeLessThan(inland);
    expect(shaped).toBeGreaterThan(cfg.ocean.surfaceY);
  });

  it("samples deterministic coast types", () => {
    expect(["beach", "cliff"]).toContain(sampleCoastType(64, 64, cfg.coast));
    expect(sampleCoastType(64, 64, cfg.coast)).toBe(sampleCoastType(64, 64, cfg.coast));
  });
});
