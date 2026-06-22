import type { ClodPageNode, PageMesh } from "../types.js";

export function computeParentErrorWorld(
  parentMesh: PageMesh,
  sourceMesh: PageMesh,
  children: readonly ClodPageNode[],
): number {
  let maxError = 0;
  for (let i = 0; i < sourceMesh.positions.length; i += 3) {
    const sx = sourceMesh.positions[i];
    const sy = sourceMesh.positions[i + 1];
    const sz = sourceMesh.positions[i + 2];
    const py = nearestParentHeight(parentMesh, sx, sz);
    maxError = Math.max(maxError, Math.abs(sy - py));
  }
  for (const child of children) maxError = Math.max(maxError, child.errorWorld);
  return Number.isFinite(maxError) ? Math.max(0, maxError) : 0;
}

function nearestParentHeight(mesh: PageMesh, x: number, z: number): number {
  // TODO: replace nearest-vertex height approximation with parent-triangle or
  // parent-height interpolation before using this as a visual quality metric.
  let bestD2 = Infinity;
  let bestY = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const dx = mesh.positions[i] - x;
    const dz = mesh.positions[i + 2] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestY = mesh.positions[i + 1];
    }
  }
  return bestY;
}
