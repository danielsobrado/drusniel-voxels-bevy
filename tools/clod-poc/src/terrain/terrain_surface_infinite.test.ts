import { afterEach, describe, expect, it } from "vitest";
import {
  baseSurfaceHeight,
  getBorderCoastRuntime,
  resolveTerrainFieldConfig,
  setBorderCoastRuntime,
  setTerrainFieldConfig,
  setTerrainSurfaceOverride,
  surfaceHeight,
} from "./terrain_surface.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "./border_coast_config.js";

// The startup world (startupWorld=4) is only 256 cells wide, but an infinite-island
// player spawns far outside it (e.g. x=2048,z=2048). The finite border coast used to
// collapse everything outside [0,worldCells]² to the ocean/beach waterline, producing
// flat square sheets. Border coast must be inert whenever the island field is active.

const FAR_X = 2048;
const FAR_Z = 2048;

function useInfiniteIslandField(): void {
  setTerrainFieldConfig(
    resolveTerrainFieldConfig({ seed: 1, seaLevel: 18, islandShape: { enabled: true } }),
  );
}

afterEach(() => {
  setTerrainFieldConfig(null);
  setBorderCoastRuntime(null);
  setTerrainSurfaceOverride(null);
});

describe("infinite-island surface height ignores finite border coast", () => {
  it("refuses to register a border-coast runtime when the island field is enabled", () => {
    useInfiniteIslandField();
    setBorderCoastRuntime(DEFAULT_BORDER_COAST_OCEAN_CONFIG, 256);
    expect(getBorderCoastRuntime()).toBeNull();
  });

  it("returns the raw island field far outside the startup world", () => {
    useInfiniteIslandField();
    setBorderCoastRuntime(DEFAULT_BORDER_COAST_OCEAN_CONFIG, 256);
    expect(surfaceHeight(FAR_X, FAR_Z)).toBe(baseSurfaceHeight(FAR_X, FAR_Z));
  });

  it("is independent of the startup world size", () => {
    useInfiniteIslandField();
    const heights = [256, 1024, 4096].map((worldCells) => {
      setBorderCoastRuntime(DEFAULT_BORDER_COAST_OCEAN_CONFIG, worldCells);
      return surfaceHeight(FAR_X, FAR_Z);
    });
    expect(heights[1]).toBe(heights[0]);
    expect(heights[2]).toBe(heights[0]);
  });
});

describe("finite worlds still apply border coast", () => {
  it("shapes the world edge toward the waterline when the island field is off", () => {
    setTerrainFieldConfig(
      resolveTerrainFieldConfig({ seed: 1, seaLevel: 18, islandShape: { enabled: false } }),
    );
    const worldCells = 1024;
    setBorderCoastRuntime(DEFAULT_BORDER_COAST_OCEAN_CONFIG, worldCells);
    expect(getBorderCoastRuntime()).not.toBeNull();
    // At the very edge the border coast pulls terrain down to (near) the waterline.
    const edge = surfaceHeight(0, worldCells * 0.5);
    const waterline = DEFAULT_BORDER_COAST_OCEAN_CONFIG.ocean.surfaceY
      + DEFAULT_BORDER_COAST_OCEAN_CONFIG.coast.beach.waterlineOffset;
    expect(edge).toBeLessThan(DEFAULT_BORDER_COAST_OCEAN_CONFIG.ocean.surfaceY + 10);
    expect(edge).toBeGreaterThanOrEqual(waterline - 1);
  });
});
