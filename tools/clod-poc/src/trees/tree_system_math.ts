import type { PageFootprint } from "../types.js";
import type { TreeLod } from "./tree_config.js";

export function treeFootprintCenterX(footprint: PageFootprint): number {
  return (footprint.minX + footprint.maxX) * 0.5;
}

export function treeFootprintCenterZ(footprint: PageFootprint): number {
  return (footprint.minZ + footprint.maxZ) * 0.5;
}

export function treeFootprintRadius(footprint: PageFootprint): number {
  return Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
}

export function treeDistance2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export function visibleTreeLodCount(counts: Record<TreeLod, number>): number {
  return counts.near + counts.mid + counts.far + counts.impostor;
}

export function formatTreeLodCounts(counts: Record<TreeLod, number>): string {
  return `${counts.near}/${counts.mid}/${counts.far}/${counts.impostor}`;
}
