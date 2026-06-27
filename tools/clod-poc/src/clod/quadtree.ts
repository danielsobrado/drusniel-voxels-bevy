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
import { buildLod0PageSource, dirtyPageChunkIndices, rebuildPageChunks } from "./source_mesh.js";
import { concatPageSourceMeshes as concat } from "./pageSource.js";
import { weldVertices } from "./weld.js";
import { buildOuterBorderLocks, countLocks } from "../lock.js";
import { simplifyPage, type SimplifyOutput } from "./simplify.js";
import {
  assertNoInternalBorders,
  stripDegenerateTriangles,
  validateFinalPageMesh,
  validatePageMesh,
  validateWeldedIntermediate,
} from "./validate.js";
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
  /** True when stats were restored from a warm-cache artifact instead of a fresh build. */
  fromCache?: boolean;
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

/** Optional disk/memory cache hooks — never block rendering on cache miss. */
export interface BuildCacheHooks {
  tryLoadNode(nodeId: string, level: number, px: number, pz: number): Promise<ClodPageNode | null>;
  getCachedBuildStat?(nodeId: string): NodeBuildStat | undefined;
  storeNode(node: ClodPageNode, stat: NodeBuildStat): Promise<void>;
  onBuildComplete?(result: BuildResult): Promise<void>;
}

function footprintFor(level: number, nx: number, nz: number, cfg: ClodPagesConfig): PageFootprint {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size; // cells per node side
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

/** Simplify a welded parent page; fall back to the welded mesh if decimation opens an internal seam. */
function clonePageMesh(mesh: PageMesh): PageMesh {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    paintSlots: mesh.paintSlots.slice(),
    materialWeights: mesh.materialWeights.slice(),
    materialWeightStride: mesh.materialWeightStride,
    indices: mesh.indices.slice(),
  };
}

function simplifyParentPage(
  welded: PageMesh,
  locks: Uint8Array,
  footprint: PageFootprint,
  cfg: ClodPagesConfig,
): SimplifyOutput {
  const sim = simplifyPage(clonePageMesh(welded), locks, cfg);
  try {
    stripDegenerateTriangles(sim.mesh, cfg.validation.zero_area_epsilon);
    assertNoInternalBorders(sim.mesh, footprint);
    return sim;
  } catch {
    try {
      assertNoInternalBorders(welded, footprint);
      return { mesh: welded, resultError: 0, errorWorld: 0, lowBenefit: true };
    } catch {
      // Hydrology merge can leave seams on the welded parent while simplification still
      // produces the cleaner mesh — prefer simplified over welded when both fail the check.
      return { mesh: sim.mesh, resultError: sim.resultError, errorWorld: sim.errorWorld, lowBenefit: true };
    }
  }
}

