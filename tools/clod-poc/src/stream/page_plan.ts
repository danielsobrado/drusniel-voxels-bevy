import { isVisualPageDistance } from "./page_filter.js";
import { pageRangeForRadius } from "./page_range.js";

export function pageKey(level: number, x: number, z: number): string {
  return String(level) + ":" + String(x) + "," + String(z);
}

export function pageCenterX(x: number, pageSize: number): number {
  return (x + 0.5) * pageSize;
}

export function pageCenterZ(z: number, pageSize: number): number {
  return (z + 0.5) * pageSize;
}

export function visualPageKeys(centerX: number, centerZ: number, liveRadiusM: number, clodRadiusM: number, pageSizeM: number, maxLevel: number): string[] {
  const keys = new Set<string>();
  for (let level = 0; level <= maxLevel; level++) {
    const levelPageSize = pageSizeM * 2 ** level;
    const range = pageRangeForRadius(centerX, centerZ, clodRadiusM, levelPageSize);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let z = range.minZ; z <= range.maxZ; z++) {
        const dx = pageCenterX(x, levelPageSize) - centerX;
        const dz = pageCenterZ(z, levelPageSize) - centerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (isVisualPageDistance(distance, liveRadiusM, clodRadiusM, levelPageSize)) keys.add(pageKey(level, x, z));
      }
    }
  }
  return Array.from(keys).sort();
}
