import type { ClodPagesConfig } from "../config.js";
import { concat } from "../source_mesh.js";
import { weldVertices } from "../weld.js";
import { buildOuterBorderLocks } from "../lock.js";
import { simplifyPage } from "../simplify.js";
import { assertNoInternalBorders, stripDegenerateTriangles, validateFinite, validateWeldedIntermediate, validateFinalPageMesh } from "../validate.js";
import { type LevelStats, type BuildStats } from "./stats.js";
import { ClodBuildError, type ClodPageNode, type PageFootprint, type PageMesh } from "../types.js";

export interface TestBuildResult {
  nodesByLevel: Map<number, ClodPageNode[]>;
  stats: BuildStats;
}

function footprintFor(level: number, nx: number, nz: number, cfg: ClodPagesConfig): PageFootprint {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size;
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

export interface PageMeshProvider {
  (pageX: number, pageZ: number): PageMesh;
}

export function buildTestHierarchy(
  worldPagesX: number,
  worldPagesZ: number,
  cfg: ClodPagesConfig,
  meshProvider: PageMeshProvider,
): TestBuildResult {
  const eps = cfg.simplify.weld_epsilon_cells;
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const index: Map<string, ClodPageNode>[] = [];
  const levelStats: LevelStats[] = [];

  const lod0: ClodPageNode[] = [];
  const lod0Index = new Map<string, ClodPageNode>();
  for (let pz = 0; pz < worldPagesZ; pz++) {
    for (let px = 0; px < worldPagesX; px++) {
      const mesh = meshProvider(px, pz);
      const footprint = footprintFor(0, px, pz, cfg);
      stripDegenerateTriangles(mesh);
      assertNoInternalBorders(mesh, footprint);
      const b = boundsOf(mesh);
      lod0.push({
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh,
        footprint,
        bounds: b,
        errorWorld: 0,
        lowBenefit: false,
      });
      lod0Index.set(`${px},${pz}`, lod0[lod0.length - 1]);
    }
  }
  nodesByLevel.set(0, lod0);
  index[0] = lod0Index;
  levelStats.push({
    level: 0,
    nodeCount: lod0.length,
    inputTriangles: lod0.reduce((s, n) => s + n.mesh.indices.length / 3, 0),
    outputTriangles: lod0.reduce((s, n) => s + n.mesh.indices.length / 3, 0),
    reductionRatio: 1,
    lowBenefitCount: 0,
    averageErrorWorld: 0,
    maxErrorWorld: 0,
    averageBuildMs: 0,
    maxBuildMs: 0,
  });

  let prevCountX = worldPagesX;
  let prevCountZ = worldPagesZ;
  for (let level = 1; level < cfg.page.quadtree_levels; level++) {
    const countX = Math.ceil(prevCountX / 2);
    const countZ = Math.ceil(prevCountZ / 2);
    const levelNodes: ClodPageNode[] = [];
    const levelIndex = new Map<string, ClodPageNode>();
    const levelBuildMs: number[] = [];
    let totalInTris = 0;
    let totalOutTris = 0;
    let lowCount = 0;
    let errSum = 0;
    let maxErr = 0;

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
          throw new ClodBuildError("PageIncomplete", `parent L${level}:${nx},${nz} expected 4 children, got ${children.length}`);
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
        validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} final`);

        const errorWorld = sim.errorWorld + Math.max(...children.map((c) => c.errorWorld));
        if (errorWorld < Math.max(...children.map((c) => c.errorWorld))) {
          throw new Error(`L${level}:${nx},${nz} errorWorld ${errorWorld} < child max ${Math.max(...children.map((c) => c.errorWorld))}`);
        }
        const b = boundsOf(sim.mesh);
        levelNodes.push({
          id: `L${level}:${nx},${nz}`,
          level,
          children,
          mesh: sim.mesh,
          footprint,
          bounds: b,
          errorWorld,
          lowBenefit: sim.lowBenefit,
        });
        levelIndex.set(`${nx},${nz}`, levelNodes[levelNodes.length - 1]);
        totalInTris += welded.indices.length / 3;
        totalOutTris += sim.mesh.indices.length / 3;
        if (sim.lowBenefit) lowCount++;
        errSum += errorWorld;
        maxErr = Math.max(maxErr, errorWorld);
        levelBuildMs.push(performance.now() - t0);
      }
    }

    nodesByLevel.set(level, levelNodes);
    index[level] = levelIndex;
    prevCountX = countX;
    prevCountZ = countZ;

    const avgMs = levelBuildMs.length > 0 ? levelBuildMs.reduce((a, b) => a + b, 0) / levelBuildMs.length : 0;
    const maxMs = levelBuildMs.length > 0 ? Math.max(...levelBuildMs) : 0;
    const avgErr = levelNodes.length > 0 ? errSum / levelNodes.length : 0;
    levelStats.push({
      level,
      nodeCount: levelNodes.length,
      inputTriangles: totalInTris,
      outputTriangles: totalOutTris,
      reductionRatio: totalInTris > 0 ? totalOutTris / totalInTris : 1,
      lowBenefitCount: lowCount,
      averageErrorWorld: avgErr,
      maxErrorWorld: maxErr,
      averageBuildMs: avgMs,
      maxBuildMs: maxMs,
      perNodeBuildMs: levelBuildMs,
    });

    if (countX === 1 && countZ === 1) break;
  }

  const totalMs = levelStats.reduce((s, l) => s + l.averageBuildMs * l.nodeCount, 0);
  return {
    nodesByLevel,
    stats: {
      totalBuildMs: totalMs,
      levels: levelStats,
    },
  };
}

export function validateHierarchyInvariants(result: TestBuildResult, _cfg: ClodPagesConfig): void {
  for (const [level, nodes] of result.nodesByLevel) {
    for (const node of nodes) {
      if (node.mesh.indices.length % 3 !== 0) {
        throw new Error(`${node.id} has non-triangle index count ${node.mesh.indices.length}`);
      }
      if (node.mesh.indices.length === 0) {
        throw new Error(`${node.id} has empty mesh`);
      }
      if (node.mesh.positions.length / 3 !== node.mesh.normals.length / 3) {
        throw new Error(`${node.id} position/normal count mismatch`);
      }
      if (node.mesh.positions.length / 3 !== node.mesh.paintSlots.length) {
        throw new Error(`${node.id} position/material count mismatch`);
      }
      for (const v of node.mesh.positions) {
        if (!Number.isFinite(v)) throw new Error(`${node.id} has non-finite position`);
      }
      for (const v of node.mesh.normals) {
        if (!Number.isFinite(v)) throw new Error(`${node.id} has non-finite normal`);
      }
      for (const v of node.mesh.paintSlots) {
        if (!Number.isFinite(v)) throw new Error(`${node.id} has non-finite material`);
      }
      for (let i = 0; i < node.mesh.indices.length; i++) {
        const idx = node.mesh.indices[i];
        if (idx >= node.mesh.positions.length / 3) {
          throw new Error(`${node.id} has out-of-bounds index ${idx}`);
        }
      }
      if (level > 0) {
        assertNoInternalBorders(node.mesh, node.footprint);
      }
      validateFinite(node.mesh, node.id);
      if (level > 0 && node.children.length > 0) {
        const childMaxErr = Math.max(...node.children.filter((c): c is ClodPageNode => c !== null).map((c) => c.errorWorld));
        if (node.errorWorld < childMaxErr) {
          throw new Error(`${node.id}: errorWorld ${node.errorWorld} < child max ${childMaxErr}`);
        }
      }
    }
  }
}
