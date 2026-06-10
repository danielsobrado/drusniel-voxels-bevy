// Synthetic terrain stand-in for the engine's Surface Nets chunk mesher.
//
// The real engine feeds the page builder its existing same-resolution chunk meshes
// (plan §3.1). The PoC has no engine, so we generate an equivalent: a GLOBAL scalar
// field, meshed PER CHUNK with a halo. Because every vertex/normal/material is a pure
// function of the global field, two chunks that both touch a shared boundary cell emit
// byte-identical copies of that vertex -> they weld cleanly and borders match by
// construction. This is the property the engine guarantees and the page builder relies on.
//
// Chunking is in X/Z only (terrain is columnar), matching the plan's footprint model.

import { PageMesh } from "./types.js";
import { ClodPagesConfig } from "./config.js";

const Y_CELLS = 56; // vertical extent meshed (must exceed max surface height incl. cliff)

/** World cell extent in X/Z. Quads referencing cells outside this are clipped, so the
 *  world's outer pages get a clean open boundary instead of dangling halo geometry. */
export interface WorldBounds {
  cellsX: number;
  cellsZ: number;
}

// ---- global field ---------------------------------------------------------

function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const zf = smooth(z - zi);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

function fbm2(x: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Terrain surface height at (x,z). */
function surfaceHeight(x: number, z: number): number {
  const f = fbm2(x * 0.035, z * 0.035);
  // A ridge so stress-test features cross page borders (§4.4).
  const ridge = Math.abs(Math.sin(x * 0.04) + Math.cos(z * 0.05)) * 4;
  // A steep cliff straddling the page border at x=128 (feature crossing a border).
  const cliff = 9 * smooth(Math.min(1, Math.max(0, (x - 124) / 8)));
  return 16 + f * 18 + ridge + cliff;
}

/** density > 0 = solid (below surface), < 0 = air. The isosurface is density = 0. */
export function density(x: number, y: number, z: number): number {
  const base = surfaceHeight(x, z) - y;
  // A mild overhang lip near the 4-page corner (128,128): a localized solid bulge that
  // folds the surface back (true 3D, not a heightfield). Gaussian in y keeps the lip and
  // the main surface >1 cell apart, so single-vertex Surface Nets stays valid.
  const dx = x - 128, dz = z - 128;
  const bulge = 6 * Math.exp(-(dx * dx + dz * dz) / 900) * Math.exp(-((y - 30) * (y - 30)) / 120);
  return base + bulge;
}

function gradient(x: number, y: number, z: number): [number, number, number] {
  const e = 0.5;
  const gx = density(x + e, y, z) - density(x - e, y, z);
  const gy = density(x, y + e, z) - density(x, y - e, z);
  const gz = density(x, y, z + e) - density(x, y, z - e);
  // Surface normal points toward air (descending density).
  const nx = -gx;
  const ny = -gy;
  const nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** 4 material weights from slope/height — deterministic, so they match across borders. */
function materials(y: number, ny: number): [number, number, number, number] {
  const slope = 1 - Math.max(0, ny); // 0 flat, 1 vertical
  const sand = Math.max(0, 1 - Math.abs(y - 12) / 6);
  const snow = Math.max(0, (y - 30) / 10);
  const rock = slope;
  const grass = Math.max(0, 1 - sand - snow - rock);
  const sum = sand + snow + rock + grass || 1;
  return [grass / sum, rock / sum, sand / sum, snow / sum];
}

// ---- per-chunk surface nets ----------------------------------------------

// CCW cell-corner loops around each axis edge (offsets to the cell min-corner).
const QUAD_CELLS: Record<"x" | "y" | "z", [number, number, number][]> = {
  x: [
    [0, -1, -1],
    [0, 0, -1],
    [0, 0, 0],
    [0, -1, 0],
  ],
  y: [
    [-1, 0, -1],
    [-1, 0, 0],
    [0, 0, 0],
    [0, 0, -1],
  ],
  z: [
    [-1, -1, 0],
    [0, -1, 0],
    [0, 0, 0],
    [-1, 0, 0],
  ],
};

interface VertBuf {
  pos: number[];
  nrm: number[];
  mat: number[];
  index: Map<number, number>; // packed cell key -> local vertex index
}

function cellKey(ci: number, cj: number, ck: number): number {
  // packs into a single number; ranges are small and non-negative after offset.
  return ((ci + 512) * 2048 + (cj + 512)) * 2048 + (ck + 512);
}

/** Surface-nets vertex for a cell, placed at the average edge crossing. Pure fn of the field. */
function cellVertex(ci: number, cj: number, ck: number): [number, number, number] | null {
  // 8 corner densities
  const d: number[] = [];
  let neg = 0;
  for (let c = 0; c < 8; c++) {
    const x = ci + (c & 1);
    const y = cj + ((c >> 1) & 1);
    const z = ck + ((c >> 2) & 1);
    const v = density(x, y, z);
    d.push(v);
    if (v < 0) neg++;
  }
  if (neg === 0 || neg === 8) return null;

  // 12 edges as (cornerA, cornerB)
  const EDGES: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x
    [0, 2], [1, 3], [4, 6], [5, 7], // y
    [0, 4], [1, 5], [2, 6], [3, 7], // z
  ];
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const da = d[a], db = d[b];
    if (da < 0 === db < 0) continue;
    const t = da / (da - db);
    const ax = ci + (a & 1), ay = cj + ((a >> 1) & 1), az = ck + ((a >> 2) & 1);
    const bx = ci + (b & 1), by = cj + ((b >> 1) & 1), bz = ck + ((b >> 2) & 1);
    sx += ax + (bx - ax) * t;
    sy += ay + (by - ay) * t;
    sz += az + (bz - az) * t;
    n++;
  }
  return [sx / n, sy / n, sz / n];
}

