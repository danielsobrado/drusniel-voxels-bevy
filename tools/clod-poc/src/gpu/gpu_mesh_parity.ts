// Tolerance-based surface comparison for the GPU mesher parity harness. GPU meshing is f32 while
// the CPU field is f64, so vertices shift in low bits and exact equality (used in the headless
// core tests) is too strict for a live GPU-vs-CPU check. This matches each canonical CPU vertex to
// the nearest GPU vertex via a spatial hash and reports the worst delta + any unmatched vertices,
// so the in-browser harness can print a single parity number. Pure (no WebGPU) and unit-tested.
//
// Direction matters: the GPU-shaped mesher scans a dense cell grid and emits an unreferenced "halo"
// vertex for every crossing cell, whereas the on-demand CPU mesher only allocates referenced ones
// (see surface_nets_core.test.ts: the proven invariant is canonical ⊆ gpu). So we iterate CPU → GPU
// — a missing/misplaced *used* vertex is real drift, while the GPU's extra halo vertices are
// expected and must not be flagged. (Iterating GPU → CPU would report every halo vertex as drift.)

interface MeshLike {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface SurfaceComparison {
  cpuVertices: number;
  gpuVertices: number;
  cpuTriangles: number;
  gpuTriangles: number;
  /** Worst distance from a canonical CPU vertex to its nearest GPU vertex (within search range). */
  maxVertexDelta: number;
  /** Canonical CPU vertices with no GPU vertex within `tol` — a real surface divergence (the GPU
   *  dropped or misplaced a used vertex). 0 for a correct mesher. */
  unmatched: number;
  /** GPU vertices beyond the canonical count: the expected unreferenced halo of the dense GPU
   *  grid. Informational only — not drift. */
  haloVertices: number;
  withinTol: boolean;
}

function hashKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

/** Compare two chunk surfaces. `tol` is the max acceptable per-vertex position drift (world
 *  units); the search scans the 27 neighbouring hash cells sized to `tol`. */
export function compareChunkSurfaces(cpu: MeshLike, gpu: MeshLike, tol: number): SurfaceComparison {
  const cell = Math.max(tol, 1e-6);
  // Spatial hash of GPU vertices (we match canonical CPU vertices against it; see header note).
  const buckets = new Map<string, number[]>();
  const gpuCount = gpu.positions.length / 3;
  for (let i = 0; i < gpuCount; i++) {
    const ix = Math.floor(gpu.positions[i * 3] / cell);
    const iy = Math.floor(gpu.positions[i * 3 + 1] / cell);
    const iz = Math.floor(gpu.positions[i * 3 + 2] / cell);
    const key = hashKey(ix, iy, iz);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  }

  let maxVertexDelta = 0;
  let unmatched = 0;
  const cpuCount = cpu.positions.length / 3;
  for (let c = 0; c < cpuCount; c++) {
    const cx = cpu.positions[c * 3], cy = cpu.positions[c * 3 + 1], cz = cpu.positions[c * 3 + 2];
    const bx = Math.floor(cx / cell), by = Math.floor(cy / cell), bz = Math.floor(cz / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(hashKey(bx + dx, by + dy, bz + dz));
          if (!list) continue;
          for (const gi of list) {
            const d = Math.hypot(cx - gpu.positions[gi * 3], cy - gpu.positions[gi * 3 + 1], cz - gpu.positions[gi * 3 + 2]);
            if (d < best) best = d;
          }
        }
      }
    }
    if (best > tol) unmatched++;
    else if (best > maxVertexDelta) maxVertexDelta = best;
  }

  return {
    cpuVertices: cpuCount,
    gpuVertices: gpuCount,
    cpuTriangles: cpu.indices.length / 3,
    gpuTriangles: gpu.indices.length / 3,
    maxVertexDelta,
    unmatched,
    haloVertices: Math.max(0, gpuCount - cpuCount),
    withinTol: unmatched === 0,
  };
}
