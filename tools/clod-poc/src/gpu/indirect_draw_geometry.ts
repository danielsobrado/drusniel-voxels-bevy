import * as THREE from "three";

export interface IndirectDrawGeometryStats {
  vertexCount: number;
  indexCount: number | null;
  drawCount: number;
}

export function indirectDrawGeometryStats(geometry: THREE.BufferGeometry): IndirectDrawGeometryStats {
  const vertexCount = Math.max(0, Math.floor(geometry.getAttribute("position")?.count ?? 0));
  const index = geometry.getIndex();
  const indexCount = index ? Math.max(0, Math.floor(index.count)) : null;
  return {
    vertexCount,
    indexCount,
    drawCount: indexCount ?? vertexCount,
  };
}

export function indirectDrawCountForGeometry(geometry: THREE.BufferGeometry): number {
  return indirectDrawGeometryStats(geometry).drawCount;
}

export function isRenderableIndirectDrawGeometry(geometry: THREE.BufferGeometry): boolean {
  const stats = indirectDrawGeometryStats(geometry);
  return stats.vertexCount > 0 && stats.drawCount > 0;
}

export function renderableIndirectDrawCountForGeometry(geometry: THREE.BufferGeometry): number {
  return isRenderableIndirectDrawGeometry(geometry) ? indirectDrawCountForGeometry(geometry) : 0;
}
