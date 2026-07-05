import type { FarClipmapOwnershipSnapshot } from "../terrain/far_clipmap/index.js";

export interface FarClipmapOwnerCounters {
  far_clipmap_owned_cells: number;
  far_clipmap_unowned_cells: number;
  far_clipmap_ownership_holes: number;
  far_clipmap_priority_overlap_cells: number;
  owner_far_clipmap_cells: number;
}

export const EMPTY_FAR_CLIPMAP_OWNER_COUNTERS: FarClipmapOwnerCounters = Object.freeze({
  far_clipmap_owned_cells: 0,
  far_clipmap_unowned_cells: 0,
  far_clipmap_ownership_holes: 0,
  far_clipmap_priority_overlap_cells: 0,
  owner_far_clipmap_cells: 0,
});

export function farClipmapCoversCell(
  farClipmap: FarClipmapOwnershipSnapshot | undefined,
  x: number,
  z: number,
): boolean {
  if (!farClipmap?.enabled || !farClipmap.ready) return false;
  const distance = Math.hypot(x - farClipmap.centerX, z - farClipmap.centerZ);
  return distance >= farClipmap.innerRadiusM && distance <= farClipmap.outerRadiusM;
}

export function farClipmapBandContainsCell(
  farClipmap: FarClipmapOwnershipSnapshot | undefined,
  x: number,
  z: number,
): boolean {
  if (!farClipmap?.enabled) return false;
  const distance = Math.hypot(x - farClipmap.centerX, z - farClipmap.centerZ);
  return distance >= farClipmap.innerRadiusM && distance <= farClipmap.outerRadiusM;
}
