import { DEFAULT_DIAGONAL_FLIP_CONFIG, type DiagonalFlipConfig } from "./config.js";
import type { PageMesh } from "./types.js";
import {
  add,
  dot,
  finiteVec3,
  materialDistanceSquared,
  normalize,
  triangleArea,
  triangleMinAngleDegrees,
  triangleNormal,
  type Vec3,
} from "./clod/triangle_quality.js";

export type DiagonalId = "ac" | "bd";
export type DiagonalChoice = "keep" | "flip" | "reject";
export type DiagonalRejectReason = "degenerate" | "winding";

export interface QuadVertex {
  position: Vec3;
  normal?: Vec3;
  material?: readonly number[];
}

export interface DiagonalDecision {
  choice: DiagonalChoice;
  chosenDiagonal: DiagonalId | null;
  reason?: DiagonalRejectReason;
  scoreImprovement: number;
}

export interface DiagonalPolishStats {
  candidateQuads: number;
  flipped: number;
  rejectedDegenerate: number;
  rejectedWinding: number;
  rejectedLockedBorder: number;
  rejectedNoImprovement: number;
  averageScoreImprovement: number;
}

export function emptyDiagonalPolishStats(): DiagonalPolishStats {
  return {
    candidateQuads: 0,
    flipped: 0,
    rejectedDegenerate: 0,
    rejectedWinding: 0,
    rejectedLockedBorder: 0,
    rejectedNoImprovement: 0,
    averageScoreImprovement: 0,
  };
}

export function aggregateDiagonalPolishStats(stats: readonly DiagonalPolishStats[]): DiagonalPolishStats {
  const out = emptyDiagonalPolishStats();
  let totalImprovement = 0;
  for (const stat of stats) {
    out.candidateQuads += stat.candidateQuads;
    out.flipped += stat.flipped;
    out.rejectedDegenerate += stat.rejectedDegenerate;
    out.rejectedWinding += stat.rejectedWinding;
    out.rejectedLockedBorder += stat.rejectedLockedBorder;
    out.rejectedNoImprovement += stat.rejectedNoImprovement;
    totalImprovement += stat.averageScoreImprovement * stat.flipped;
  }
  out.averageScoreImprovement = out.flipped > 0 ? totalImprovement / out.flipped : 0;
  return out;
}

export function formatDiagonalPolishStats(stats: DiagonalPolishStats): string {
  return `diag polish: candidates=${stats.candidateQuads.toLocaleString()} flips=${stats.flipped.toLocaleString()} ` +
    `rejected=${(stats.rejectedDegenerate + stats.rejectedWinding + stats.rejectedLockedBorder + stats.rejectedNoImprovement).toLocaleString()} ` +
    `avg_gain=${stats.averageScoreImprovement.toFixed(4)}`;
}

interface CandidateMetrics {
  valid: boolean;
  reason?: DiagonalRejectReason;
  minAngleDegrees: number;
  normalError: number;
  materialError: number;
  score: number;
}

interface EdgeUse {
  triStart: number;
  triIndex: number;
  opposite: number;
}

interface EdgeRecord {
  a: number;
  c: number;
  uses: EdgeUse[];
}

const EPS = 1e-6;

export function chooseBestQuadDiagonal(
  a: QuadVertex,
  b: QuadVertex,
  c: QuadVertex,
  d: QuadVertex,
  currentDiagonal: DiagonalId,
  config: DiagonalFlipConfig = DEFAULT_DIAGONAL_FLIP_CONFIG,
): DiagonalDecision {
  const expected = expectedNormal([a, b, c, d], currentDiagonal, config);
  if (!expected) return { choice: "reject", chosenDiagonal: null, reason: "degenerate", scoreImprovement: 0 };

  const ac = evaluateCandidate("ac", a, b, c, d, expected, config);
  const bd = evaluateCandidate("bd", a, b, c, d, expected, config);
  const current = currentDiagonal === "ac" ? ac : bd;
  const alternate = currentDiagonal === "ac" ? bd : ac;
  const alternateDiagonal = currentDiagonal === "ac" ? "bd" : "ac";

  if (!current.valid && !alternate.valid) {
    return {
      choice: "reject",
      chosenDiagonal: null,
      reason: current.reason === "degenerate" || alternate.reason === "degenerate" ? "degenerate" : "winding",
      scoreImprovement: 0,
    };
  }
  if (!current.valid && alternate.valid) {
    return {
      choice: "flip",
      chosenDiagonal: alternateDiagonal,
      scoreImprovement: 0,
    };
  }
  if (current.valid && !alternate.valid) {
    return {
      choice: "keep",
      chosenDiagonal: currentDiagonal,
      reason: alternate.reason,
      scoreImprovement: 0,
    };
  }

  return alternate.score + EPS < current.score
    ? { choice: "flip", chosenDiagonal: alternateDiagonal, scoreImprovement: current.score - alternate.score }
    : { choice: "keep", chosenDiagonal: currentDiagonal, scoreImprovement: 0 };
}

