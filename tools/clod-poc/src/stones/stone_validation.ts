import type { ClodPageNode } from "../types.js";

export interface PageMeshSignature {
  id: string;
  vertices: number;
  indices: number;
  normals: number;
  materials: number;
}

export function pageMeshSignatures(nodes: readonly ClodPageNode[]): PageMeshSignature[] {
  return nodes
    .map((node) => ({
      id: node.id,
      vertices: node.mesh.positions.length,
      indices: node.mesh.indices.length,
      normals: node.mesh.normals.length,
      materials: node.mesh.materials.length,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function assertPageMeshSignaturesUnchanged(
  before: readonly PageMeshSignature[],
  after: readonly PageMeshSignature[],
): void {
  const b = JSON.stringify(before);
  const a = JSON.stringify(after);
  if (a !== b) {
    throw new Error("Stone overlay mutated CLOD page mesh input/output signatures");
  }
}
