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

function setupWorld(WORLD: number) {
  const cfg = parseConfig(readFileSync(`${configRoot}clod_pages.yaml`, "utf8"));
  const waterConfig = parseWaterConfig(readFileSync(`${configRoot}water.yaml`, "utf8"));
  const borderCoastOceanConfig = parseBorderCoastOceanConfig(
    readFileSync(`${configRoot}border_coast_ocean.yaml`, "utf8"),
  );
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  setBorderCoastRuntime(borderCoastOceanConfig, worldCells);
  return { cfg, waterConfig, worldCells };
}

describe("hydrology world build", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("builds 8x8 without hydrology", () => {
    const WORLD = 8;
    const { cfg, worldCells } = setupWorld(WORLD);
    const borderCoast = parseBorderCoastOceanConfig(readFileSync(`${configRoot}border_coast_ocean.yaml`, "utf8"));
    setBorderCoastRuntime(borderCoast, worldCells);
    setTerrainSurfaceOverride(null);
    expect(() => buildWorld(WORLD, WORLD, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);

  it("builds 8x8 with hydrology carve", () => {
    const WORLD = 8;
    const { cfg, waterConfig, worldCells } = setupWorld(WORLD);
    const preHydrology = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
    const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrology);
    setTerrainSurfaceOverride((x, z) => hydrology.terrainHeight(x, z));
    expect(() => buildWorld(WORLD, WORLD, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);

  it("builds 16x16 without hydrology", () => {
    const WORLD = 16;
    const { cfg } = setupWorld(WORLD);
    setTerrainSurfaceOverride(null);
    expect(() => buildWorld(WORLD, WORLD, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);

  it("builds 16x16 with fake-body carve only", () => {
    const WORLD = 16;
    const { cfg, waterConfig } = setupWorld(WORLD);
    const carved = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
    setTerrainSurfaceOverride((x, z) => carved.surfaceHeight(x, z));
    expect(() => buildWorld(WORLD, WORLD, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);

  it("builds 16x16 with hydrology carve (scene default)", () => {
    const WORLD = 16;
    const { cfg, waterConfig, worldCells } = setupWorld(WORLD);
    const preHydrology = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
    const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrology);
    setTerrainSurfaceOverride((x, z) => hydrology.terrainHeight(x, z));
    expect(() => buildWorld(WORLD, WORLD, cfg)).not.toThrow();
  }, BUILD_TIMEOUT_MS);
});
