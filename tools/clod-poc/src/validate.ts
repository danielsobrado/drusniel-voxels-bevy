// Builder validation - errors, never warnings.
// Runs in every build (the builder is off the frame path; correctness > speed here).

import { PageMesh, PageFootprint, ClodBuildError, DEFAULT_TOLERANCES, vertexCount, type BorderTolerances } from "./types.js";

/** Undirected edge key for boundary-edge detection. String to avoid int overflow. */
function edgeKey(a: number, b: number): string {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return `${lo}:${hi}`;
}

/** Topological border edges = edges used by exactly one triangle. */
export function borderEdges(mesh: PageMesh): Set<string> {
  const count = new Map<string, number>();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = edgeKey(u, v);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const border = new Set<string>();
  for (const [k, n] of count) if (n === 1) border.add(k);
  return border;
}

/**
 * Per-vertex flag: 1 if the vertex lies on the mesh's open (topological) boundary.
 * After internal welding this IS the page's outer border. Surface-nets
 * borders are non-planar, so detect them by topology, not by footprint-plane position.
 */
export function openBoundaryVertexFlags(mesh: PageMesh): Uint8Array {
  const flags = new Uint8Array(vertexCount(mesh));
  for (const k of borderEdges(mesh)) {
    const [a, b] = k.split(":").map(Number);
    flags[a] = 1;
    flags[b] = 1;
  }
  return flags;
}

/** Distance from a point to the footprint rectangle perimeter, in cell units (X/Z). */
function distToPerimeter(x: number, z: number, fp: PageFootprint): number {
  return Math.min(
    Math.abs(x - fp.minX),
    Math.abs(x - fp.maxX),
    Math.abs(z - fp.minZ),
    Math.abs(z - fp.maxZ),
  );
}

// Surface-nets vertices sit inside cells, so the open boundary hugs the footprint
// perimeter within ~1 cell rather than lying exactly on it. An unwelded internal seam
// shows up as open edges far from the perimeter — that's what we catch.
const PERIMETER_BAND = 1.0;

/**
 * Assert every open-boundary vertex hugs the page footprint perimeter (within one cell),
 * i.e. no INTERNAL topological border survived welding.
 */
export function assertNoInternalBorders(mesh: PageMesh, footprint: PageFootprint): void {
  const flags = openBoundaryVertexFlags(mesh);
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const x = mesh.positions[i * 3], z = mesh.positions[i * 3 + 2];
    if (distToPerimeter(x, z, footprint) > PERIMETER_BAND) {
      throw new ClodBuildError(
        "InternalBorderNotWelded",
        `open-boundary vertex (${x.toFixed(2)},${mesh.positions[i * 3 + 1].toFixed(2)},${z.toFixed(2)}) ` +
          `is ${distToPerimeter(x, z, footprint).toFixed(2)} cells from the footprint perimeter — weld missed an internal seam`,
      );
    }
  }
}

/** Squared area of a triangle. */
function triangleAreaSq(mesh: PageMesh, a: number, b: number, c: number): number {
  const ax = mesh.positions[a * 3], ay = mesh.positions[a * 3 + 1], az = mesh.positions[a * 3 + 2];
  const bx = mesh.positions[b * 3], by = mesh.positions[b * 3 + 1], bz = mesh.positions[b * 3 + 2];
  const cx = mesh.positions[c * 3], cy = mesh.positions[c * 3 + 1], cz = mesh.positions[c * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return (nx * nx + ny * ny + nz * nz) * 0.25;
}

/**
 * Strip degenerate triangles: repeated-index AND zero-area.
 * When zeroAreaEpsilon is provided, also strips triangles whose area is <= zeroAreaEpsilon.
 */
export function stripDegenerateTriangles(mesh: PageMesh, zeroAreaEpsilon?: number): number {
  const idx = mesh.indices;
  const kept: number[] = [];
  let removed = 0;
  const epsSq = zeroAreaEpsilon !== undefined ? zeroAreaEpsilon * zeroAreaEpsilon : -1;

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) {
      removed++;
      continue;
    }
    if (epsSq >= 0 && triangleAreaSq(mesh, a, b, c) <= epsSq) {
      removed++;
      continue;
    }
    kept.push(a, b, c);
  }
  mesh.indices = new Uint32Array(kept);
  return removed;
}

/** Validate no degenerate (zero-area) triangles remain. */
export function validateNoDegenerateTriangles(mesh: PageMesh, epsilon: number): void {
  const idx = mesh.indices;
  const epsSq = epsilon * epsilon;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (triangleAreaSq(mesh, a, b, c) <= epsSq) {
      throw new ClodBuildError("DegenerateGeometry", `zero-area triangle at indices ${a},${b},${c}`);
    }
  }
}

