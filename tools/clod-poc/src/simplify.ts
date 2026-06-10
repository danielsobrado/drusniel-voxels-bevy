// SOLE meshoptimizer boundary. Plan §3.2 / §11.5.
//
// No other module imports meshoptimizer. quadtree.ts sees only this API.
// simplify_sloppy is NEVER used (topology-breaking; the plan forbids it outright).

import { MeshoptSimplifier } from "meshoptimizer";
import { PageMesh, ClodBuildError, vertexCount } from "./types.js";
import { ClodPagesConfig } from "./config.js";

let ready = false;
export async function initSimplifier(): Promise<void> {
  if (ready) return;
  await MeshoptSimplifier.ready;
  // simplifyWithAttributes is gated behind this flag in some builds; harmless otherwise.
  (MeshoptSimplifier as unknown as { useExperimentalFeatures?: boolean }).useExperimentalFeatures = true;
  ready = true;
}

/** World-space simplification error scale for a mesh (meshopt_simplifyScale). */
export function simplifyScale(mesh: PageMesh): number {
  return MeshoptSimplifier.getScale(mesh.positions, 3);
}

export interface SimplifyOutput {
  mesh: PageMesh;
  resultError: number; // meshopt relative
  errorWorld: number; // resultError * simplifyScale
  lowBenefit: boolean;
}

/**
 * Decimate `mesh` toward target_ratio_per_level, carrying normals + material weights and
 * honouring per-vertex locks. Returns the simplified mesh plus world-space error.
 */
export function simplifyPage(
  mesh: PageMesh,
  locks: Uint8Array,
  cfg: ClodPagesConfig,
): SimplifyOutput {
  if (!ready) throw new ClodBuildError("SimplifierApiUnavailable", "call initSimplifier() first");

  const vc = vertexCount(mesh);
  const inputIndices = mesh.indices.length;
  const targetIndices = Math.max(3, Math.floor(inputIndices * cfg.simplify.target_ratio_per_level));

  // Interleave attributes: [n0 n1 n2 m0 m1 m2 m3] per vertex, stride 7.
  const ATTR_STRIDE = 7;
  const attrs = new Float32Array(vc * ATTR_STRIDE);
  for (let i = 0; i < vc; i++) {
    attrs[i * ATTR_STRIDE + 0] = mesh.normals[i * 3 + 0];
    attrs[i * ATTR_STRIDE + 1] = mesh.normals[i * 3 + 1];
    attrs[i * ATTR_STRIDE + 2] = mesh.normals[i * 3 + 2];
    attrs[i * ATTR_STRIDE + 3] = mesh.materials[i * 4 + 0];
    attrs[i * ATTR_STRIDE + 4] = mesh.materials[i * 4 + 1];
    attrs[i * ATTR_STRIDE + 5] = mesh.materials[i * 4 + 2];
    attrs[i * ATTR_STRIDE + 6] = mesh.materials[i * 4 + 3];
  }
  const wn = cfg.simplify.attribute_weights.normal;
  const wm = cfg.simplify.attribute_weights.material;
  const attrWeights = [wn, wn, wn, wm, wm, wm, wm];

  let result: [Uint32Array, number];
  try {
    result = MeshoptSimplifier.simplifyWithAttributes(
      mesh.indices,
      mesh.positions,
      3,
      attrs,
      ATTR_STRIDE,
      attrWeights,
      locks,
      targetIndices,
      cfg.simplify.target_error,
      ["LockBorder"],
    );
  } catch (e) {
    throw new ClodBuildError("MeshoptFailed", String(e));
  }

  const [newIndices, resultError] = result;

  // meshopt keeps the original vertex buffer; unused vertices are simply unreferenced.
  // Compact to referenced vertices so downstream weld/lock/stats stay tight.
  const compacted = compact(mesh, newIndices);

  const errorWorld = resultError * simplifyScale(mesh);
  const lowBenefit = newIndices.length > cfg.simplify.abandon_ratio * inputIndices;

  return { mesh: compacted, resultError, errorWorld, lowBenefit };
}

/** Drop unreferenced vertices and remap indices. */
function compact(mesh: PageMesh, indices: Uint32Array): PageMesh {
  const remap = new Map<number, number>();
  const pos: number[] = [], nrm: number[] = [], mat: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    let ni = remap.get(old);
    if (ni === undefined) {
      ni = pos.length / 3;
      remap.set(old, ni);
      pos.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
      nrm.push(mesh.normals[old * 3], mesh.normals[old * 3 + 1], mesh.normals[old * 3 + 2]);
      mat.push(
        mesh.materials[old * 4], mesh.materials[old * 4 + 1],
        mesh.materials[old * 4 + 2], mesh.materials[old * 4 + 3],
      );
    }
    out[i] = ni;
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    materials: new Float32Array(mat),
    indices: out,
  };
}
