import { PageMesh, vertexCount, ClodBuildError } from "../types.js";

const DEFAULT_WEIGHT_STRIDE = 4;
const MATERIAL_WEIGHT_NORMALIZE_EPSILON = 0.005;

/** One-hot encode the paint slot (mesh.paintSlots) into N-channel material weights. */
export function deriveMaterialWeights(materials: Float32Array, vertexCount: number, stride = DEFAULT_WEIGHT_STRIDE): Float32Array {
  const weights = new Float32Array(vertexCount * stride);
  for (let i = 0; i < vertexCount; i++) {
    const slot = Math.min(Math.max(0, materials[i]), stride - 1);
    weights[i * stride + slot] = 1.0;
  }
  return weights;
}

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

export function normalizeMaterialWeights(mesh: PageMesh, label: string, epsilon = MATERIAL_WEIGHT_NORMALIZE_EPSILON): void {
  assertMaterialWeights(mesh, label);
  const vc = vertexCount(mesh);
  const ws = mesh.materialWeightStride;

  for (let i = 0; i < vc; i++) {
    const base = i * ws;
    let sum = 0;
    for (let j = 0; j < ws; j++) {
      const offset = base + j;
      const raw = mesh.materialWeights[offset];
      if (!Number.isFinite(raw)) {
        throw new ClodBuildError("DegenerateGeometry", `${label}: vertex ${i} material weight ${j} is non-finite`);
      }
      if (raw < -epsilon || raw > 1 + epsilon) {
        throw new ClodBuildError("DegenerateGeometry", `${label}: vertex ${i} material weight ${j}=${raw.toFixed(4)} outside [0,1]`);
      }
      const clamped = Math.min(1, Math.max(0, raw));
      mesh.materialWeights[offset] = clamped;
      sum += clamped;
    }

    if (sum <= epsilon) {
      const fallback = 1 / ws;
      for (let j = 0; j < ws; j++) mesh.materialWeights[base + j] = fallback;
    } else {
      for (let j = 0; j < ws; j++) mesh.materialWeights[base + j] /= sum;
    }
  }
}

export function ensureLegacyMaterialWeights(mesh: PageMesh): void {
  if (mesh.materialWeights && mesh.materialWeightStride > 0) return;
  const n = vertexCount(mesh);
  mesh.materialWeights = deriveMaterialWeights(mesh.paintSlots, n);
  mesh.materialWeightStride = DEFAULT_WEIGHT_STRIDE;
}

export { DEFAULT_WEIGHT_STRIDE, MATERIAL_WEIGHT_NORMALIZE_EPSILON };
