import { concatPageSourceMeshes } from "./pageSource.js";
import type { ClodPageNode, PageMesh } from "../types.js";
import { assertMaterialWeights, normalizeMaterialWeights } from "../material/material_weights.js";

export function mergeChildPageMeshes(children: readonly ClodPageNode[], epsilon: number): PageMesh {
  const ordered = [...children].sort((a, b) =>
    a.footprint.minZ - b.footprint.minZ ||
    a.footprint.minX - b.footprint.minX ||
    a.id.localeCompare(b.id)
  );
  const mesh = weldMergedChildVertices(
    concatPageSourceMeshes(ordered.map((child) => child.mesh)),
    epsilon,
  );
  validateFiniteMesh(mesh, "merged child page mesh");
  return mesh;
}

function weldMergedChildVertices(mesh: PageMesh, epsilon: number): PageMesh {
  const inv = 1 / epsilon;
  assertMaterialWeights(mesh, "weldMergedChildVertices input");
  const ws = mesh.materialWeightStride;
  const remap = new Uint32Array(mesh.positions.length / 3);
  const canonical = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];
  const weights: number[] = [];
  const counts: number[] = [];

  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    const material = mesh.paintSlots[i];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)},${Math.round(material * 1000)}`;
    let next = canonical.get(key);
    if (next === undefined) {
      next = positions.length / 3;
      canonical.set(key, next);
      positions.push(x, y, z);
      normals.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
      materials.push(material);
      for (let j = 0; j < ws; j++) weights.push(mesh.materialWeights[i * ws + j]);
      counts.push(1);
    } else {
      normals[next * 3] += mesh.normals[i * 3];
      normals[next * 3 + 1] += mesh.normals[i * 3 + 1];
      normals[next * 3 + 2] += mesh.normals[i * 3 + 2];
      const count = counts[next];
      for (let j = 0; j < ws; j++) {
        weights[next * ws + j] = (weights[next * ws + j] * count + mesh.materialWeights[i * ws + j]) / (count + 1);
      }
      counts[next] = count + 1;
    }
    remap[i] = next;
  }

  for (let i = 0; i < counts.length; i++) {
    const base = i * 3;
    normals[base] /= counts[i];
    normals[base + 1] /= counts[i];
    normals[base + 2] /= counts[i];
    const len = Math.hypot(normals[base], normals[base + 1], normals[base + 2]);
    if (len > 0.000001) {
      normals[base] /= len;
      normals[base + 1] /= len;
      normals[base + 2] /= len;
    }
  }

  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]];
  const welded: PageMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(materials),
    materialWeights: new Float32Array(weights),
    materialWeightStride: ws,
    indices,
  };
  normalizeMaterialWeights(welded, "weldMergedChildVertices output");
  return welded;
}

export function validateFiniteMesh(mesh: PageMesh, label: string): void {
  if (mesh.indices.length === 0) throw new Error(`${label} has no indices`);
  for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error(`${label} has non-finite position`);
  for (const value of mesh.normals) if (!Number.isFinite(value)) throw new Error(`${label} has non-finite normal`);
  for (const value of mesh.paintSlots) if (!Number.isFinite(value)) throw new Error(`${label} has non-finite paintSlot`);
}