export function polishDiagonals(
  mesh: PageMesh,
  locks: Uint8Array | undefined,
  config: DiagonalFlipConfig = DEFAULT_DIAGONAL_FLIP_CONFIG,
): DiagonalPolishStats {
  const stats = emptyDiagonalPolishStats();
  if (!config.enabled) return stats;

  const edgeMap = buildEdgeMap(mesh.indices);
  const usedTriangles = new Set<number>();
  let totalImprovement = 0;
  const candidates = [...edgeMap.values()].sort((x, y) => x.a - y.a || x.c - y.c);
  for (const edge of candidates) {
    if (edge.uses.length !== 2) continue;
    const [u0, u1] = edge.uses;
    if (usedTriangles.has(u0.triIndex) || usedTriangles.has(u1.triIndex)) continue;
    stats.candidateQuads++;
    if (locks?.[edge.a] && locks?.[edge.c]) {
      stats.rejectedLockedBorder++;
      usedTriangles.add(u0.triIndex);
      usedTriangles.add(u1.triIndex);
      continue;
    }

    const oriented = orientCurrentDiagonal(mesh, edge.a, edge.c, u0.opposite, u1.opposite, config);
    if (!oriented) {
      stats.rejectedWinding++;
      usedTriangles.add(u0.triIndex);
      usedTriangles.add(u1.triIndex);
      continue;
    }

    const decision = chooseBestQuadDiagonal(
      vertex(mesh, oriented.a),
      vertex(mesh, oriented.b),
      vertex(mesh, oriented.c),
      vertex(mesh, oriented.d),
      "ac",
      config,
    );
    usedTriangles.add(u0.triIndex);
    usedTriangles.add(u1.triIndex);
    if (decision.choice === "flip") {
      mesh.indices.set([oriented.a, oriented.b, oriented.d], u0.triStart);
      mesh.indices.set([oriented.b, oriented.c, oriented.d], u1.triStart);
      stats.flipped++;
      totalImprovement += decision.scoreImprovement;
    } else if (decision.reason === "degenerate") {
      stats.rejectedDegenerate++;
    } else if (decision.reason === "winding") {
      stats.rejectedWinding++;
    } else {
      stats.rejectedNoImprovement++;
    }
  }
  stats.averageScoreImprovement = stats.flipped > 0 ? totalImprovement / stats.flipped : 0;
  return stats;
}

function evaluateCandidate(
  diagonal: DiagonalId,
  a: QuadVertex,
  b: QuadVertex,
  c: QuadVertex,
  d: QuadVertex,
  expected: Vec3,
  config: DiagonalFlipConfig,
): CandidateMetrics {
  const tris = diagonal === "ac" ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
  let minAngleDegrees = Infinity;
  let normalError = 0;
  for (const tri of tris) {
    const [x, y, z] = tri;
    if (!finiteVec3(x.position) || !finiteVec3(y.position) || !finiteVec3(z.position)) {
      return invalid("degenerate");
    }
    const area = triangleArea(x.position, y.position, z.position);
    const faceNormal = triangleNormal(x.position, y.position, z.position);
    if (!Number.isFinite(area) || area <= config.min_triangle_area || !faceNormal) {
      return invalid("degenerate");
    }
    if (dot(faceNormal, expected) < config.min_normal_dot) return invalid("winding");
    minAngleDegrees = Math.min(minAngleDegrees, triangleMinAngleDegrees(x.position, y.position, z.position));
    const avg = averageNormal(tri);
    if (avg) normalError += 1 - Math.max(-1, Math.min(1, dot(faceNormal, avg)));
  }

  const materialError = diagonal === "ac"
    ? materialDistanceSquared(a.material, c.material)
    : materialDistanceSquared(b.material, d.material);
  const angleCost = (90 - minAngleDegrees) / 90;
  return {
    valid: true,
    minAngleDegrees,
    normalError,
    materialError,
    score:
      config.angle_quality_weight * angleCost +
      config.normal_error_weight * normalError +
      config.material_error_weight * materialError,
  };
}

