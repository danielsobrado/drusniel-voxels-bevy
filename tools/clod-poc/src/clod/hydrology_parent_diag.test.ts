import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../config.js";
import { initSimplifier } from "./simplify.js";
import { buildLod0PageSource, concat } from "./source_mesh.js";
import { weldVertices } from "./weld.js";
import { buildOuterBorderLocks } from "../lock.js";
import { simplifyPage } from "./simplify.js";
import {
  baseSurfaceHeight,
  parseBorderCoastOceanConfig,
  setBorderCoastRuntime,
  setTerrainSurfaceOverride,
} from "../terrain/terrain.js";
import { parseWaterConfig } from "../water/waterConfig.js";
import { HydrologySystem } from "../water/hydrologySystem.js";
import { makeFakeBodyCarvedSampler } from "../water/fakeBodyCarve.js";
import {
  assertNoInternalBorders,
  openBoundaryVertexFlags,
  stripDegenerateTriangles,
  validateFinalPageMesh,
  validateWeldedIntermediate,
} from "./validate.js";
import { polishDiagonals } from "../diagonalPolish.js";
import type { ClodPageNode } from "../types.js";

const configRoot = fileURLToPath(new URL("../../config/", import.meta.url));

function footprintFor(level: number, nx: number, nz: number, cfg: ReturnType<typeof parseConfig>) {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size;
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

function buildLod0Node(px: number, pz: number, cfg: ReturnType<typeof parseConfig>, world: { cellsX: number; cellsZ: number }): ClodPageNode {
  const src = buildLod0PageSource(px, pz, cfg, world);
  validateFinalPageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz}`);
  return {
    id: `L0:${px},${pz}`,
    level: 0,
    children: [],
    mesh: src.mesh,
    footprint: src.footprint,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
    chunkMeshes: src.chunks,
  };
}

function buildParent(
  level: number,
  nx: number,
  nz: number,
  children: ClodPageNode[],
  cfg: ReturnType<typeof parseConfig>,
): ClodPageNode {
  const eps = cfg.simplify.weld_epsilon_cells;
  const merged = concat(children.map((c) => c.mesh));
  const { mesh: welded } = weldVertices(merged, eps, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  const footprint = footprintFor(level, nx, nz, cfg);
  validateWeldedIntermediate(welded, `L${level}:${nx},${nz} welded`, cfg.validation.zero_area_epsilon);

  const internalBefore = countInternalOpen(welded, footprint);
  const locks = buildOuterBorderLocks(welded);
  const sim = simplifyPage(structuredCloneMesh(welded), locks, cfg);
  stripDegenerateTriangles(sim.mesh, cfg.validation.zero_area_epsilon);
  let simplifiedOk = true;
  try {
    assertNoInternalBorders(sim.mesh, footprint);
  } catch {
    simplifiedOk = false;
  }
  if (internalBefore > 0) {
    console.log(`L${level}:${nx},${nz} welded internal open verts=${internalBefore}`);
  }
  const finalMesh = simplifiedOk ? sim.mesh : welded;
  if (simplifiedOk) {
    polishDiagonals(finalMesh, buildOuterBorderLocks(finalMesh), {
      ...cfg.polish.diagonal_flip,
      material_error_weight: 0,
    });
  }
  validateFinalPageMesh(finalMesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);
  return {
    id: `L${level}:${nx},${nz}`,
    level,
    children,
    mesh: finalMesh,
    footprint,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: sim.errorWorld,
    lowBenefit: !simplifiedOk,
  };
}

function structuredCloneMesh(mesh: ClodPageNode["mesh"]): ClodPageNode["mesh"] {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    paintSlots: mesh.paintSlots.slice(),
    materialWeights: mesh.materialWeights.slice(),
    materialWeightStride: mesh.materialWeightStride,
    indices: mesh.indices.slice(),
  };
}

function countInternalOpen(mesh: ClodPageNode["mesh"], footprint: ReturnType<typeof footprintFor>): number {
  const flags = openBoundaryVertexFlags(mesh);
  let n = 0;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const x = mesh.positions[i * 3], z = mesh.positions[i * 3 + 2];
    const d = Math.min(
      Math.abs(x - footprint.minX),
      Math.abs(x - footprint.maxX),
      Math.abs(z - footprint.minZ),
      Math.abs(z - footprint.maxZ),
    );
    if (d > 1.0) n++;
  }
  return n;
}

describe("hydrology parent weld diagnostics", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("builds quadrant hierarchy to L3:0,0", () => {
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

    const l0 = new Map<string, ClodPageNode>();
    for (let pz = 0; pz < 8; pz++) {
      for (let px = 0; px < 8; px++) {
        l0.set(`${px},${pz}`, buildLod0Node(px, pz, cfg, world));
      }
    }

    const l1 = new Map<string, ClodPageNode>();
    for (let nz = 0; nz < 4; nz++) {
      for (let nx = 0; nx < 4; nx++) {
        const children = [
          l0.get(`${nx * 2},${nz * 2}`)!,
          l0.get(`${nx * 2 + 1},${nz * 2}`)!,
          l0.get(`${nx * 2},${nz * 2 + 1}`)!,
          l0.get(`${nx * 2 + 1},${nz * 2 + 1}`)!,
        ];
        l1.set(`${nx},${nz}`, buildParent(1, nx, nz, children, cfg));
      }
    }

    const l2 = new Map<string, ClodPageNode>();
    for (let nz = 0; nz < 2; nz++) {
      for (let nx = 0; nx < 2; nx++) {
        const children = [
          l1.get(`${nx * 2},${nz * 2}`)!,
          l1.get(`${nx * 2 + 1},${nz * 2}`)!,
          l1.get(`${nx * 2},${nz * 2 + 1}`)!,
          l1.get(`${nx * 2 + 1},${nz * 2 + 1}`)!,
        ];
        l2.set(`${nx},${nz}`, buildParent(2, nx, nz, children, cfg));
      }
    }

    const children = [
      l2.get("0,0")!,
      l2.get("1,0")!,
      l2.get("0,1")!,
      l2.get("1,1")!,
    ];
    expect(() => buildParent(3, 0, 0, children, cfg)).not.toThrow();
  }, 300_000);
});
