import type { DirtyCellBounds } from "./clod/quadtree.js";

export const DIRTY_BOUNDS_MAX_EPSILON = 1e-6;

export function mergeDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

export function intersectDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds | null {
  const clipped = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
  return clipped.minX < clipped.maxX && clipped.minZ < clipped.maxZ ? clipped : null;
}

export function inclusiveMaxBoundary(value: number): number {
  return value - DIRTY_BOUNDS_MAX_EPSILON;
}
