// Spatial-hash vertex weld. Plan §3.2 / §11.3.
//
// Welds vertices within `epsilon` by quantized position. A position match with a normal
// or material mismatch is DirtyInput -> hard fail with the offending pair (never
// count-and-continue: a rejected conflict survives as an unwelded internal border and
// fails later with a worse message). Spatial hash, NOT a kd-tree (jglrxavpok perf trap).

import { PageMesh, ClodBuildError, DEFAULT_TOLERANCES, vertexCount } from "./types.js";

export interface WeldReport {
  inputVertices: number;
  outputVertices: number;
  mergedVertices: number;
}

export interface WeldResult {
  mesh: PageMesh;
  report: WeldReport;
}

function quantKey(x: number, y: number, z: number, inv: number): string {
  return `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
}

export function weldVertices(mesh: PageMesh, epsilon: number): WeldResult {
  const n = vertexCount(mesh);
  const inv = 1 / epsilon;
  const tol = DEFAULT_TOLERANCES;

  const canonical = new Map<string, number>(); // quant key -> canonical NEW index
  const remap = new Uint32Array(n); // old index -> new index
  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];

  for (let i = 0; i < n; i++) {
    const px = mesh.positions[i * 3], py = mesh.positions[i * 3 + 1], pz = mesh.positions[i * 3 + 2];
    const key = quantKey(px, py, pz, inv);
    const found = canonical.get(key);
    if (found === undefined) {
      const ni = pos.length / 3;
      canonical.set(key, ni);
      remap[i] = ni;
      pos.push(px, py, pz);
      nrm.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
      mat.push(
        mesh.materials[i * 4], mesh.materials[i * 4 + 1],
        mesh.materials[i * 4 + 2], mesh.materials[i * 4 + 3],
      );
    } else {
      // conflict check against the canonical vertex
      const dot =
        mesh.normals[i * 3] * nrm[found * 3] +
        mesh.normals[i * 3 + 1] * nrm[found * 3 + 1] +
        mesh.normals[i * 3 + 2] * nrm[found * 3 + 2];
      let matDelta = 0;
      for (let c = 0; c < 4; c++) {
        matDelta = Math.max(matDelta, Math.abs(mesh.materials[i * 4 + c] - mat[found * 4 + c]));
      }
      if (dot < tol.normalDot || matDelta > tol.material) {
        throw new ClodBuildError(
          "DirtyInput",
          `weld conflict at (${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)}): ` +
            `normal dot ${dot.toFixed(5)} (need >= ${tol.normalDot}), ` +
            `material delta ${matDelta.toExponential(2)} (need <= ${tol.material})`,
        );
      }
      remap[i] = found;
    }
  }

  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]];

  return {
    mesh: {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      materials: new Float32Array(mat),
      indices,
    },
    report: { inputVertices: n, outputVertices: pos.length / 3, mergedVertices: n - pos.length / 3 },
  };
}
