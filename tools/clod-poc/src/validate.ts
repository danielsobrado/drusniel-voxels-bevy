// Builder validation - errors, never warnings.
// Runs in every build (the builder is off the frame path; correctness > speed here).

import { PageMesh, PageFootprint, ClodBuildError, DEFAULT_TOLERANCES, vertexCount } from "./types.js";

/** Undirected edge key for boundary-edge detection. */
function edgeKey(a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo * 0x1000000 + hi;
}

/** Topological border edges = edges used by exactly one triangle. */
export function borderEdges(mesh: PageMesh): Set<number> {
  const count = new Map<number, number>();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = edgeKey(u, v);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const border = new Set<number>();
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
    flags[Math.floor(k / 0x1000000)] = 1;
    flags[k % 0x1000000] = 1;
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

/** Strip exactly-degenerate (zero-area / repeated-index) triangles. */
export function stripDegenerateTriangles(mesh: PageMesh): number {
  const idx = mesh.indices;
  const kept: number[] = [];
  let removed = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) {
      removed++;
      continue;
    }
    kept.push(a, b, c);
  }
  mesh.indices = new Uint32Array(kept);
  return removed;
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
): BorderChain {
  const n = vertexCount(mesh);
  const open = openBoundaryVertexFlags(mesh);
  const out: { p: [number, number, number]; nr: [number, number, number]; m: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue;
    const x = mesh.positions[i * 3], z = mesh.positions[i * 3 + 2];
    const val = axis === "x" ? x : z;
    if (Math.abs(val - plane) > PERIMETER_BAND) continue;
    // trim the two perpendicular corners
    if (axis === "x") {
      if (Math.abs(z - footprint.minZ) <= PERIMETER_BAND || Math.abs(z - footprint.maxZ) <= PERIMETER_BAND) continue;
    } else {
      if (Math.abs(x - footprint.minX) <= PERIMETER_BAND || Math.abs(x - footprint.maxX) <= PERIMETER_BAND) continue;
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
 * position <= default weld epsilon, normal dot >= 0.9999, material delta <= 1e-4.
 */
export function assertBorderMatch(a: BorderChain, b: BorderChain): void {
  const tol = DEFAULT_TOLERANCES;
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