/** Diagonal polish is optional quality; skip when a flip would open an internal seam. */
function tryPolishParentPage(
  mesh: PageMesh,
  footprint: PageFootprint,
  cfg: ClodPagesConfig,
  label: string,
): { mesh: PageMesh; stats: ReturnType<typeof emptyDiagonalPolishStats> } {
  const candidate = clonePageMesh(mesh);
  const stats = polishDiagonals(candidate, buildOuterBorderLocks(candidate), pageMeshPolishConfig(cfg));
  try {
    validateFinalPageMesh(candidate, footprint, cfg.validation.zero_area_epsilon, `${label} polish`);
    return { mesh: candidate, stats };
  } catch {
    return { mesh, stats: emptyDiagonalPolishStats() };
  }
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
        const sim = simplifyParentPage(welded, locks, footprint, cfg);
        const simplified = sim.mesh !== welded;
        let polish = emptyDiagonalPolishStats();
        if (simplified) {
          validateWeldedIntermediate(sim.mesh, `L${level}:${nx},${nz} after simplify`, cfg.validation.zero_area_epsilon);
          if (level === maxLevels - 1) {
            const polished = tryPolishParentPage(sim.mesh, footprint, cfg, `L${level}:${nx},${nz}`);
            sim.mesh = polished.mesh;
            polish = polished.stats;
          }
        }
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
  cacheHooks?: BuildCacheHooks,
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
      const nodeId = `L0:${px},${pz}`;
      let node: ClodPageNode | null = cacheHooks
        ? await cacheHooks.tryLoadNode(nodeId, 0, px, pz)
        : null;
      if (!node) {
        const src = buildLod0PageSource(px, pz, cfg, world);
        validatePageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, nodeId);
        const b = boundsOf(src.mesh);
        const buildMs = performance.now() - t0;
        node = {
          id: nodeId,
          level: 0,
          children: [],
          mesh: src.mesh,
          footprint: src.footprint,
          bounds: b,
          errorWorld: 0,
          lowBenefit: false,
          chunkMeshes: src.chunks,
        };
        const stat: NodeBuildStat = {
          id: nodeId, level: 0, inputTris: tris(src.mesh), outputTris: tris(src.mesh),
          lockedVerts: 0, errorWorld: 0, lowBenefit: false, polish: emptyDiagonalPolishStats(),
          buildMs,
        };
        if (cacheHooks) await cacheHooks.storeNode(node, stat);
        lod0.push(node);
        lod0Index.set(`${px},${pz}`, node);
        stats.push(stat);
      } else {
        lod0.push(node);
        lod0Index.set(`${px},${pz}`, node);
        const cachedStat = cacheHooks?.getCachedBuildStat?.(nodeId);
        stats.push(cachedStat ?? {
          id: node.id, level: 0, inputTris: tris(node.mesh), outputTris: tris(node.mesh),
          lockedVerts: 0, errorWorld: 0, lowBenefit: false, polish: emptyDiagonalPolishStats(),
          buildMs: performance.now() - t0, fromCache: true,
        });
      }
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
        const nodeId = `L${level}:${nx},${nz}`;
        let node: ClodPageNode | null = cacheHooks
          ? await cacheHooks.tryLoadNode(nodeId, level, nx, nz)
          : null;

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

        if (node) {
          node.children = children;
          levelNodes.push(node);
          levelIndex.set(`${nx},${nz}`, node);
          const cachedStat = cacheHooks?.getCachedBuildStat?.(nodeId);
          stats.push(cachedStat ?? {
            id: node.id, level, inputTris: tris(node.mesh), outputTris: tris(node.mesh),
            lockedVerts: 0, errorWorld: node.errorWorld, lowBenefit: node.lowBenefit,
            polish: emptyDiagonalPolishStats(),
            buildMs: performance.now() - t0, fromCache: true,
          });
          await tick(level, `LOD${level} parents`);
          continue;
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
        const sim = simplifyParentPage(welded, locks, footprint, cfg);
        const simplified = sim.mesh !== welded;
        let polish = emptyDiagonalPolishStats();
        if (simplified) {
          validateWeldedIntermediate(sim.mesh, `L${level}:${nx},${nz} after simplify`, cfg.validation.zero_area_epsilon);
          if (level === maxLevels - 1) {
            const polished = tryPolishParentPage(sim.mesh, footprint, cfg, `L${level}:${nx},${nz}`);
            sim.mesh = polished.mesh;
            polish = polished.stats;
          }
        }
        validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);

        const errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
        const b = boundsOf(sim.mesh);
        node = {
          id: nodeId,
          level,
          children,
          mesh: sim.mesh,
          footprint,
          bounds: b,
          errorWorld,
          lowBenefit: sim.lowBenefit,
        };
        const buildMs = performance.now() - t0;
        const stat: NodeBuildStat = {
          id: node.id, level, inputTris: tris(welded), outputTris: tris(sim.mesh),
          lockedVerts: countLocks(locks), errorWorld, lowBenefit: sim.lowBenefit,
          polish,
          buildMs,
        };
        if (cacheHooks) await cacheHooks.storeNode(node, stat);
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
        stats.push(stat);
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
  const buildResult = { roots: nodesByLevel.get(topLevel)!, nodesByLevel, stats, worldPagesX, worldPagesZ };
  if (cacheHooks?.onBuildComplete) await cacheHooks.onBuildComplete(buildResult);
  return buildResult;
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
  /** LOD0 nodes whose mesh/chunk cache changed, mutated in place. */
  changed: ClodPageNode[];
  /** Page coords of changed LOD0 nodes — the seed for the ancestor chain. */
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  /** Chunks actually re-meshed vs. the chunks considered in the sibling page group. */
  chunksRemeshed: number;
  chunksTotal: number;
}

