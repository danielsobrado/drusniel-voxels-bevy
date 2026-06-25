import { PageMesh, vertexCount, ClodBuildError } from "../types.js";

const DEFAULT_WEIGHT_STRIDE = 4;

/** One-hot encode the paint slot (mesh.paintSlots) into N-channel material weights. */
export function deriveMaterialWeights(materials: Float32Array, vertexCount: number, stride = DEFAULT_WEIGHT_STRIDE): Float32Array {
  const weights = new Float32Array(vertexCount * stride);
  for (let i = 0; i < vertexCount; i++) {
    const slot = Math.min(Math.max(0, materials[i]), stride - 1);
    weights[i * stride + slot] = 1.0;
  }
  return weights;
}

/**
 * Assert that the mesh carries explicit material weights (not a silent derivation).
 * Builder paths MUST call this so a future source path that forgets to generate real
 * terrain weights fails loud instead of silently inheriting one-hot paint-slot weights.
 */
export function assertMaterialWeights(mesh: PageMesh, label: string): void {
  if (!mesh.materialWeights || mesh.materialWeightStride <= 0) {
    throw new ClodBuildError(
      "DegenerateGeometry",
      `${label}: missing materialWeights (materialWeightStride=${mesh.materialWeightStride})`,
    );
  }
  const expected = vertexCount(mesh) * mesh.materialWeightStride;
  if (mesh.materialWeights.length !== expected) {
    throw new ClodBuildError(
      "DegenerateGeometry",
      `${label}: materialWeights length ${mesh.materialWeights.length} != ${expected}`,
    );
  }
}

/**
 * Legacy fallback: derive material weights from paint slots when weights are absent.
 * Only for import/migration paths (loading old data). Builder paths MUST call
 * {@link assertMaterialWeights} instead.
 */
export function ensureLegacyMaterialWeights(mesh: PageMesh): void {
  if (mesh.materialWeights && mesh.materialWeightStride > 0) return;
  const n = vertexCount(mesh);
  mesh.materialWeights = deriveMaterialWeights(mesh.paintSlots, n);
  mesh.materialWeightStride = DEFAULT_WEIGHT_STRIDE;
}

export { DEFAULT_WEIGHT_STRIDE };
