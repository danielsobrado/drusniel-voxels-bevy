// GPU-shaped Surface Nets mesher for one chunk — the *spec* for the WGSL compute pass
// (shaders/surface_nets.compute.wgsl). Structured the way the shader runs: two passes over a
// dense cell-indexed grid (no hash map, no on-demand vertex allocation), full-Y scan instead of
// the CPU per-column band. surface_nets_core.test.ts proves this produces the SAME surface as
// canonical terrain.ts meshChunk (identical triangle set), so the WGSL is a transliteration of
// verified logic. Vertex *ordering* differs from the CPU mesher (dense scan vs hash insertion
// order); only the surface is asserted equal.
//
// Mirrors terrain.ts: cellVertex (cellVertexCore), QUAD_CELLS, emitAxis winding + world-perimeter
// clipping. Field/paint/gradient come from terrain_field_core (itself pinned to terrain.ts).

import {
  ResolvedDigEdit,
  densityCore,
  densityGradientCore,
  paintMaterialAtCore,
} from "./terrain_field_core.js";

// Mirror of terrain.ts Y_CELLS. Full-Y scan range is [0, Y_CELLS).
const Y_CELLS = 128;

export interface ChunkMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  materials: Float32Array;
  indices: Uint32Array;
}

// CCW cell-corner loops around each axis edge (offsets to the cell min-corner). Verbatim from
// terrain.ts QUAD_CELLS, ordered [x, y, z].
const QUAD_CELLS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]], // x
  [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]], // y
  [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]], // z
];

// 12 cube edges as (cornerA, cornerB); corner bit c = (x:1, y:2, z:4). Verbatim from cellVertex.
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x
  [0, 2], [1, 3], [4, 6], [5, 7], // y
  [0, 4], [1, 5], [2, 6], [3, 7], // z
];

/** Surface-nets vertex for a cell at the average edge crossing. Mirror of terrain.ts cellVertex. */
function cellVertexCore(
  ci: number,
  cj: number,
  ck: number,
  edits: readonly ResolvedDigEdit[],
): [number, number, number] | null {
  const d: number[] = [];
  let neg = 0;
  for (let c = 0; c < 8; c++) {
    const x = ci + (c & 1);
    const y = cj + ((c >> 1) & 1);
    const z = ck + ((c >> 2) & 1);
    const v = densityCore(x, y, z, edits);
    d.push(v);
    if (v < 0) neg++;
  }
  if (neg === 0 || neg === 8) return null;

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

/**
 * Mesh one chunk (cell columns [cx*S,(cx+1)*S) x [cz*S,(cz+1)*S), full Y) into a single mesh.
 * Two passes over a dense cell grid:
 *   1. vertex pass: one vertex per crossing cell, indexed by cell coord (idxGrid).
 *   2. quad pass: per sign-crossing axis edge, emit the dual quad reading idxGrid.
 * Produces the same surface as terrain.ts meshChunk (verified), with GPU-friendly structure.
 */
export function meshChunkGpuShaped(
  cx: number,
  cz: number,
  S: number,
  world: { cellsX: number; cellsZ: number },
  edits: readonly ResolvedDigEdit[] = [],
): ChunkMeshArrays {
  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;

  // Vertex-cell grid covers every cell referenceable by a quad in this chunk:
  //   vx in [x0-1, x1-1], vy in [-1, Y_CELLS-1], vz in [z0-1, z1-1].
  const vxBase = x0 - 1, vyBase = -1, vzBase = z0 - 1;
  const vxCount = S + 1, vyCount = Y_CELLS + 1, vzCount = S + 1;
  const idxGrid = new Int32Array(vxCount * vyCount * vzCount).fill(-1);
  const gridIndex = (gx: number, gy: number, gz: number) => (gx * vyCount + gy) * vzCount + gz;

  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];

  // --- pass 1: vertices ---
  for (let gx = 0; gx < vxCount; gx++) {
    const ci = vxBase + gx;
    for (let gy = 0; gy < vyCount; gy++) {
      const cj = vyBase + gy;
      for (let gz = 0; gz < vzCount; gz++) {
        const ck = vzBase + gz;
        const p = cellVertexCore(ci, cj, ck, edits);
        if (p === null) continue;
        const [px, py, pz] = p;
        const [nx, ny, nz] = densityGradientCore(px, py, pz, edits);
        const paint = paintMaterialAtCore(px, py, pz, edits);
        const idx = pos.length / 3;
        pos.push(px, py, pz);
        nrm.push(nx, ny, nz);
        mat.push(paint);
        idxGrid[gridIndex(gx, gy, gz)] = idx;
      }
    }
  }

  // --- pass 2: quads (mirror of emitAxis) ---
  const indices: number[] = [];
  const axisStep: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = x0; i < x1; i++) {
    for (let k = z0; k < z1; k++) {
      for (let j = 0; j < Y_CELLS; j++) {
        for (let axis = 0; axis < 3; axis++) {
          const dBase = densityCore(i, j, k, edits);
          const [sx, sy, sz] = axisStep[axis];
          const dTip = densityCore(i + sx, j + sy, k + sz, edits);
          if (dBase < 0 === dTip < 0) continue; // no crossing

          const loop = QUAD_CELLS[axis];
          // Perimeter clip: drop the quad if any of the 4 cells leaves the world in X/Z.
          let clipped = false;
          for (const [oi, , ok] of loop) {
            const ci = i + oi, ck = k + ok;
            if (ci < 0 || ci >= world.cellsX || ck < 0 || ck >= world.cellsZ) { clipped = true; break; }
          }
          if (clipped) continue;

          const v: number[] = [];
          let degenerate = false;
          for (const [oi, oj, ok] of loop) {
            const gi = (i + oi) - vxBase, gj = (j + oj) - vyBase, gk = (k + ok) - vzBase;
            const idx = idxGrid[gridIndex(gi, gj, gk)];
            if (idx < 0) { degenerate = true; break; }
            v.push(idx);
          }
          if (degenerate) continue;

          const flip = dBase < dTip;
          if (!flip) {
            indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
          } else {
            indices.push(v[0], v[2], v[1], v[0], v[3], v[2]);
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    materials: new Float32Array(mat),
    indices: new Uint32Array(indices),
  };
}
