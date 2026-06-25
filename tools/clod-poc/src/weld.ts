// Spatial-hash vertex weld.
//
// Welds vertices within `epsilon` by quantized position. A position match with a normal
// or material mismatch is DirtyInput -> hard fail with the offending pair (never
// count-and-continue: a rejected conflict survives as an unwelded internal border and
// fails later with a worse message). Spatial hash, NOT a kd-tree (jglrxavpok perf trap).

import { PageMesh, ClodBuildError, vertexCount, type BorderTolerances } from "./types.js";
import { ensureMaterialWeights } from "./materialWeights.js";

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

export function weldVertices(mesh: PageMesh, epsilon: number, tolerances?: BorderTolerances): WeldResult {
  const n = vertexCount(mesh);
  const inv = 1 / epsilon;
  const tol = tolerances ?? { position: epsilon, normalDot: 0.9999, material: 1e-4 };

  ensureMaterialWeights(mesh);
  const ws = mesh.materialWeightStride;

  const canonical: WeldKeyMap = new Map(); // quantized xyz -> canonical NEW index
  const remap = new Uint32Array(n); // old index -> new index
  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];
  const wgt: number[] = [];
  const mergeCount: number[] = [];

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
      mat.push(mesh.paintSlots[i]);
      for (let j = 0; j < ws; j++) wgt.push(mesh.materialWeights[i * ws + j]);
      mergeCount.push(1);
    } else {
      const dot =
        mesh.normals[i * 3] * nrm[found * 3] +
        mesh.normals[i * 3 + 1] * nrm[found * 3 + 1] +
        mesh.normals[i * 3 + 2] * nrm[found * 3 + 2];
      const paintDelta = Math.abs(mesh.paintSlots[i] - mat[found]);
      let maxWeightDelta = 0;
      for (let j = 0; j < ws; j++) {
        maxWeightDelta = Math.max(maxWeightDelta, Math.abs(mesh.materialWeights[i * ws + j] - wgt[found * ws + j]));
      }
      if (dot < tol.normalDot || paintDelta > tol.material || maxWeightDelta > tol.material) {
        const parts: string[] = [`weld conflict at (${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)})`];
        if (dot < tol.normalDot) parts.push(`normal dot ${dot.toFixed(5)} (need >= ${tol.normalDot})`);
        if (paintDelta > tol.material) parts.push(`paint delta ${paintDelta.toExponential(2)} (need <= ${tol.material})`);
        if (maxWeightDelta > tol.material) parts.push(`max weight delta ${maxWeightDelta.toExponential(2)} (need <= ${tol.material})`);
        throw new ClodBuildError("DirtyInput", parts.join("; "));
      }
      // average material weights on merge
      const mc = mergeCount[found];
      for (let j = 0; j < ws; j++) {
        wgt[found * ws + j] = (wgt[found * ws + j] * mc + mesh.materialWeights[i * ws + j]) / (mc + 1);
      }
      mergeCount[found] = mc + 1;
      remap[i] = found;
    }
  }

  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]];

  return {
    mesh: {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      paintSlots: new Float32Array(mat),
      materialWeights: new Float32Array(wgt),
      materialWeightStride: ws,
      indices,
    },
    report: { inputVertices: n, outputVertices: pos.length / 3, mergedVertices: n - pos.length / 3 },
  };
}
