import { describe, expect, it } from "vitest";
import { parseNaadfPocConfig, ringForDistance } from "../config.js";
import { sampleFarSummary, buildFarSummaryTile, farTileKeyString } from "../farClipmap.js";
import { worldToSummaryTileKey } from "../keys.js";
import { createTerrainSource } from "../terrainSource.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

describe("naadf farClipmap", () => {
  const config = parseNaadfPocConfig(naadfYaml);
  const source = createTerrainSource("hills", 1);

  it("ring selection is correct by distance", () => {
    expect(ringForDistance(2000, config)?.name).toBe("summary_2_4km");
    expect(ringForDistance(5000, config)?.name).toBe("summary_4_8km");
    expect(ringForDistance(10000, config)?.name).toBe("summary_8_16km");
  });

  it("tile key supports negative world coordinates", () => {
    const ring = config.farClipmap.rings[0]!;
    const key = worldToSummaryTileKey(-100, -200, 0, ring.cellM, config.farClipmap.tileCells);
    expect(key.x).toBeLessThanOrEqual(0);
    expect(key.z).toBeLessThanOrEqual(0);
  });

  it("coarser fallback works", () => {
    const store = new Map();
    const ring0 = config.farClipmap.rings[0]!;
    const key = worldToSummaryTileKey(3000, 3000, 1, config.farClipmap.rings[1]!.cellM, config.farClipmap.tileCells);
    const tile = buildFarSummaryTile(key, 1, config, source, 1);
    store.set(farTileKeyString(key), tile);
    const sample = sampleFarSummary({
      worldX: 3000,
      worldZ: 3000,
      purpose: "height",
      cameraX: 0,
      cameraZ: 0,
      store,
      config,
      source,
    });
    expect(sample.unknown).toBe(false);
    expect(Number.isFinite(sample.height)).toBe(true);
    void ring0;
  });

  it("unknown is explicit when no fallback exists", () => {
    const store = new Map();
    const sample = sampleFarSummary({
      worldX: 20000,
      worldZ: 20000,
      purpose: "height",
      cameraX: 0,
      cameraZ: 0,
      store,
      config: { ...config, farClipmap: { ...config.farClipmap, enabled: false } },
      source,
    });
    expect(sample.unknown).toBe(true);
  });
});
