// Spatial-hash vertex weld.
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

type WeldKeyMap = Map<number, Map<number, Map<number, number>>>;

function getCanonical(map: WeldKeyMap, qx: number, qy: number, qz: number): number | undefined {
  return map.get(qx)?.get(qy)?.get(qz);
}

function setCanonical(map: WeldKeyMap, qx: number, qy: number, qz: number, value: number): void {
  let yz = map.get(qx);
  if (!yz) {
    yz = new Map();
    map.set(qx, yz);
  }
  let z = yz.get(qy);
  if (!z) {
    z = new Map();
    yz.set(qy, z);
  }
  z.set(qz, value);
}

export function weldVertices(mesh: PageMesh, epsilon: number): WeldResult {
  const n = vertexCount(mesh);
  const inv = 1 / epsilon;
  const tol = DEFAULT_TOLERANCES;

  const canonical: WeldKeyMap = new Map(); // quantized xyz -> canonical NEW index
  const remap = new Uint32Array(n); // old index -> new index
  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];

  for (let i = 0; i < n; i++) {
    const px = mesh.positions[i * 3], py = mesh.positions[i * 3 + 1], pz = mesh.positions[i * 3 + 2];
    const qx = Math.round(px * inv), qy = Math.round(py * inv), qz = Math.round(pz * inv);
    const found = getCanonical(canonical, qx, qy, qz);
    if (found === undefined) {
      const ni = pos.length / 3;
      setCanonical(canonical, qx, qy, qz, ni);
      remap[i] = ni;
      pos.push(px, py, pz);
      nrm.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
      mat.push(mesh.materials[i]);
    } else {
      // conflict check against the canonical vertex
      const dot =
        mesh.normals[i * 3] * nrm[found * 3] +
        mesh.normals[i * 3 + 1] * nrm[found * 3 + 1] +
        mesh.normals[i * 3 + 2] * nrm[found * 3 + 2];
      const matDelta = Math.abs(mesh.materials[i] - mat[found]);
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
