// Quadtree build orchestration.
//
// LOD0 node  = welded chunk meshes (source_mesh.ts), error_world = 0.
// LODk node  = merge 2x2 children -> weld old internal page borders -> lock new outer
//              border -> simplify (carry attrs) -> accumulate error.
//
// Invariants: lower LODs are NEVER re-extracted from the field (I2) — every parent is a
// decimation of its merged children. Locked outer borders are bit-identical across
// siblings (inherited verbatim from LOD0), so internal borders weld exactly.

import { ClodBuildError, ClodPageNode, PageFootprint, PageMesh } from "../types.js";
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
import { emptyDiagonalPolishStats, polishDiagonals, type DiagonalPolishStats } from "../diagonalPolish.js";

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

export interface BuildCacheHooks {
  tryLoadNode(nodeId: string, level: number, px: number, pz: number): Promise<ClodPageNode | null>;
  getCachedBuildStat?(nodeId: string): NodeBuildStat | undefined;
  storeNode(node: ClodPageNode, stat: NodeBuildStat): Promise<void>;
  onBuildComplete?(result: BuildResult): Promise<void>;
}

export interface DirtyCellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface EditRebuildResult {
  changed: ClodPageNode[];
  lod0Pages: number;
  parentNodes: number;
  lod0Ms: number;
  parentMs: number;
}

export interface Lod0RebuildResult {
  changed: ClodPageNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  chunksRemeshed: number;
  chunksTotal: number;
}

export interface AncestorRebuildResult {
  changed: ClodPageNode[];
  parentNodes: number;
  parentMs: number;
}

export type NodeIndex = Map<string, ClodPageNode>[];

interface ParentBuildOutput {
  mesh: PageMesh;
  inputTris: number;
  lockedVerts: number;
  errorWorld: number;
  lowBenefit: boolean;
  polish: DiagonalPolishStats;
}

interface Lod0NodeBackup {
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  chunkMeshes?: PageMesh[];
}

interface ParentNodeBackup {
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  errorWorld: number;
  lowBenefit: boolean;
}

const tris = (mesh: PageMesh): number => mesh.indices.length / 3;

function footprintFor(level: number, nx: number, nz: number, cfg: ClodPagesConfig): PageFootprint {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size;
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

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

function cloneBounds(bounds: ClodPageNode["bounds"]): ClodPageNode["bounds"] {
  return {
    center: [...bounds.center],
    radius: bounds.radius,
    minY: bounds.minY,
    maxY: bounds.maxY,
  };
}

function backupLod0Node(node: ClodPageNode): Lod0NodeBackup {
  return {
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    chunkMeshes: node.chunkMeshes ? [...node.chunkMeshes] : undefined,
  };
}

function backupAllLod0Nodes(result: BuildResult): Map<ClodPageNode, Lod0NodeBackup> {
  const backups = new Map<ClodPageNode, Lod0NodeBackup>();
  for (const node of result.nodesByLevel.get(0) ?? []) backups.set(node, backupLod0Node(node));
  return backups;
}

function restoreLod0Backups(backups: ReadonlyMap<ClodPageNode, Lod0NodeBackup>): void {
  for (const [node, backup] of backups) {
    node.mesh = backup.mesh;
    node.bounds = cloneBounds(backup.bounds);
    if (backup.chunkMeshes) node.chunkMeshes = backup.chunkMeshes;
    else delete node.chunkMeshes;
  }
}

function backupParentNode(node: ClodPageNode): ParentNodeBackup {
  return {
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    errorWorld: node.errorWorld,
    lowBenefit: node.lowBenefit,
  };
}

function restoreParentBackups(backups: ReadonlyMap<ClodPageNode, ParentNodeBackup>): void {
  for (const [node, backup] of backups) {
    node.mesh = backup.mesh;
    node.bounds = cloneBounds(backup.bounds);
    node.errorWorld = backup.errorWorld;
    node.lowBenefit = backup.lowBenefit;
  }
}

function simplifyParentPage(welded: PageMesh, locks: Uint8Array, footprint: PageFootprint, cfg: ClodPagesConfig): SimplifyOutput {
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
      return { mesh: sim.mesh, resultError: sim.resultError, errorWorld: sim.errorWorld, lowBenefit: true };
    }
  }
}