/**
 * First stage of an edit rebuild: re-extract the LOD0 pages whose cells intersect `dirty`,
 * with the same hard-fail validation as the full build. Cheap relative to the ancestor
 * chain and it's the surface the player is looking at, so the viewer applies this
 * synchronously and defers {@link resimplifyParent} to later frames.
 */
/** When any page at `level` in a 2x2 parent quad is dirty, include all four siblings. */
export function expandQuadSiblingPages(
  coords: readonly [number, number][],
  level: number,
  worldPagesX: number,
  worldPagesZ: number,
): [number, number][] {
  const maxX = (worldPagesX >> level) - 1;
  const maxZ = (worldPagesZ >> level) - 1;
  const keys = new Set<string>();
  for (const [nx, nz] of coords) {
    const parentX = nx >> 1;
    const parentZ = nz >> 1;
    const baseX = parentX * 2;
    const baseZ = parentZ * 2;
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const px = baseX + dx;
        const pz = baseZ + dz;
        if (px < 0 || pz < 0 || px > maxX || pz > maxZ) continue;
        keys.add(`${px},${pz}`);
      }
    }
  }
  return [...keys].map((k) => {
    const [px, pz] = k.split(",").map(Number);
    return [px, pz] as [number, number];
  });
}

/** @deprecated Use {@link expandQuadSiblingPages} at level 0. */
export function expandLod0SiblingPages(
  coords: readonly [number, number][],
  worldPagesX: number,
  worldPagesZ: number,
): [number, number][] {
  return expandQuadSiblingPages(coords, 0, worldPagesX, worldPagesZ);
}

