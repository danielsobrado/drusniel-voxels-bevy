import type { ClodPagesConfig } from "../../config.js";
import { validateFinalPageMesh } from "../../clod/validate.js";
import { footprintFor } from "../../clod/quadtree_support.js";
import type { PageMesh } from "../../types.js";
import type { GpuClodPagePipeline } from "./gpu_clod_page_pipeline.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

export const MATERIAL_WEIGHT_STRIDE = 4;

export interface SelectiveResidentReadbackResult {
  mesh: PageMesh;
  transferBytes: number;
}

/** Selective GPU→CPU page readback, then one-hot material-weight normalize + final mesh validate. */
export async function selectiveReadbackResidentPage(options: {
  pagePipeline: GpuClodPagePipeline;
  page: GpuClodResidentPage;
  cfg: ClodPagesConfig;
  level: number;
  px: number;
  pz: number;
}): Promise<SelectiveResidentReadbackResult> {
  const mesh = await options.pagePipeline.readbackPage(options.page);
  normalizeReadbackMaterialWeights(mesh);
  validateFinalPageMesh(
    mesh,
    footprintFor(options.level, options.px, options.pz, options.cfg),
    options.cfg.validation.zero_area_epsilon,
    `${options.page.id} GPU selective readback`,
  );
  return { mesh, transferBytes: meshBytes(mesh) };
}

export function normalizeReadbackMaterialWeights(mesh: PageMesh): void {
  const vertexTotal = mesh.positions.length / 3;
  const weights = new Float32Array(vertexTotal * MATERIAL_WEIGHT_STRIDE);
  for (let vertex = 0; vertex < vertexTotal; vertex++) {
    const material = Math.max(
      0,
      Math.min(MATERIAL_WEIGHT_STRIDE - 1, Math.floor(mesh.paintSlots[vertex] ?? 0)),
    );
    weights[vertex * MATERIAL_WEIGHT_STRIDE + material] = 1;
  }
  mesh.materialWeights = weights;
  mesh.materialWeightStride = MATERIAL_WEIGHT_STRIDE;
}

export function meshBytes(mesh: PageMesh): number {
  return mesh.positions.byteLength
    + mesh.normals.byteLength
    + mesh.paintSlots.byteLength
    + mesh.materialWeights.byteLength
    + mesh.indices.byteLength;
}

export function emptyPageMesh(): PageMesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    paintSlots: new Float32Array(0),
    materialWeights: new Float32Array(0),
    materialWeightStride: MATERIAL_WEIGHT_STRIDE,
    indices: new Uint32Array(0),
  };
}