function pageMeshPolishConfig(cfg: ClodPagesConfig) {
  return { ...cfg.polish.diagonal_flip, material_error_weight: 0 };
}

function tryPolishParentPage(
  mesh: PageMesh,
  footprint: PageFootprint,
  cfg: ClodPagesConfig,
  label: string,
): { mesh: PageMesh; stats: DiagonalPolishStats } {
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
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    radius = Math.max(
      radius,
      Math.hypot(mesh.positions[i] - center[0], mesh.positions[i + 1] - center[1], mesh.positions[i + 2] - center[2]),
    );
  }
  return { center, radius, minY, maxY };
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
    } else {
      setTimeout(resolve, 0);
    }
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

function requireFourChildren(level: number, nx: number, nz: number, children: readonly ClodPageNode[]): void {
  if (children.length !== 4) {
    throw new ClodBuildError("PageIncomplete", `parent L${level}:${nx},${nz} expected 4 children, got ${children.length}`);
  }
}

function childNodes(index: Map<string, ClodPageNode>[], level: number, nx: number, nz: number): ClodPageNode[] {
  const children: ClodPageNode[] = [];
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const child = index[level - 1].get(`${nx * 2 + dx},${nz * 2 + dz}`);
      if (child) children.push(child);
    }
  }
  requireFourChildren(level, nx, nz, children);
  return children;
}

function buildParentOutput(
  level: number,
  nx: number,
  nz: number,
  children: readonly ClodPageNode[],
  cfg: ClodPagesConfig,
  polishTopLevel: boolean,
): ParentBuildOutput {
  requireFourChildren(level, nx, nz, children);
  const merged = concat(children.map((child) => child.mesh));
  const { mesh: welded } = weldVertices(merged, cfg.simplify.weld_epsilon_cells, {
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
    if (polishTopLevel) {
      const polished = tryPolishParentPage(sim.mesh, footprint, cfg, `L${level}:${nx},${nz}`);
      sim.mesh = polished.mesh;
      polish = polished.stats;
    }
  }
  validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);
  return {
    mesh: sim.mesh,
    inputTris: tris(welded),
    lockedVerts: countLocks(locks),
    errorWorld: sim.errorWorld + Math.max(...children.map((child) => child.errorWorld)),
    lowBenefit: sim.lowBenefit,
    polish,
  };
}

function createParentNode(
  level: number,
  nx: number,
  nz: number,
  children: readonly ClodPageNode[],
  cfg: ClodPagesConfig,
  polishTopLevel: boolean,
): { node: ClodPageNode; stat: Omit<NodeBuildStat, "buildMs"> } {
  const built = buildParentOutput(level, nx, nz, children, cfg, polishTopLevel);
  const node: ClodPageNode = {
    id: `L${level}:${nx},${nz}`,
    level,
    children: [...children],
    mesh: built.mesh,
    footprint: footprintFor(level, nx, nz, cfg),
    bounds: boundsOf(built.mesh),
    errorWorld: built.errorWorld,
    lowBenefit: built.lowBenefit,
  };
  const stat = {
    id: node.id,
    level,
    inputTris: built.inputTris,
    outputTris: tris(built.mesh),
    lockedVerts: built.lockedVerts,
    errorWorld: built.errorWorld,
    lowBenefit: built.lowBenefit,
    polish: built.polish,
  };
  return { node, stat };
}