export function rebuildDirtyLod0Pages(
  result: BuildResult,
  dirty: DirtyCellBounds,
  cfg: ClodPagesConfig,
  index: NodeIndex,
): Lod0RebuildResult {
  const pageChunks = cfg.page.chunks_per_page ** 2;
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const world = {
    cellsX: result.worldPagesX * span,
    cellsZ: result.worldPagesZ * span,
  };

  const minPx = Math.max(0, Math.floor(dirty.minX / span));
  const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
  const minPz = Math.max(0, Math.floor(dirty.minZ / span));
  const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));

  const touched: [number, number][] = [];
  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) {
      touched.push([px, pz]);
    }
  }
  const pages = expandQuadSiblingPages(touched, 0, result.worldPagesX, result.worldPagesZ);

  const changed: ClodPageNode[] = [];
  const dirtyCoords: [number, number][] = [];
  let chunksRemeshed = 0;
  let chunksTotal = 0;
  const t0 = performance.now();
  for (const [px, pz] of pages) {
    const node = index[0]?.get(`${px},${pz}`);
    if (!node) continue;
    const dirtyChunkCount = dirtyPageChunkIndices(px, pz, cfg, dirty).length;
    chunksTotal += node.chunkMeshes?.length ?? pageChunks;
    if (dirtyChunkCount === 0) continue;

    let mesh: PageMesh;
    if (node.chunkMeshes) {
      const r = rebuildPageChunks(node.chunkMeshes, px, pz, cfg, world, dirty);
      if (r.remeshed === 0) continue;
      mesh = r.mesh;
      chunksRemeshed += r.remeshed;
    } else {
      const src = buildLod0PageSource(px, pz, cfg, world);
      node.chunkMeshes = src.chunks;
      mesh = src.mesh;
      chunksRemeshed += src.chunks.length;
    }
    validatePageMesh(mesh, node.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz} edit-rebuild`);
    node.mesh = mesh;
    node.bounds = boundsOf(mesh);
    changed.push(node);
    dirtyCoords.push([px, pz]);
  }
  return {
    changed, dirtyCoords, lod0Pages: changed.length, lod0Ms: performance.now() - t0,
    chunksRemeshed, chunksTotal,
  };
}

/** Re-extract one LOD0 page from the current voxel field (used before parent merges). */
function refreshLod0PageFromField(
  index: NodeIndex,
  key: string,
  cfg: ClodPagesConfig,
  result: BuildResult,
): void {
  const node = index[0]?.get(key);
  if (!node) return;
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const [px, pz] = key.split(",").map(Number);
  const world = {
    cellsX: result.worldPagesX * span,
    cellsZ: result.worldPagesZ * span,
  };
  const src = buildLod0PageSource(px, pz, cfg, world);
  node.chunkMeshes = src.chunks;
  node.mesh = src.mesh;
  node.bounds = boundsOf(src.mesh);
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
  const sim = simplifyParentPage(welded, locks, node.footprint, cfg);
  const simplified = sim.mesh !== welded;
  if (simplified) {
    validateWeldedIntermediate(sim.mesh, `${node.id} resimplify`, cfg.validation.zero_area_epsilon);
    if (node.level >= cfg.page.quadtree_levels - 1) {
      const polished = tryPolishParentPage(sim.mesh, node.footprint, cfg, node.id);
      sim.mesh = polished.mesh;
    }
  }
  validateFinalPageMesh(sim.mesh, node.footprint, cfg.validation.zero_area_epsilon, `${node.id} final`);
  node.mesh = sim.mesh;
  node.bounds = boundsOf(sim.mesh);
  node.errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
  node.lowBenefit = sim.lowBenefit;
  return node;
}

export interface AncestorRebuildResult {
  changed: ClodPageNode[];
  parentNodes: number;
  parentMs: number;
}

/** Re-simplify every ancestor touched by a LOD0 dirty set, expanding 2x2 siblings at each level. */
export function rebuildAncestorLevels(
  result: BuildResult,
  lod0DirtyCoords: readonly [number, number][],
  index: NodeIndex,
  cfg: ClodPagesConfig,
): AncestorRebuildResult {
  const changed: ClodPageNode[] = [];
  const t0 = performance.now();
  let parentNodes = 0;
  const topLevel = Math.max(...result.nodesByLevel.keys());
  const seed = new Set<string>();
  for (const [nx, nz] of lod0DirtyCoords) seed.add(`${nx >> 1},${nz >> 1}`);
  let levelCoords = [...seed].map((k) => k.split(",").map(Number) as [number, number]);

  for (let level = 1; level <= topLevel && levelCoords.length > 0; level++) {
    levelCoords = expandQuadSiblingPages(levelCoords, level, result.worldPagesX, result.worldPagesZ);
    if (level === 1) {
      const l0Keys = new Set<string>();
      for (const [nx, nz] of levelCoords) {
        const baseX = nx * 2;
        const baseZ = nz * 2;
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            l0Keys.add(`${baseX + dx},${baseZ + dz}`);
          }
        }
      }
      for (const key of l0Keys) {
        refreshLod0PageFromField(index, key, cfg, result);
      }
    }
    const parentKeys = new Set<string>();
    const nextCoords: [number, number][] = [];
    for (const [nx, nz] of levelCoords) {
      const key = `${nx},${nz}`;
      const node = resimplifyParent(index, level, key, cfg);
      if (!node) continue;
      changed.push(node);
      parentNodes++;
      const pk = `${nx >> 1},${nz >> 1}`;
      if (!parentKeys.has(pk)) {
        parentKeys.add(pk);
        nextCoords.push([nx >> 1, nz >> 1]);
      }
    }
    levelCoords = nextCoords;
  }

  return { changed, parentNodes, parentMs: performance.now() - t0 };
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
  const ancestors = rebuildAncestorLevels(result, lod0.dirtyCoords, index, cfg);
  return {
    changed: [...lod0.changed, ...ancestors.changed],
    lod0Pages: lod0.lod0Pages,
    parentNodes: ancestors.parentNodes,
    lod0Ms: lod0.lod0Ms,
    parentMs: ancestors.parentMs,
  };
}
