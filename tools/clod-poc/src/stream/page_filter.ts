export function isVisualPageDistance(distanceM: number, liveRadiusM: number, clodRadiusM: number, pageSizeM: number): boolean {
  if (distanceM <= liveRadiusM) return false;
  return distanceM <= clodRadiusM + pageSizeM * Math.SQRT2 * 0.5;
}
