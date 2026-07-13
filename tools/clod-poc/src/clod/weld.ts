// Spatial-hash vertex weld.
//
// Welds vertices within `epsilon` by quantized position. A position match with a normal
// or material mismatch is DirtyInput -> hard fail with the offending pair (never
// count-and-continue: a rejected conflict survives as an unwelded internal border and
// fails later with a worse message). Spatial hash, NOT a kd-tree (jglrxavpok perf trap).
//
// The hash buckets by round(pos/epsilon), but the merge decision uses the TRUE distance to
// canonical vertices in the vertex's bucket AND its 26 neighbours. Pure single-bucket snapping
// is fragile at bucket boundaries: two vertices that should be coincident but differ by sub-epsilon
// f32 noise (e.g. the shared seam of two adjacent GPU-meshed LOD0 pages at large world
// coordinates) can straddle a bucket edge and fail to weld, leaving an internal open border that
// only fails later as InternalBorderNotWelded. Checking neighbours within epsilon fixes that
// without ever merging genuinely distinct surface-nets vertices (which are >= ~0.5 cells apart).

import { PageMesh, ClodBuildError, vertexCount, type BorderTolerances } from "../types.js";
import { assertMaterialWeights, normalizeMaterialWeights } from "../material/material_weights.js";

export interface WeldReport {
  inputVertices: number;
  outputVertices: number;
  mergedVertices: number;
}

export interface WeldResult {
  mesh: PageMesh;
  report: WeldReport;
}

/** quantized xyz bucket -> list of canonical NEW indices whose position rounds into that bucket. */
type WeldKeyMap = Map<number, Map<number, Map<number, number[]>>>;

function bucketList(map: WeldKeyMap, qx: number, qy: number, qz: number): number[] | undefined {
  return map.get(qx)?.get(qy)?.get(qz);
}

function addToBucket(map: WeldKeyMap, qx: number, qy: number, qz: number, value: number): void {
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
  const list = z.get(qz);
  if (list) list.push(value);
  else z.set(qz, [value]);
}

/**
 * Nearest canonical vertex within `epsilon` (true distance) across the vertex's bucket and its 26
 * neighbours; deterministic tie-break by smaller canonical index. Returns undefined when none.
 */
function findCanonicalWithinEpsilon(
  map: WeldKeyMap,
  pos: readonly number[],
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  epsilon: number,
): number | undefined {
  let best: number | undefined;
  let bestD2 = epsilon * epsilon;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = bucketList(map, qx + dx, qy + dy, qz + dz);
        if (!list) continue;
        for (const ci of list) {
          const cx = px - pos[ci * 3];
          const cy = py - pos[ci * 3 + 1];
          const cz = pz - pos[ci * 3 + 2];
          const d2 = cx * cx + cy * cy + cz * cz;
          if (d2 < bestD2 || (d2 === bestD2 && (best === undefined || ci < best))) {
            bestD2 = d2;
            best = ci;
          }
        }
      }
    }
  }
  return best;
}

export function weldVertices(mesh: PageMesh, epsilon: number, tolerances?: BorderTolerances): WeldResult {
  const n = vertexCount(mesh);
  const inv = 1 / epsilon;
  const tol = tolerances ?? { position: epsilon, normalDot: 0.9999, material: 1e-4 };

  assertMaterialWeights(mesh, "weldVertices input");
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
    const found = findCanonicalWithinEpsilon(canonical, pos, px, py, pz, qx, qy, qz, epsilon);
    if (found === undefined) {
      const ni = pos.length / 3;
      addToBucket(canonical, qx, qy, qz, ni);
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
        if (dot < tol.normalDot) {
          const dx = px - pos[found * 3];
          const dy = py - pos[found * 3 + 1];
          const dz = pz - pos[found * 3 + 2];
          parts.push(`normal dot ${dot.toFixed(5)} (need >= ${tol.normalDot}); position delta (${dx.toExponential(2)},${dy.toExponential(2)},${dz.toExponential(2)}); normal (${mesh.normals[i * 3].toFixed(4)},${mesh.normals[i * 3 + 1].toFixed(4)},${mesh.normals[i * 3 + 2].toFixed(4)}) vs (${nrm[found * 3].toFixed(4)},${nrm[found * 3 + 1].toFixed(4)},${nrm[found * 3 + 2].toFixed(4)})`);
        }
        if (paintDelta > tol.material) parts.push(`paint delta ${paintDelta.toExponential(2)} (need <= ${tol.material})`);
        if (maxWeightDelta > tol.material) parts.push(`max weight delta ${maxWeightDelta.toExponential(2)} (need <= ${tol.material})`);
        throw new ClodBuildError("DirtyInput", parts.join("; "));
      }
      const mc = mergeCount[found];
      const next = mc + 1;
      let nx = (nrm[found * 3] * mc + mesh.normals[i * 3]) / next;
      let ny = (nrm[found * 3 + 1] * mc + mesh.normals[i * 3 + 1]) / next;
      let nz = (nrm[found * 3 + 2] * mc + mesh.normals[i * 3 + 2]) / next;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm[found * 3] = nx / len;
      nrm[found * 3 + 1] = ny / len;
      nrm[found * 3 + 2] = nz / len;
      for (let j = 0; j < ws; j++) {
        wgt[found * ws + j] = (wgt[found * ws + j] * mc + mesh.materialWeights[i * ws + j]) / next;
      }
      mergeCount[found] = next;
      remap[i] = found;
    }
  }

  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]];

  const welded: PageMesh = {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    paintSlots: new Float32Array(mat),
    materialWeights: new Float32Array(wgt),
    materialWeightStride: ws,
    indices,
  };
  normalizeMaterialWeights(welded, "weldVertices output");

  return {
    mesh: welded,
    report: { inputVertices: n, outputVertices: pos.length / 3, mergedVertices: n - pos.length / 3 },
  };
}
