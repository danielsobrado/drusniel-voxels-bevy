export type WaterReflectionRgb = readonly [number, number, number];

export function encodeWaterHorizonSlope(slope: number): number {
  return clamp01((Math.atan(Number.isFinite(slope) ? slope : 0) + 0.15) / 1.2);
}

export function decodeWaterHorizonSlope(encoded: number): number {
  return Math.tan(clamp01(encoded) * 1.2 - 0.15);
}

export function resolveWaterSsrMissRoute(
  openToAtmosphere: boolean,
  probeGiReady: boolean,
  atmosphere: WaterReflectionRgb,
  directionalProbeGi: WaterReflectionRgb,
  terrainFallback: WaterReflectionRgb,
): WaterReflectionRgb {
  if (openToAtmosphere) return atmosphere;
  return probeGiReady ? directionalProbeGi : terrainFallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