function expectedNormal(vertices: QuadVertex[], currentDiagonal: DiagonalId, config: DiagonalFlipConfig): Vec3 | null {
  const avg = averageNormal(vertices);
  if (avg) return avg;
  const [a, b, c, d] = vertices;
  const current = evaluateCandidate(
    currentDiagonal,
    a,
    b,
    c,
    d,
    [0, 1, 0],
    { ...config, min_normal_dot: -1 },
  );
  if (!current.valid) return null;
  const tris = currentDiagonal === "ac" ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
  const n0 = triangleNormal(tris[0][0].position, tris[0][1].position, tris[0][2].position);
  const n1 = triangleNormal(tris[1][0].position, tris[1][1].position, tris[1][2].position);
  return n0 && n1 ? normalize(add(n0, n1)) : null;
}

function averageNormal(vertices: readonly QuadVertex[]): Vec3 | null {
  let sum: Vec3 = [0, 0, 0];
  let count = 0;
  for (const vertex of vertices) {
    if (!vertex.normal || !finiteVec3(vertex.normal)) continue;
    sum = add(sum, vertex.normal);
    count++;
  }
  return count === vertices.length ? normalize(sum) : null;
}

function invalid(reason: DiagonalRejectReason): CandidateMetrics {
  return {
    valid: false,
    reason,
    minAngleDegrees: 0,
    normalError: Infinity,
    materialError: Infinity,
    score: Infinity,
  };
}

function buildEdgeMap(indices: Uint32Array): Map<string, EdgeRecord> {
  const map = new Map<string, EdgeRecord>();
  for (let triStart = 0; triStart < indices.length; triStart += 3) {
    const triIndex = triStart / 3;
    const tri = [indices[triStart], indices[triStart + 1], indices[triStart + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const c = tri[(i + 1) % 3];
      const lo = Math.min(a, c);
      const hi = Math.max(a, c);
      const key = `${lo}:${hi}`;
      let record = map.get(key);
      if (!record) {
        record = { a: lo, c: hi, uses: [] };
        map.set(key, record);
      }
      record.uses.push({ triStart, triIndex, opposite: tri[(i + 2) % 3] });
    }
  }
  return map;
}

function orientCurrentDiagonal(
  mesh: PageMesh,
  a: number,
  c: number,
  firstOpposite: number,
  secondOpposite: number,
  config: DiagonalFlipConfig,
): { a: number; b: number; c: number; d: number } | null {
  const first = { a, b: firstOpposite, c, d: secondOpposite };
  const second = { a, b: secondOpposite, c, d: firstOpposite };
  if (currentDiagonalIsValid(mesh, first, config)) return first;
  return currentDiagonalIsValid(mesh, second, config) ? second : null;
}

function vertex(mesh: PageMesh, i: number): QuadVertex {
  return {
    position: [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]],
    normal: [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]],
    material: [mesh.paintSlots[i]],
  };
}

function currentDiagonalIsValid(
  mesh: PageMesh,
  quad: { a: number; b: number; c: number; d: number },
  config: DiagonalFlipConfig,
): boolean {
  const a = vertex(mesh, quad.a);
  const b = vertex(mesh, quad.b);
  const c = vertex(mesh, quad.c);
  const d = vertex(mesh, quad.d);
  const expected = expectedNormal([a, b, c, d], "ac", config);
  return expected ? evaluateCandidate("ac", a, b, c, d, expected, config).valid : false;
}