/** Validate mesh for NaN/Infinity, index bounds, and count consistency. */
export function validateFinite(mesh: PageMesh, label: string): void {
  if (mesh.indices.length % 3 !== 0) throw new ClodBuildError("DegenerateGeometry", `${label} non-triangle index count`);
  if (mesh.indices.length === 0) throw new ClodBuildError("DegenerateGeometry", `${label} empty mesh after strip`);
  const vc = vertexCount(mesh);
  if (vc !== mesh.normals.length / 3) throw new ClodBuildError("DegenerateGeometry", `${label} position/normal count mismatch`);
  if (vc !== mesh.materials.length) throw new ClodBuildError("DegenerateGeometry", `${label} position/material count mismatch`);
  for (let i = 0; i < mesh.indices.length; i++) {
    if (mesh.indices[i] >= vc) throw new ClodBuildError("DegenerateGeometry", `${label} out-of-bounds index ${mesh.indices[i]} >= ${vc}`);
  }
  for (const v of mesh.positions) if (!Number.isFinite(v)) throw new ClodBuildError("DegenerateGeometry", `${label} non-finite position`);
  for (const v of mesh.normals) if (!Number.isFinite(v)) throw new ClodBuildError("DegenerateGeometry", `${label} non-finite normal`);
  for (const v of mesh.materials) if (!Number.isFinite(v)) throw new ClodBuildError("DegenerateGeometry", `${label} non-finite material`);
}

export interface BorderChain {
  // sorted boundary vertices along a footprint edge, for neighbor matching (gate A2)
  positions: [number, number, number][];
  normals: [number, number, number][];
  materials: number[];
}

/**
 * Collect OPEN-boundary vertices near one footprint plane, sorted for deterministic
 * matching. Open-only excludes interior vertices near the plane; we additionally trim the
 * perpendicular corner zones, because at a corner two adjacent pages turn via DIFFERENT
 * diagonal cells (a real surface-nets effect) — corners stay watertight via locked borders,
 * not via this edge-to-edge match. Two adjacent pages then yield the identical shared chain.
 */
export function borderChain(
  mesh: PageMesh,
  axis: "x" | "z",
  plane: number,
  footprint: PageFootprint,
  perimeterBand = PERIMETER_BAND,
): BorderChain {
  const n = vertexCount(mesh);
  const open = openBoundaryVertexFlags(mesh);
  const out: { p: [number, number, number]; nr: [number, number, number]; m: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue;
    const x = mesh.positions[i * 3], z = mesh.positions[i * 3 + 2];
    const val = axis === "x" ? x : z;
    if (Math.abs(val - plane) > perimeterBand) continue;
    // trim the two perpendicular corners
    if (axis === "x") {
      if (Math.abs(z - footprint.minZ) <= perimeterBand || Math.abs(z - footprint.maxZ) <= perimeterBand) continue;
    } else {
      if (Math.abs(x - footprint.minX) <= perimeterBand || Math.abs(x - footprint.maxX) <= perimeterBand) continue;
    }
    out.push({
      p: [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]],
      nr: [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]],
      m: mesh.materials[i],
    });
  }
  // sort along the free axes then Y
  const free = axis === "x" ? 2 : 0;
  out.sort((a, b) => a.p[free] - b.p[free] || a.p[1] - b.p[1]);
  return { positions: out.map((o) => o.p), normals: out.map((o) => o.nr), materials: out.map((o) => o.m) };
}

/**
 * Assert two adjacent same-level pages share a matching border chain (gate A2).
 * Tolerances come from cfg.validation or fall back to DEFAULT_TOLERANCES.
 */
export function assertBorderMatch(a: BorderChain, b: BorderChain, tolerances?: BorderTolerances): void {
  const tol = tolerances ?? DEFAULT_TOLERANCES;
  if (a.positions.length !== b.positions.length) {
    throw new ClodBuildError(
      "BorderPositionMismatch",
      `border vertex counts differ: ${a.positions.length} vs ${b.positions.length}`,
    );
  }
  for (let i = 0; i < a.positions.length; i++) {
    const dp = Math.hypot(
      a.positions[i][0] - b.positions[i][0],
      a.positions[i][1] - b.positions[i][1],
      a.positions[i][2] - b.positions[i][2],
    );
    if (dp > tol.position) {
      throw new ClodBuildError("BorderPositionMismatch", `pos delta ${dp.toExponential(2)} at border vertex ${i}`);
    }
    const dot =
      a.normals[i][0] * b.normals[i][0] + a.normals[i][1] * b.normals[i][1] + a.normals[i][2] * b.normals[i][2];
    if (dot < tol.normalDot) {
      throw new ClodBuildError("BorderNormalMismatch", `normal dot ${dot.toFixed(5)} at border vertex ${i}`);
    }
    const md = Math.abs(a.materials[i] - b.materials[i]);
    if (md > tol.material) {
      throw new ClodBuildError("BorderMaterialMismatch", `material delta ${md.toExponential(2)} at border vertex ${i}`);
    }
  }
}
