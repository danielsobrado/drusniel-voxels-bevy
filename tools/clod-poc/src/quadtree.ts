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

export interface BuildProgress {
  done: number;
  total: number;
  level: number;
  phase: string;
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

function estimatedNodeCount(worldPagesX: number, worldPagesZ: number, levels: number): number {
  let total = 0;
  let countX = worldPagesX;
  let countZ = worldPagesZ;
  for (let level = 0; level < levels; level++) {
    total += countX * countZ;
    if (countX === 1 && countZ === 1) break;
    countX = Math.ceil(countX / 2);
    countZ = Math.ceil(countZ / 2);
  }
  return total;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== "undefined" && !document.hidden && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    }
    else setTimeout(resolve, 0);
  });
}

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

export async function buildWorldAsync(
  worldPagesX: number,
  worldPagesZ: number,
  cfg: ClodPagesConfig,
  onProgress: (progress: BuildProgress) => void,
): Promise<BuildResult> {
  const eps = cfg.simplify.weld_epsilon_cells;
  const world = {
    cellsX: worldPagesX * cfg.page.chunks_per_page * cfg.page.chunk_size,
    cellsZ: worldPagesZ * cfg.page.chunks_per_page * cfg.page.chunk_size,
  };
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const stats: NodeBuildStat[] = [];
  const index: Map<string, ClodPageNode>[] = [];
  const total = estimatedNodeCount(worldPagesX, worldPagesZ, cfg.page.quadtree_levels);
  let done = 0;
  let lastYield = performance.now();

  const tick = async (level: number, phase: string) => {
    done++;
    onProgress({ done, total, level, phase });
    const now = performance.now();
    if (now - lastYield > 33) {
      lastYield = now;
      await yieldToBrowser();
    }
  };

  onProgress({ done, total, level: 0, phase: "LOD0 pages" });
  await yieldToBrowser();

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
      await tick(0, "LOD0 pages");
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

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
        await tick(level, `LOD${level} parents`);
      }
    }

    nodesByLevel.set(level, levelNodes);
    index[level] = levelIndex;
    prevCountX = countX;
    prevCountZ = countZ;
    if (countX === 1 && countZ === 1) break;
  }

  const topLevel = Math.max(...nodesByLevel.keys());
  onProgress({ done: total, total, level: topLevel, phase: "complete" });
  await yieldToBrowser();
  return { roots: nodesByLevel.get(topLevel)!, nodesByLevel, stats, worldPagesX, worldPagesZ };
}

// ---- targeted rebuild after a terrain edit ---------------------------------

/** Inclusive world-cell bounds touched by an edit (sphere bbox + influence margin). */
export interface DirtyCellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface EditRebuildResult {
  /** Mutated in place (same node objects), LOD0 pages first then parents bottom-up. */
  changed: ClodPageNode[];
  lod0Pages: number;
  parentNodes: number;
  lod0Ms: number;
  parentMs: number;
}

/**
 * Rebuild the LOD0 pages whose cells intersect `dirty`, then every ancestor up the
 * quadtree (merge -> weld -> lock -> simplify), with the same hard-fail validation as
 * the full build. Nodes are mutated in place so viewer/selection references stay valid.
 * This is the per-edit cost CLOD pays for digging: the dug pages plus one node per
 * ancestor level.
 */
export function rebuildDirtyPages(
  result: BuildResult,
  dirty: DirtyCellBounds,
  cfg: ClodPagesConfig,
): EditRebuildResult {
  const eps = cfg.simplify.weld_epsilon_cells;
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const world = {
    cellsX: result.worldPagesX * span,
    cellsZ: result.worldPagesZ * span,
  };

  // node lookup per level, keyed "nx,nz" (recovered from the build-time ids)
  const index: Map<string, ClodPageNode>[] = [];
  for (const [level, nodes] of result.nodesByLevel) {
    const m = new Map<string, ClodPageNode>();
    for (const n of nodes) m.set(n.id.slice(n.id.indexOf(":") + 1), n);
    index[level] = m;
  }

  const minPx = Math.max(0, Math.floor(dirty.minX / span));
  const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
  const minPz = Math.max(0, Math.floor(dirty.minZ / span));
  const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));

  const changed: ClodPageNode[] = [];
  let dirtyCoords: [number, number][] = [];
  const t0 = performance.now();
  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      const node = index[0]?.get(`${px},${pz}`);
      if (!node) continue;
      const src = buildLod0PageSource(px, pz, cfg, world);
      stripDegenerateTriangles(src.mesh);
      assertNoInternalBorders(src.mesh, src.footprint);
      node.mesh = src.mesh;
      node.bounds = boundsOf(src.mesh);
      changed.push(node);
      dirtyCoords.push([px, pz]);
    }
  }
  const lod0Ms = performance.now() - t0;
  const lod0Pages = changed.length;

  const t1 = performance.now();
  let parentNodes = 0;
  const topLevel = Math.max(...result.nodesByLevel.keys());
  for (let level = 1; level <= topLevel && dirtyCoords.length > 0; level++) {
    const parents = new Map<string, [number, number]>();
    for (const [nx, nz] of dirtyCoords) parents.set(`${nx >> 1},${nz >> 1}`, [nx >> 1, nz >> 1]);
    dirtyCoords = [];
    for (const [key, coord] of parents) {
      const node = index[level]?.get(key);
      if (!node) continue;
      const children = node.children.filter((c): c is ClodPageNode => c !== null);
      const merged = concat(children.map((c) => c.mesh));
      const { mesh: welded } = weldVertices(merged, eps);
      const locks = buildOuterBorderLocks(welded);
      const sim = simplifyPage(welded, locks, cfg);
      stripDegenerateTriangles(sim.mesh);
      assertNoInternalBorders(sim.mesh, node.footprint);
      node.mesh = sim.mesh;
      node.bounds = boundsOf(sim.mesh);
      node.errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
      node.lowBenefit = sim.lowBenefit;
      changed.push(node);
      parentNodes++;
      dirtyCoords.push(coord);
    }
  }
  const parentMs = performance.now() - t1;

  return { changed, lod0Pages, parentNodes, lod0Ms, parentMs };
}