export function buildWorld(worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig): BuildResult {
  const { maxLevels } = resolveBuildShape(worldPagesX, worldPagesZ, cfg);
  const world = {
    cellsX: worldPagesX * cfg.page.chunks_per_page * cfg.page.chunk_size,
    cellsZ: worldPagesZ * cfg.page.chunks_per_page * cfg.page.chunk_size,
  };
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const stats: NodeBuildStat[] = [];
  const index: Map<string, ClodPageNode>[] = [];

  const lod0: ClodPageNode[] = [];
  const lod0Index = new Map<string, ClodPageNode>();
  for (let pz = 0; pz < worldPagesZ; pz++) {
    for (let px = 0; px < worldPagesX; px++) {
      const startedAt = performance.now();
      const src = buildLod0PageSource(px, pz, cfg, world);
      validatePageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, `L0:${px},${pz}`);
      const node: ClodPageNode = {
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh: src.mesh,
        footprint: src.footprint,
        bounds: boundsOf(src.mesh),
        errorWorld: 0,
        lowBenefit: false,
        chunkMeshes: src.chunks,
      };
      lod0.push(node);
      lod0Index.set(`${px},${pz}`, node);
      stats.push({
        id: node.id,
        level: 0,
        inputTris: tris(src.mesh),
        outputTris: tris(src.mesh),
        lockedVerts: 0,
        errorWorld: 0,
        lowBenefit: false,
        polish: emptyDiagonalPolishStats(),
        buildMs: performance.now() - startedAt,
      });
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

  let prevCountX = worldPagesX;
  let prevCountZ = worldPagesZ;
  for (let level = 1; level < maxLevels; level++) {
    const countX = Math.ceil(prevCountX / 2);
    const countZ = Math.ceil(prevCountZ / 2);
    const levelNodes: ClodPageNode[] = [];
    const levelIndex = new Map<string, ClodPageNode>();
    for (let nz = 0; nz < countZ; nz++) {
      for (let nx = 0; nx < countX; nx++) {
        const startedAt = performance.now();
        const { node, stat } = createParentNode(level, nx, nz, childNodes(index, level, nx, nz), cfg, level === maxLevels - 1);
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
        stats.push({ ...stat, buildMs: performance.now() - startedAt });
      }
    }
    nodesByLevel.set(level, levelNodes);
    index[level] = levelIndex;
    prevCountX = countX;
    prevCountZ = countZ;
    if (countX === 1 && countZ === 1) break;
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

  const tick = async (level: number, phase: string): Promise<void> => {
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
      const startedAt = performance.now();
      const nodeId = `L0:${px},${pz}`;
      let node = cacheHooks ? await cacheHooks.tryLoadNode(nodeId, 0, px, pz) : null;
      if (!node) {
        const src = buildLod0PageSource(px, pz, cfg, world);
        validatePageMesh(src.mesh, src.footprint, cfg.validation.zero_area_epsilon, nodeId);
        const buildMs = performance.now() - startedAt;
        node = {
          id: nodeId,
          level: 0,
          children: [],
          mesh: src.mesh,
          footprint: src.footprint,
          bounds: boundsOf(src.mesh),
          errorWorld: 0,
          lowBenefit: false,
          chunkMeshes: src.chunks,
        };
        const stat: NodeBuildStat = {
          id: nodeId,
          level: 0,
          inputTris: tris(src.mesh),
          outputTris: tris(src.mesh),
          lockedVerts: 0,
          errorWorld: 0,
          lowBenefit: false,
          polish: emptyDiagonalPolishStats(),
          buildMs,
        };
        if (cacheHooks) await cacheHooks.storeNode(node, stat);
        stats.push(stat);
      } else {
        const cachedStat = cacheHooks?.getCachedBuildStat?.(nodeId);
        stats.push(cachedStat ?? {
          id: node.id,
          level: 0,
          inputTris: tris(node.mesh),
          outputTris: tris(node.mesh),
          lockedVerts: 0,
          errorWorld: 0,
          lowBenefit: false,
          polish: emptyDiagonalPolishStats(),
          buildMs: performance.now() - startedAt,
          fromCache: true,
        });
      }
      lod0.push(node);
      lod0Index.set(`${px},${pz}`, node);
      await tick(0, "LOD0 pages");
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;

  let prevCountX = worldPagesX;
  let prevCountZ = worldPagesZ;
  for (let level = 1; level < maxLevels; level++) {
    const countX = Math.ceil(prevCountX / 2);
    const countZ = Math.ceil(prevCountZ / 2);
    const levelNodes: ClodPageNode[] = [];
    const levelIndex = new Map<string, ClodPageNode>();
    for (let nz = 0; nz < countZ; nz++) {
      for (let nx = 0; nx < countX; nx++) {
        const startedAt = performance.now();
        const nodeId = `L${level}:${nx},${nz}`;
        const children = childNodes(index, level, nx, nz);
        let node = cacheHooks ? await cacheHooks.tryLoadNode(nodeId, level, nx, nz) : null;
        if (node) {
          node.children = children;
          const cachedStat = cacheHooks?.getCachedBuildStat?.(nodeId);
          stats.push(cachedStat ?? {
            id: node.id,
            level,
            inputTris: tris(node.mesh),
            outputTris: tris(node.mesh),
            lockedVerts: 0,
            errorWorld: node.errorWorld,
            lowBenefit: node.lowBenefit,
            polish: emptyDiagonalPolishStats(),
            buildMs: performance.now() - startedAt,
            fromCache: true,
          });
        } else {
          const built = createParentNode(level, nx, nz, children, cfg, level === maxLevels - 1);
          node = built.node;
          const stat = { ...built.stat, buildMs: performance.now() - startedAt };
          if (cacheHooks) await cacheHooks.storeNode(node, stat);
          stats.push(stat);
        }
        levelNodes.push(node);
        levelIndex.set(`${nx},${nz}`, node);
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

export function buildNodeIndex(result: BuildResult): NodeIndex {
  const index: NodeIndex = [];
  for (const [level, nodes] of result.nodesByLevel) {
    const byCoord = new Map<string, ClodPageNode>();
    for (const node of nodes) byCoord.set(node.id.slice(node.id.indexOf(":") + 1), node);
    index[level] = byCoord;
  }
  return index;
}

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
    const baseX = (nx >> 1) * 2;
    const baseZ = (nz >> 1) * 2;
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const px = baseX + dx;
        const pz = baseZ + dz;
        if (px < 0 || pz < 0 || px > maxX || pz > maxZ) continue;
        keys.add(`${px},${pz}`);
      }
    }
  }
  return [...keys].map((key) => key.split(",").map(Number) as [number, number]);
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
  const world = { cellsX: result.worldPagesX * span, cellsZ: result.worldPagesZ * span };
  const minPx = Math.max(0, Math.floor(dirty.minX / span));
  const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
  const minPz = Math.max(0, Math.floor(dirty.minZ / span));
  const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));
  const touched: [number, number][] = [];
  for (let pz = minPz; pz <= maxPz; pz++) {
    for (let px = minPx; px <= maxPx; px++) touched.push([px, pz]);
  }
  const pages = expandQuadSiblingPages(touched, 0, result.worldPagesX, result.worldPagesZ);
  const changed: ClodPageNode[] = [];
  const dirtyCoords: [number, number][] = [];
  const backups = new Map<ClodPageNode, Lod0NodeBackup>();
  let chunksRemeshed = 0;
  let chunksTotal = 0;
  const startedAt = performance.now();

  try {
    for (const [px, pz] of pages) {
      const node = index[0]?.get(`${px},${pz}`);
      if (!node) continue;
      const dirtyChunkCount = dirtyPageChunkIndices(px, pz, cfg, dirty).length;
      chunksTotal += node.chunkMeshes?.length ?? pageChunks;
      if (dirtyChunkCount === 0) continue;
      if (!backups.has(node)) backups.set(node, backupLod0Node(node));

      let mesh: PageMesh;
      if (node.chunkMeshes) {
        const rebuilt = rebuildPageChunks(node.chunkMeshes, px, pz, cfg, world, dirty);
        if (rebuilt.remeshed === 0) continue;
        mesh = rebuilt.mesh;
        chunksRemeshed += rebuilt.remeshed;
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
  } catch (error) {
    restoreLod0Backups(backups);
    throw error;
  }

  return { changed, dirtyCoords, lod0Pages: changed.length, lod0Ms: performance.now() - startedAt, chunksRemeshed, chunksTotal };
}

export function resimplifyParent(
  index: NodeIndex,
  level: number,
  key: string,
  cfg: ClodPagesConfig,
  polishTopLevel = level >= cfg.page.quadtree_levels - 1,
): ClodPageNode | null {
  const node = index[level]?.get(key);
  if (!node) return null;
  const children = node.children.filter((child): child is ClodPageNode => child !== null);
  const [nx, nz] = key.split(",").map(Number);
  requireFourChildren(level, nx, nz, children);
  const built = buildParentOutput(level, nx, nz, children, cfg, polishTopLevel);
  node.mesh = built.mesh;
  node.bounds = boundsOf(built.mesh);
  node.errorWorld = built.errorWorld;
  node.lowBenefit = built.lowBenefit;
  return node;
}

export function rebuildAncestorLevels(
  result: BuildResult,
  lod0DirtyCoords: readonly [number, number][],
  index: NodeIndex,
  cfg: ClodPagesConfig,
): AncestorRebuildResult {
  const changed: ClodPageNode[] = [];
  const backups = new Map<ClodPageNode, ParentNodeBackup>();
  const startedAt = performance.now();
  let parentNodes = 0;
  const topLevel = Math.max(...result.nodesByLevel.keys());
  const seed = new Set<string>();
  for (const [nx, nz] of lod0DirtyCoords) seed.add(`${nx >> 1},${nz >> 1}`);
  let levelCoords = [...seed].map((key) => key.split(",").map(Number) as [number, number]);

  try {
    for (let level = 1; level <= topLevel && levelCoords.length > 0; level++) {
      levelCoords = expandQuadSiblingPages(levelCoords, level, result.worldPagesX, result.worldPagesZ);
      const nextKeys = new Set<string>();
      const nextCoords: [number, number][] = [];
      for (const [nx, nz] of levelCoords) {
        const key = `${nx},${nz}`;
        const target = index[level]?.get(key);
        if (!target) continue;
        if (!backups.has(target)) backups.set(target, backupParentNode(target));
        const node = resimplifyParent(index, level, key, cfg, level === topLevel);
        if (!node) continue;
        changed.push(node);
        parentNodes++;
        const parentKey = `${nx >> 1},${nz >> 1}`;
        if (!nextKeys.has(parentKey)) {
          nextKeys.add(parentKey);
          nextCoords.push([nx >> 1, nz >> 1]);
        }
      }
      levelCoords = nextCoords;
    }
  } catch (error) {
    restoreParentBackups(backups);
    throw error;
  }

  return { changed, parentNodes, parentMs: performance.now() - startedAt };
}

export function rebuildDirtyPages(result: BuildResult, dirty: DirtyCellBounds, cfg: ClodPagesConfig): EditRebuildResult {
  const lod0Backups = backupAllLod0Nodes(result);
  const index = buildNodeIndex(result);
  try {
    const lod0 = rebuildDirtyLod0Pages(result, dirty, cfg, index);
    const ancestors = rebuildAncestorLevels(result, lod0.dirtyCoords, index, cfg);
    return {
      changed: [...lod0.changed, ...ancestors.changed],
      lod0Pages: lod0.lod0Pages,
      parentNodes: ancestors.parentNodes,
      lod0Ms: lod0.lod0Ms,
      parentMs: ancestors.parentMs,
    };
  } catch (error) {
    restoreLod0Backups(lod0Backups);
    throw error;
  }
}
