import type { FarClipmapOwnershipSnapshot } from "../terrain/far_clipmap/index.js";

function parseRefinedPageKey(key: string): { level: number; x: number; z: number } | null {
  const [levelText, coordText] = key.split(":");
  const [xText, zText] = (coordText ?? "").split(",");
  const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
  const x = Number(xText);
  const z = Number(zText);
  return Number.isInteger(level) && Number.isInteger(x) && Number.isInteger(z)
    ? { level, x, z }
    : null;
}

function refinedReadyKeySet(farClipmap: FarClipmapOwnershipSnapshot): ReadonlySet<string> {
  const refinedClod = farClipmap.refinedClod;
  if (!refinedClod) return new Set();
  if (!refinedClod.readyPageKeySet) {
    refinedClod.readyPageKeySet = new Set(refinedClod.readyPageKeys.map((key) => {
      const parsed = parseRefinedPageKey(key);
      return parsed ? `${parsed.x},${parsed.z}` : "";
    }));
  }
  return refinedClod.readyPageKeySet;
}

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
  if (distance > farClipmap.outerRadiusM) return false;
  if (distance >= farClipmap.innerRadiusM) return true;
  return refinedClodBandContainsCell(farClipmap, x, z) && !refinedClodCoversCell(farClipmap, x, z);
}

export function farClipmapBandContainsCell(
  farClipmap: FarClipmapOwnershipSnapshot | undefined,
  x: number,
  z: number,
): boolean {
  if (!farClipmap?.enabled) return false;
  const distance = Math.hypot(x - farClipmap.centerX, z - farClipmap.centerZ);
  const innerRadiusM = farClipmap.refinedClod?.innerRadiusM ?? farClipmap.innerRadiusM;
  return distance >= innerRadiusM && distance <= farClipmap.outerRadiusM;
}

export function refinedClodBandContainsCell(
  farClipmap: FarClipmapOwnershipSnapshot | undefined,
  x: number,
  z: number,
): boolean {
  const refinedClod = farClipmap?.refinedClod;
  if (!farClipmap?.enabled || !refinedClod) return false;
  const distance = Math.hypot(x - farClipmap.centerX, z - farClipmap.centerZ);
  return distance >= refinedClod.innerRadiusM && distance < refinedClod.outerRadiusM;
}

export function refinedClodCoversCell(
  farClipmap: FarClipmapOwnershipSnapshot | undefined,
  x: number,
  z: number,
): boolean {
  const refinedClod = farClipmap?.refinedClod;
  if (!farClipmap || !refinedClodBandContainsCell(farClipmap, x, z) || !refinedClod) return false;
  const pageSizeM = Math.max(1, refinedClod.pageSizeM);
  const px = Math.floor(x / pageSizeM);
  const pz = Math.floor(z / pageSizeM);
  return refinedReadyKeySet(farClipmap).has(`${px},${pz}`);
}
