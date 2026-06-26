import { beforeAll, describe, it } from "vitest";
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
import { openBoundaryVertexFlags } from "./validate.js";
import type { PageFootprint } from "../types.js";

const configRoot = fileURLToPath(new URL("../../config/", import.meta.url));

function distToPerimeter(x: number, z: number, fp: PageFootprint): number {
  return Math.min(
    Math.abs(x - fp.minX),
    Math.abs(x - fp.maxX),
    Math.abs(z - fp.minZ),
    Math.abs(z - fp.maxZ),
  );
}

describe("hydrology LOD0 border diagnostics", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("lists internal open-boundary verts on LOD0 pages", () => {
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

    const offenders: string[] = [];
    const targets = [
      [2, 0], [3, 0], [2, 1], [3, 1],
    ] as const;
    for (const [px, pz] of targets) {
        const src = buildLod0PageSource(px, pz, cfg, world);
        const flags = openBoundaryVertexFlags(src.mesh);
        for (let i = 0; i < flags.length; i++) {
          if (!flags[i]) continue;
          const x = src.mesh.positions[i * 3];
          const y = src.mesh.positions[i * 3 + 1];
          const z = src.mesh.positions[i * 3 + 2];
          const d = distToPerimeter(x, z, src.footprint);
          if (d > 1.0) {
            const sample = hydrology.sample(x, z);
            offenders.push(
              `L0:${px},${pz} (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) d=${d.toFixed(1)} ` +
                `wet=${sample.bodyMask.toFixed(2)} river=${sample.riverMask.toFixed(2)} lake=${sample.lakeMask.toFixed(2)}`,
            );
          }
        }
    }
    console.log(`internal open-boundary verts: ${offenders.length}`);
    console.log(offenders.slice(0, 20).join("\n"));
  });
});