function getOrAddVertex(buf: VertBuf, ci: number, cj: number, ck: number): number | null {
  const key = cellKey(ci, cj, ck);
  const existing = buf.index.get(key);
  if (existing !== undefined) return existing;
  const p = cellVertex(ci, cj, ck);
  if (p === null) return null;
  const [px, py, pz] = p;
  const [nx, ny, nz] = gradient(px, py, pz);
  const [m0, m1, m2, m3] = materials(py, ny);
  const idx = buf.pos.length / 3;
  buf.pos.push(px, py, pz);
  buf.nrm.push(nx, ny, nz);
  buf.mat.push(m0, m1, m2, m3);
  buf.index.set(key, idx);
  return idx;
}

/**
 * Mesh one chunk (owns cell columns [cx*S, (cx+1)*S) x [cz*S, (cz+1)*S), full Y).
 * Quads are owned by half-open base-column intervals so each crossing edge is emitted
 * exactly once globally; referenced halo cells are recomputed identically and weld away.
 */
export function meshChunk(cx: number, cz: number, cfg: ClodPagesConfig, world: WorldBounds): PageMesh {
  const S = cfg.page.chunk_size;
  const buf: VertBuf = { pos: [], nrm: [], mat: [], index: new Map() };
  const indices: number[] = [];

  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;

  for (let i = x0; i < x1; i++) {
    for (let k = z0; k < z1; k++) {
      for (let j = 0; j < Y_CELLS; j++) {
        emitAxis("x", i, j, k, buf, indices, world);
        emitAxis("y", i, j, k, buf, indices, world);
        emitAxis("z", i, j, k, buf, indices, world);
      }
    }
  }

  return {
    positions: new Float32Array(buf.pos),
    normals: new Float32Array(buf.nrm),
    materials: new Float32Array(buf.mat),
    indices: new Uint32Array(indices),
  };
}

function emitAxis(
  axis: "x" | "y" | "z",
  i: number,
  j: number,
  k: number,
  buf: VertBuf,
  indices: number[],
  world: WorldBounds,
): void {
  const dBase = density(i, j, k);
  const tx = axis === "x" ? i + 1 : i;
  const ty = axis === "y" ? j + 1 : j;
  const tz = axis === "z" ? k + 1 : k;
  const dTip = density(tx, ty, tz);
  if (dBase < 0 === dTip < 0) return; // no crossing

  const loop = QUAD_CELLS[axis];
  // Clip at the world perimeter: if any of the 4 cells is outside the world in X/Z,
  // drop the quad so outer pages get a clean open boundary (no x=-0.5 halo geometry).
  for (const [oi, , ok] of loop) {
    const ci = i + oi, ck = k + ok;
    if (ci < 0 || ci >= world.cellsX || ck < 0 || ck >= world.cellsZ) return;
  }
  const v: number[] = [];
  for (const [oi, oj, ok] of loop) {
    const idx = getOrAddVertex(buf, i + oi, j + oj, k + ok);
    if (idx === null) return; // degenerate (shouldn't happen on a clean field)
    v.push(idx);
  }
  // Wind so the front face looks toward air: solid->air along +axis keeps the CCW loop.
  const flip = dBase < dTip;
  if (!flip) {
    indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  } else {
    indices.push(v[0], v[2], v[1], v[0], v[3], v[2]);
  }
}
