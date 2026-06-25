// Quadtree build orchestration.
//
// LOD0 node  = welded chunk meshes (source_mesh.ts), error_world = 0.
// LODk node  = merge 2x2 children -> weld old internal page borders -> lock new outer
//              border -> simplify (carry attrs) -> accumulate error.
//
// Invariants: lower LODs are NEVER re-extracted from the field (I2) — every parent is a
// decimation of its merged children. Locked outer borders are bit-identical across
// siblings (inherited verbatim from LOD0), so internal borders weld exactly.

import { ClodPageNode, PageFootprint, PageMesh, ClodBuildError } from "../types.js";
import { ClodPagesConfig } from "../config.js";
import { buildLod0PageSource, rebuildPageChunks } from "./source_mesh.js";
import { concat } from "./source_mesh.js";
import { weldVertices } from "./weld.js";
import { buildOuterBorderLocks, countLocks } from "../lock.js";
import { simplifyPage } from "./simplify.js";
import { validateFinalPageMesh, validatePageMesh, validateWeldedIntermediate } from "./validate.js";
import {
  emptyDiagonalPolishStats,
  polishDiagonals,
  type DiagonalPolishStats,
} from "../diagonalPolish.js";

export interface NodeBuildStat {
  id: string;
  level: number;
  inputTris: number;
  outputTris: number;
  lockedVerts: number;
  errorWorld: number;
  lowBenefit: boolean;
  polish: DiagonalPolishStats;
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

function boundsOf(mesh: PageMesh): { center: [number, number, number]; radius: number; minY: number; maxY: number } {
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
  return { center, radius: r, minY, maxY };
}

const tris = (m: PageMesh) => m.indices.length / 3;

function pageMeshPolishConfig(cfg: ClodPagesConfig) {
  return {
    ...cfg.polish.diagonal_flip,
    material_error_weight: 0,
  };
}

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

function resolveBuildShape(worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig): { maxLevels: number } {
  const maxLevels = Math.min(
    cfg.page.quadtree_levels,
    Math.floor(Math.log2(Math.min(worldPagesX, worldPagesZ))) + 1,
  );
  const requiredMultiple = 1 << (maxLevels - 1);
  if (worldPagesX % requiredMultiple !== 0 || worldPagesZ % requiredMultiple !== 0) {
    throw new ClodBuildError(
      "PageIncomplete",
      `world pages ${worldPagesX}x${worldPagesZ} not a multiple of ${requiredMultiple} for ${maxLevels} levels`,
    );
  }
  return { maxLevels };
}

export function buildWorld(worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig): BuildResult {
  const eps = cfg.simplify.weld_epsilon_cells;
  const { maxLevels } = resolveBuildShape(worldPagesX, worldPagesZ, cfg);
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
      validatePageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz}`);
      const b = boundsOf(src.mesh);
      const node: ClodPageNode = {
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh: src.mesh,
        footprint: src.footprint,
        bounds: b,
        errorWorld: 0,
        lowBenefit: false,
        chunkMeshes: src.chunks,
      };
      lod0.push(node);
      lod0Index.set(`${px},${pz}`, node);
      stats.push({
        id: node.id, level: 0, inputTris: tris(src.mesh), outputTris: tris(src.mesh),
        lockedVerts: 0, errorWorld: 0, lowBenefit: false, polish: emptyDiagonalPolishStats(),
        buildMs: performance.now() - t0,
      });
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

  // ---- LOD1+ ----
  let prevCountX = worldPagesX, prevCountZ = worldPagesZ;
  for (let level = 1; level < maxLevels; level++) {
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
            if (children.length !== 4) {
              throw new ClodBuildError(
                "PageIncomplete",
                `parent L${level}:${nx},${nz} expected 4 children, got ${children.length}`,
              );
            }

            const merged = concat(children.map((c) => c.mesh));
            const { mesh: welded } = weldVertices(merged, eps, {
              position: cfg.validation.position_epsilon,
              normalDot: cfg.validation.normal_dot_min,
              material: cfg.validation.material_weight_epsilon,
            });
            validateWeldedIntermediate(welded, `L${level}:${nx},${nz} welded`, cfg.validation.zero_area_epsilon);
            const footprint = footprintFor(level, nx, nz, cfg);
        const locks = buildOuterBorderLocks(welded);
        const sim = simplifyPage(welded, locks, cfg);
        validateWeldedIntermediate(sim.mesh, `L${level}:${nx},${nz} after simplify`, cfg.validation.zero_area_epsilon);
        const polishLocks = buildOuterBorderLocks(sim.mesh);
        const polish = polishDiagonals(sim.mesh, polishLocks, pageMeshPolishConfig(cfg));
        validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);

        const errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
        const b = boundsOf(sim.mesh);
        const node: ClodPageNode = {
          id: `L${level}:${nx},${nz}`,
          level,
          children,
          mesh: sim.mesh,
          footprint,
          bounds: b,
          errorWorld,
          lowBenefit: sim.lowBenefit,
        };
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
        stats.push({
          id: node.id, level, inputTris: tris(welded), outputTris: tris(sim.mesh),
          lockedVerts: countLocks(locks), errorWorld, lowBenefit: sim.lowBenefit,
          polish,
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
  const { maxLevels } = resolveBuildShape(worldPagesX, worldPagesZ, cfg);
  const world = {
    cellsX: worldPagesX * cfg.page.chunks_per_page * cfg.page.chunk_size,
    cellsZ: worldPagesZ * cfg.page.chunks_per_page * cfg.page.chunk_size,
  };
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const stats: NodeBuildStat[] = [];
  const index: Map<string, ClodPageNode>[] = [];
  const total = estimatedNodeCount(worldPagesX, worldPagesZ, maxLevels);
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
      validatePageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz}`);
      const b = boundsOf(src.mesh);
      const node: ClodPageNode = {
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh: src.mesh,
        footprint: src.footprint,
        bounds: b,
        errorWorld: 0,
        lowBenefit: false,
        chunkMeshes: src.chunks,
      };
      lod0.push(node);
      lod0Index.set(`${px},${pz}`, node);
      stats.push({
        id: node.id, level: 0, inputTris: tris(src.mesh), outputTris: tris(src.mesh),
        lockedVerts: 0, errorWorld: 0, lowBenefit: false, polish: emptyDiagonalPolishStats(),
        buildMs: performance.now() - t0,
      });
      await tick(0, "LOD0 pages");
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

  let prevCountX = worldPagesX, prevCountZ = worldPagesZ;
  for (let level = 1; level < maxLevels; level++) {
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
        if (children.length !== 4) {
          throw new ClodBuildError(
            "PageIncomplete",
            `parent L${level}:${nx},${nz} expected 4 children, got ${children.length}`,
          );
        }

        const merged = concat(children.map((c) => c.mesh));
        const { mesh: welded } = weldVertices(merged, eps, {
          position: cfg.validation.position_epsilon,
          normalDot: cfg.validation.normal_dot_min,
          material: cfg.validation.material_weight_epsilon,
        });
        validateWeldedIntermediate(welded, `L${level}:${nx},${nz} welded`, cfg.validation.zero_area_epsilon);
        const footprint = footprintFor(level, nx, nz, cfg);
        const locks = buildOuterBorderLocks(welded);
        const sim = simplifyPage(welded, locks, cfg);
        validateWeldedIntermediate(sim.mesh, `L${level}:${nx},${nz} after simplify`, cfg.validation.zero_area_epsilon);
        const polishLocks = buildOuterBorderLocks(sim.mesh);
        const polish = polishDiagonals(sim.mesh, polishLocks, pageMeshPolishConfig(cfg));
        validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);

        const errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
        const b = boundsOf(sim.mesh);
        const node: ClodPageNode = {
          id: `L${level}:${nx},${nz}`,
          level,
          children,
          mesh: sim.mesh,
          footprint,
          bounds: b,
          errorWorld,
          lowBenefit: sim.lowBenefit,
        };
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
        stats.push({
          id: node.id, level, inputTris: tris(welded), outputTris: tris(sim.mesh),
          lockedVerts: countLocks(locks), errorWorld, lowBenefit: sim.lowBenefit,
          polish,
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

/** Per-level node lookup keyed "nx,nz" (recovered from the build-time ids). */
export type NodeIndex = Map<string, ClodPageNode>[];

export function buildNodeIndex(result: BuildResult): NodeIndex {
  const index: NodeIndex = [];
  for (const [level, nodes] of result.nodesByLevel) {
    const m = new Map<string, ClodPageNode>();
    for (const n of nodes) m.set(n.id.slice(n.id.indexOf(":") + 1), n);
    index[level] = m;
  }
  return index;
}

export interface Lod0RebuildResult {
  /** LOD0 nodes re-extracted from the field, mutated in place. */
  changed: ClodPageNode[];
  /** Page coords of the rebuilt LOD0 nodes — the seed for the ancestor chain. */
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  /** Chunks actually re-meshed vs. the chunks in the dirty pages (the per-chunk saving). */
  chunksRemeshed: number;
  chunksTotal: number;
}

/**
 * First stage of an edit rebuild: re-extract the LOD0 pages whose cells intersect `dirty`,
 * with the same hard-fail validation as the full build. Cheap relative to the ancestor
 * chain and it's the surface the player is looking at, so the viewer applies this
 * synchronously and defers {@link resimplifyParent} to later frames.
 */
export function rebuildDirtyLod0Pages(
  result: BuildResult,
  dirty: DirtyCellBounds,
  cfg: ClodPagesConfig,
  index: NodeIndex,
): Lod0RebuildResult {
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const world = {
    cellsX: result.worldPagesX * span,
    cellsZ: result.worldPagesZ * span,
  };

  const minPx = Math.max(0, Math.floor(dirty.minX / span));
  const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
  const minPz = Math.max(0, Math.floor(dirty.minZ / span));
  const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));

  const changed: ClodPageNode[] = [];
  const dirtyCoords: [number, number][] = [];
  let chunksRemeshed = 0;
  let chunksTotal = 0;
  const t0 = performance.now();
  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      const node = index[0]?.get(`${px},${pz}`);
      if (!node) continue;
      let mesh: PageMesh;
      if (node.chunkMeshes) {
        // re-mesh only the chunks the edit perturbs, then re-weld the page (== full rebuild)
        const r = rebuildPageChunks(node.chunkMeshes, px, pz, cfg, world, dirty);
        mesh = r.mesh;
        chunksRemeshed += r.remeshed;
        chunksTotal += node.chunkMeshes.length;
      } else {
        // no cached chunks (shouldn't happen post-build): full extract, then populate cache
        const src = buildLod0PageSource(px, pz, cfg, world);
        node.chunkMeshes = src.chunks;
        mesh = src.mesh;
        chunksRemeshed += src.chunks.length;
        chunksTotal += src.chunks.length;
      }
      validatePageMesh(mesh, node.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz} edit-rebuild`);
      node.mesh = mesh;
      node.bounds = boundsOf(mesh);
      changed.push(node);
      dirtyCoords.push([px, pz]);
    }
  }
  return {
    changed, dirtyCoords, lod0Pages: changed.length, lod0Ms: performance.now() - t0,
    chunksRemeshed, chunksTotal,
  };
}

/**
 * Second stage, one node at a time: re-simplify a single parent (merge 2x2 children -> weld
 * old internal page borders -> lock new outer border -> simplify -> accumulate error),
 * mutating it in place. Caller must have already rebuilt every dirty child at `level-1`
 * (process strictly lowest-level-first), so the merge reads current child meshes.
 * Returns the node, or null if it isn't in the tree.
 */
export function resimplifyParent(
  index: NodeIndex,
  level: number,
  key: string,
  cfg: ClodPagesConfig,
): ClodPageNode | null {
  const node = index[level]?.get(key);
  if (!node) return null;
  const children = node.children.filter((c): c is ClodPageNode => c !== null);
  const merged = concat(children.map((c) => c.mesh));
  const { mesh: welded } = weldVertices(merged, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  validateWeldedIntermediate(welded, `${node.id} welded`, cfg.validation.zero_area_epsilon);
  const locks = buildOuterBorderLocks(welded);
  const sim = simplifyPage(welded, locks, cfg);
  validateWeldedIntermediate(sim.mesh, `${node.id} resimplify`, cfg.validation.zero_area_epsilon);
  const polishLocks = buildOuterBorderLocks(sim.mesh);
  polishDiagonals(sim.mesh, polishLocks, pageMeshPolishConfig(cfg));
  validateFinalPageMesh(sim.mesh, node.footprint, cfg.validation.zero_area_epsilon, `${node.id} final`);
  node.mesh = sim.mesh;
  node.bounds = boundsOf(sim.mesh);
  node.errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
  node.lowBenefit = sim.lowBenefit;
  return node;
}

/**
 * Rebuild the LOD0 pages whose cells intersect `dirty`, then every ancestor up the
 * quadtree, with the same hard-fail validation as the full build. Nodes are mutated in
 * place so viewer/selection references stay valid. Synchronous end-to-end — the viewer
 * splits this into {@link rebuildDirtyLod0Pages} + per-frame {@link resimplifyParent};
 * tests and headless callers use this all-at-once form.
 */
export function rebuildDirtyPages(
  result: BuildResult,
  dirty: DirtyCellBounds,
  cfg: ClodPagesConfig,
): EditRebuildResult {
  const index = buildNodeIndex(result);
  const lod0 = rebuildDirtyLod0Pages(result, dirty, cfg, index);
  const changed = [...lod0.changed];

  const t1 = performance.now();
  let parentNodes = 0;
  const topLevel = Math.max(...result.nodesByLevel.keys());
  let dirtyCoords = lod0.dirtyCoords;
  for (let level = 1; level <= topLevel && dirtyCoords.length > 0; level++) {
    const parents = new Map<string, [number, number]>();
    for (const [nx, nz] of dirtyCoords) parents.set(`${nx >> 1},${nz >> 1}`, [nx >> 1, nz >> 1]);
    dirtyCoords = [];
    for (const [key, coord] of parents) {
      const node = resimplifyParent(index, level, key, cfg);
      if (!node) continue;
      changed.push(node);
      parentNodes++;
      dirtyCoords.push(coord);
    }
  }
  const parentMs = performance.now() - t1;

  return { changed, lod0Pages: lod0.lod0Pages, parentNodes, lod0Ms: lod0.lod0Ms, parentMs };
}
