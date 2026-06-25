import { PageMesh, vertexCount } from "./types.js";

const DEFAULT_WEIGHT_STRIDE = 4;

/** One-hot encode the paint slot (mesh.materials) into N-channel material weights. */
export function deriveMaterialWeights(materials: Float32Array, vertexCount: number, stride = DEFAULT_WEIGHT_STRIDE): Float32Array {
  const weights = new Float32Array(vertexCount * stride);
  for (let i = 0; i < vertexCount; i++) {
    const slot = Math.min(Math.max(0, materials[i]), stride - 1);
    weights[i * stride + slot] = 1.0;
  }
  return weights;
}

/** Ensure mesh carries material weights, deriving them from paint slot if missing. */
export function ensureMaterialWeights(mesh: PageMesh): void {
  if (mesh.materialWeights && mesh.materialWeightStride > 0) return;
  const n = vertexCount(mesh);
  mesh.materialWeights = deriveMaterialWeights(mesh.paintSlots, n);
  mesh.materialWeightStride = DEFAULT_WEIGHT_STRIDE;
}

export { DEFAULT_WEIGHT_STRIDE };
