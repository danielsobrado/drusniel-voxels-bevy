// Quadtree build orchestration — the core Phase 1 deliverable. Plan §3.2 / §11.6.
//
// LOD0 node  = welded chunk meshes (source_mesh.ts), error_world = 0.
// LODk node  = merge 2x2 children -> weld old internal page borders -> lock new outer
//              border -> simplify (carry attrs) -> accumulate error.
//
// Invariants: lower LODs are NEVER re-extracted from the field (I2) — every parent is a
// decimation of its merged children. Locked outer borders are bit-identical across
// siblings (inherited verbatim from LOD0), so internal borders weld exactly.

import { ClodPageNode, PageFootprint, PageMesh } from "./types.js";
import { ClodPagesConfig } from "./config.js";
import { buildLod0PageSource } from "./source_mesh.js";
import { concat } from "./source_mesh.js";
import { weldVertices } from "./weld.js";
import { buildOuterBorderLocks, countLocks } from "./lock.js";
import { simplifyPage } from "./simplify.js";
import { assertNoInternalBorders, stripDegenerateTriangles } from "./validate.js";

export interface NodeBuildStat {
  id: string;
  level: number;
  inputTris: number;
  outputTris: number;
  lockedVerts: number;
  errorWorld: number;
  lowBenefit: boolean;
  buildMs: number;
}

export interface BuildResult {
  roots: ClodPageNode[];
  nodesByLevel: Map<number, ClodPageNode[]>;
  stats: NodeBuildStat[];
  worldPagesX: number;
  worldPagesZ: number;
}

function footprintFor(level: number, nx: number, nz: number, cfg: ClodPagesConfig): PageFootprint {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size; // cells per node side
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

function boundsOf(mesh: PageMesh): { center: [number, number, number]; radius: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]); maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]); maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]); maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let r = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    r = Math.max(r, Math.hypot(mesh.positions[i] - center[0], mesh.positions[i + 1] - center[1], mesh.positions[i + 2] - center[2]));
  }
  return { center, radius: r };
}

const tris = (m: PageMesh) => m.indices.length / 3;

export function buildWorld(worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig): BuildResult {
  const eps = cfg.simplify.weld_epsilon_cells;
  const world = {
    cellsX: worldPagesX * cfg.page.chunks_per_page * cfg.page.chunk_size,
    cellsZ: worldPagesZ * cfg.page.chunks_per_page * cfg.page.chunk_size,
  };
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const stats: NodeBuildStat[] = [];
  // index[level] : key "nx,nz" -> node
  const index: Map<string, ClodPageNode>[] = [];

  // ---- LOD0 ----
  const lod0: ClodPageNode[] = [];
  const lod0Index = new Map<string, ClodPageNode>();
  for (let pz = 0; pz < worldPagesZ; pz++) {
    for (let px = 0; px < worldPagesX; px++) {
      const t0 = performance.now();
      const src = buildLod0PageSource(px, pz, cfg, world);
      stripDegenerateTriangles(src.mesh);
      assertNoInternalBorders(src.mesh, src.footprint);
      const node: ClodPageNode = {
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh: src.mesh,
        footprint: src.footprint,
        bounds: boundsOf(src.mesh),
        errorWorld: 0,
        lowBenefit: false,
      };
      lod0.push(node);
      lod0Index.set(`${px},${pz}`, node);
      stats.push({
        id: node.id, level: 0, inputTris: tris(src.mesh), outputTris: tris(src.mesh),
        lockedVerts: 0, errorWorld: 0, lowBenefit: false, buildMs: performance.now() - t0,
      });
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

  // ---- LOD1+ ----
  let prevCountX = worldPagesX, prevCountZ = worldPagesZ;
  for (let level = 1; level < cfg.page.quadtree_levels; level++) {
    const countX = Math.ceil(prevCountX / 2);
    const countZ = Math.ceil(prevCountZ / 2);
    const levelNodes: ClodPageNode[] = [];
    const levelIndex = new Map<string, ClodPageNode>();

    for (let nz = 0; nz < countZ; nz++) {
      for (let nx = 0; nx < countX; nx++) {
        const t0 = performance.now();
        const children: ClodPageNode[] = [];
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            const c = index[level - 1].get(`${nx * 2 + dx},${nz * 2 + dz}`);
            if (c) children.push(c);
          }
        }
        if (children.length === 0) continue;

        const merged = concat(children.map((c) => c.mesh));
        const { mesh: welded } = weldVertices(merged, eps);
        const footprint = footprintFor(level, nx, nz, cfg);
        const locks = buildOuterBorderLocks(welded);
        const sim = simplifyPage(welded, locks, cfg);
        stripDegenerateTriangles(sim.mesh);
        assertNoInternalBorders(sim.mesh, footprint);

        const errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
        const node: ClodPageNode = {
          id: `L${level}:${nx},${nz}`,
          level,
          children,
          mesh: sim.mesh,
          footprint,
          bounds: boundsOf(sim.mesh),
          errorWorld,
          lowBenefit: sim.lowBenefit,
        };
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
        stats.push({
          id: node.id, level, inputTris: tris(welded), outputTris: tris(sim.mesh),
          lockedVerts: countLocks(locks), errorWorld, lowBenefit: sim.lowBenefit,
          buildMs: performance.now() - t0,
        });
      }
    }

    nodesByLevel.set(level, levelNodes);
    index[level] = levelIndex;
    prevCountX = countX;
    prevCountZ = countZ;
    if (countX === 1 && countZ === 1) break; // reached a single root
  }

  const topLevel = Math.max(...nodesByLevel.keys());
  return { roots: nodesByLevel.get(topLevel)!, nodesByLevel, stats, worldPagesX, worldPagesZ };
}
