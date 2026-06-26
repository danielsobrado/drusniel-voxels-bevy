import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../config.js";
import { initSimplifier } from "./simplify.js";
import { buildLod0PageSource } from "./source_mesh.js";
import {
  baseSurfaceHeight,
  parseBorderCoastOceanConfig,
  setBorderCoastRuntime,
  setTerrainSurfaceOverride,
} from "../terrain/terrain.js";
import { parseWaterConfig } from "../water/waterConfig.js";
import { HydrologySystem } from "../water/hydrologySystem.js";
import { makeFakeBodyCarvedSampler } from "../water/fakeBodyCarve.js";
import { assertBorderMatch, borderChain } from "./validate.js";

const configRoot = fileURLToPath(new URL("../../config/", import.meta.url));

describe("hydrology LOD0 border chains", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("matches east/west borders between adjacent pages", () => {
    const cfg = parseConfig(readFileSync(`${configRoot}clod_pages.yaml`, "utf8"));
    const waterConfig = parseWaterConfig(readFileSync(`${configRoot}water.yaml`, "utf8"));
    const borderCoastOceanConfig = parseBorderCoastOceanConfig(
      readFileSync(`${configRoot}border_coast_ocean.yaml`, "utf8"),
    );
    const WORLD = 16;
    const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
    const world = { cellsX: worldCells, cellsZ: worldCells };

    setBorderCoastRuntime(borderCoastOceanConfig, worldCells);
    const preHydrology = makeFakeBodyCarvedSampler(waterConfig, { surfaceHeight: baseSurfaceHeight });
    const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, preHydrology);
    setTerrainSurfaceOverride((x, z) => hydrology.terrainHeight(x, z));

    const pairs: Array<[number, number, number, number, "x" | "z", number]> = [
      [3, 1, 4, 1, "x", 256],
      [3, 0, 3, 1, "z", 64],
      [2, 1, 3, 1, "x", 192],
    ];

    for (const [ax, az, bx, bz, axis, plane] of pairs) {
      const a = buildLod0PageSource(ax, az, cfg, world);
      const b = buildLod0PageSource(bx, bz, cfg, world);
      const chainA = borderChain(a.mesh, axis, plane, a.footprint);
      const chainB = borderChain(b.mesh, axis, plane, b.footprint);
      expect(() =>
        assertBorderMatch(chainA, chainB, {
          position: cfg.validation.position_epsilon,
          normalDot: cfg.validation.normal_dot_min,
          material: cfg.validation.material_weight_epsilon,
        }),
      ).not.toThrow();
    }
  }, 60_000);
});
