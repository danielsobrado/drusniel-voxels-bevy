// SOLE meshoptimizer boundary.
//
// No other module imports meshoptimizer. quadtree.ts sees only this API.
// simplify_sloppy is NEVER used because it can break topology.

import { MeshoptSimplifier } from "meshoptimizer";
import { PageMesh, ClodBuildError, vertexCount } from "./types.js";
import { ClodPagesConfig } from "./config.js";
import { paintMaterialAt } from "./terrain.js";
import { ensureMaterialWeights } from "./materialWeights.js";

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

export interface SimplifyOptions {
  preserveMaterials?: boolean;
}

/**
 * Decimate `mesh` toward target_ratio_per_level, carrying normals + material weights and
 * honouring per-vertex locks. Returns the simplified mesh plus world-space error.
 */
export function simplifyPage(
  mesh: PageMesh,
  locks: Uint8Array,
  cfg: ClodPagesConfig,
  options: SimplifyOptions = {},
): SimplifyOutput {
  if (!ready) throw new ClodBuildError("SimplifierApiUnavailable", "call initSimplifier() first");

  const vc = vertexCount(mesh);
  ensureMaterialWeights(mesh);
  const ws = mesh.materialWeightStride;
  const inputIndices = mesh.indices.length;
  const targetRaw = Math.floor(inputIndices * cfg.simplify.target_ratio_per_level);
  const targetIndices = Math.min(inputIndices, Math.max(3, Math.floor(targetRaw / 3) * 3));

  // Interleave attributes: [n0 n1 n2 w0..wN] per vertex, stride = 3 + ws.
  const ATTR_STRIDE = 3 + ws;
  const attrs = new Float32Array(vc * ATTR_STRIDE);
  for (let i = 0; i < vc; i++) {
    attrs[i * ATTR_STRIDE + 0] = mesh.normals[i * 3 + 0];
    attrs[i * ATTR_STRIDE + 1] = mesh.normals[i * 3 + 1];
    attrs[i * ATTR_STRIDE + 2] = mesh.normals[i * 3 + 2];
    for (let j = 0; j < ws; j++) attrs[i * ATTR_STRIDE + 3 + j] = mesh.materialWeights[i * ws + j];
  }
  const wn = cfg.simplify.attribute_weights.normal;
  const wm = cfg.simplify.attribute_weights.material;
  const attrWeights = [wn, wn, wn, ...Array(ws).fill(wm)];

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
  // NOTE: compaction copies original positions verbatim — no snapping.
  // Locked border vertices must survive simplification unchanged.
  const compacted = compact(mesh, newIndices, options);

  const errorWorld = resultError * simplifyScale(mesh);
  const lowBenefit = newIndices.length > cfg.simplify.abandon_ratio * inputIndices;

  return { mesh: compacted, resultError, errorWorld, lowBenefit };
}

/** Drop unreferenced vertices and remap indices. Copies original positions and weights verbatim. */
function compact(mesh: PageMesh, indices: Uint32Array, options: SimplifyOptions): PageMesh {
  const ws = mesh.materialWeightStride;
  const remap = new Map<number, number>();
  const pos: number[] = [], nrm: number[] = [], mat: number[] = [], wgt: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    let ni = remap.get(old);
    if (ni === undefined) {
      ni = pos.length / 3;
      remap.set(old, ni);
      pos.push(
        mesh.positions[old * 3],
        mesh.positions[old * 3 + 1],
        mesh.positions[old * 3 + 2],
      );
      nrm.push(mesh.normals[old * 3], mesh.normals[old * 3 + 1], mesh.normals[old * 3 + 2]);
      if (options.preserveMaterials) {
        mat.push(mesh.paintSlots[old]);
        for (let j = 0; j < ws; j++) wgt.push(mesh.materialWeights[old * ws + j]);
      } else {
        const paintSlot = paintMaterialAt(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
        mat.push(paintSlot);
        const clamped = Math.min(Math.max(0, paintSlot), ws - 1);
        for (let j = 0; j < ws; j++) wgt.push(j === clamped ? 1.0 : 0.0);
      }
    }
    out[i] = ni;
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    paintSlots: new Float32Array(mat),
    materialWeights: new Float32Array(wgt),
    materialWeightStride: ws,
    indices: out,
  };
}
