// Vertical probe into a page mesh: the height of the top surface at (x, z).
//
// Used by the stream-root bed probe (render-vs-authority verification): voxel terrain
// can overhang, so the probe reports the MAXIMUM interpolated height across all
// triangles whose XZ projection contains the point — the surface an aerial camera sees.

export interface ProbeMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array | Uint16Array;
}

export function interpolateMeshHeightAt(mesh: ProbeMesh, x: number, z: number): number | null {
  const { positions, indices } = mesh;
  let best: number | null = null;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a], az = positions[a + 2];
    const bx = positions[b], bz = positions[b + 2];
    const cx = positions[c], cz = positions[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue; // degenerate in XZ (vertical wall)
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const wc = 1 - wa - wb;
    const eps = -1e-6;
    if (wa < eps || wb < eps || wc < eps) continue;
    const y = wa * positions[a + 1] + wb * positions[b + 1] + wc * positions[c + 1];
    if (best === null || y > best) best = y;
  }
  return best;
}
