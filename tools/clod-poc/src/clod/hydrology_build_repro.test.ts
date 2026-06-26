import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../config.js";
import { initSimplifier } from "./simplify.js";
import { buildWorld } from "./quadtree.js";
import {
  baseSurfaceHeight,
  parseBorderCoastOceanConfig,
  setBorderCoastRuntime,
  setTerrainSurfaceOverride,
} from "../terrain/terrain.js";
import { parseWaterConfig } from "../water/waterConfig.js";
import { HydrologySystem } from "../water/hydrologySystem.js";
import { makeFakeBodyCarvedSampler } from "../water/fakeBodyCarve.js";

const configRoot = fileURLToPath(new URL("../../config/", import.meta.url));
const BUILD_TIMEOUT_MS = 300_000;

function setupHydrologyWorld(worldPages: number) {
  const cfg = parseConfig(readFileSync(`${configRoot}clod_pages.yaml`, "utf8"));
  const waterConfig = parseWaterConfig(readFileSync(`${configRoot}water.yaml`, "utf8"));
  const borderCoastOceanConfig = parseBorderCoastOceanConfig(
    readFileSync(`${configRoot}border_coast_ocean.yaml`, "utf8"),
  );
  const worldCells = worldPages * cfg.page.chunks_per_page * cfg.page.chunk_size;
  setBorderCoastRuntime(borderCoastOceanConfig, worldCells);
  const preHydrology = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
  const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrology);
  setTerrainSurfaceOverride((x, z) => hydrology.terrainHeight(x, z));
  return { cfg, worldPages };
}

describe("hydrology CLOD world build", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("builds 16x16 world with hydrology-carved terrain (infinite-naadf default)", () => {
    const { cfg, worldPages } = setupHydrologyWorld(16);
    expect(() => buildWorld(worldPages, worldPages, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);
});
