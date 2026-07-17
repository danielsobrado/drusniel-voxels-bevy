import { describe, expect, it } from "vitest";
import configText from "../../../config/heightfield_tiles.yaml?raw";
import {
  heightfieldTilesEnabled,
  parseHeightfieldTileConfig,
} from "./heightfield_tile_config.js";

describe("heightfield tile config", () => {
  it("parses the default-off bounded cache config", () => {
    const config = parseHeightfieldTileConfig(configText);
    expect(config).toEqual({
      enabled: false,
      radiusM: 1024,
      maxResidentTiles: 96,
      maxInflightBatches: 1,
      maxTilesPerBatch: 2,
      evictDistanceMultiplier: 1.5,
      retryCooldownFrames: 120,
      predictionSeconds: 4,
      backgroundBuildIntervalFrames: 30,
      persistenceEnabled: true,
    });
  });

  it("requires an explicit flag while the default is off", () => {
    const config = parseHeightfieldTileConfig(configText);
    expect(heightfieldTilesEnabled(config, new URLSearchParams(), "infinite_islands")).toBe(false);
    expect(heightfieldTilesEnabled(config, new URLSearchParams("heightTiles=1"), "infinite_islands")).toBe(true);
    expect(heightfieldTilesEnabled(config, new URLSearchParams("heightTiles=0"), "infinite_islands")).toBe(false);
  });

  it("never enables the Phase 2 path for finite worlds", () => {
    const config = parseHeightfieldTileConfig(configText);
    expect(heightfieldTilesEnabled(config, new URLSearchParams("heightTiles=1"), "finite")).toBe(false);
  });

  it("defaults authoritative tiles on for continent mode", () => {
    const config = parseHeightfieldTileConfig(configText);
    expect(heightfieldTilesEnabled(config, new URLSearchParams(), "continent")).toBe(true);
    expect(heightfieldTilesEnabled(config, new URLSearchParams("heightTiles=0"), "continent")).toBe(false);
  });

  it("rejects invalid budgets", () => {
    expect(() => parseHeightfieldTileConfig(`
      enabled: true
      radius_m: 768
      max_resident_tiles: 0
      max_inflight_batches: 1
      max_tiles_per_batch: 2
      evict_distance_multiplier: 1.5
      retry_cooldown_frames: 120
      prediction_seconds: 4
      background_build_interval_frames: 30
      persistence_enabled: true
    `)).toThrow(/max_resident_tiles/);
  });
});
