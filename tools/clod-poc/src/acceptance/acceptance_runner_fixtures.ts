import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestHierarchy, type TestBuildResult } from "../clod/buildTestHierarchy.js";
import { type FixtureDef } from "../clod/stressFixtures.js";
import { type ClodPagesConfig, parseConfig } from "../config.js";
import type { AcceptanceConfig } from "./acceptanceTypes.js";

const _runnerDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(_runnerDir, "..", "..", "config", "clod_pages.yaml");

function normalFromHeightFn(heightFn: (x: number, z: number) => number, eps = 0.01) {
  return (x: number, z: number): [number, number, number] => {
    const h = heightFn(x, z);
    const hx = heightFn(x + eps, z);
    const hz = heightFn(x, z + eps);
    const dx = (hx - h) / eps;
    const dz = (hz - h) / eps;
    const len = Math.hypot(-dx, 1, -dz);
    return len > 0 ? [-dx / len, 1 / len, -dz / len] : [0, 1, 0];
  };
}

export function loadClodPagesConfig(path?: string): ClodPagesConfig {
  const configPath = path ?? DEFAULT_CONFIG_PATH;
  const text = readFileSync(configPath, "utf-8");
  return parseConfig(text);
}

function defaultPageMeshProvider(fixture: FixtureDef, cellsPerSide: number) {
  const heightFn = fixture.height;
  const materialFn = fixture.material;
  const normalFn = normalFromHeightFn(heightFn, 0.01);

  return (px: number, pz: number) => {
    const baseX = px * cellsPerSide;
    const baseZ = pz * cellsPerSide;
    const side = cellsPerSide + 1;
    const positions: number[] = [];
    const normals: number[] = [];
    const materials: number[] = [];

    for (let j = 0; j <= cellsPerSide; j++) {
      for (let i = 0; i <= cellsPerSide; i++) {
        const wx = baseX + i;
        const wz = baseZ + j;
        const h = heightFn(wx, wz);
        const n = normalFn(wx, wz);
        const m = materialFn(wx, wz);
        positions.push(wx, h, wz);
        normals.push(n[0], n[1], n[2]);
        materials.push(m);
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < cellsPerSide; j++) {
      for (let i = 0; i < cellsPerSide; i++) {
        const a = j * side + i;
        const b = a + 1;
        const c = (j + 1) * side + i;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const nv = materials.length;
    const mw = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) {
      const slot = Math.min(Math.max(0, Math.round(materials[i])), 3);
      mw[i * 4 + slot] = 1.0;
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      paintSlots: new Float32Array(materials),
      materialWeights: mw,
      materialWeightStride: 4,
      indices: new Uint32Array(indices),
    };
  };
}

function buildForFixture(
  clodCfg: ClodPagesConfig,
  fixture: FixtureDef,
  worldPagesX: number,
  worldPagesZ: number,
): TestBuildResult {
  const cellsPerPage = clodCfg.page.chunks_per_page * clodCfg.page.chunk_size;
  const provider = defaultPageMeshProvider(fixture, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, clodCfg, provider);
}

export function buildFixtureWorld(clodCfg: ClodPagesConfig, config: AcceptanceConfig, fixture: FixtureDef): TestBuildResult {
  return buildForFixture(clodCfg, fixture, config.world.lod0PagesX, config.world.lod0PagesZ);
}
