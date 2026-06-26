export interface PageRange {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function pageRangeForRadius(centerX: number, centerZ: number, radiusM: number, pageSizeM: number): PageRange {
  return {
    minX: Math.floor((centerX - radiusM) / pageSizeM),
    maxX: Math.floor((centerX + radiusM) / pageSizeM),
    minZ: Math.floor((centerZ - radiusM) / pageSizeM),
    maxZ: Math.floor((centerZ + radiusM) / pageSizeM),
  };
}
