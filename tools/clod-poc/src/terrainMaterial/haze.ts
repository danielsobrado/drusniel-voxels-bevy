export interface HazeParams {
  enabled: boolean;
  start_m: number;
  end_m: number;
  color: [number, number, number];
  strength: number;
  height_falloff: number;
}

export interface HazeResult {
  factor: number;
  blendedColor: [number, number, number];
}

const EPSILON = 1e-8;

function smoothstep(edge0: number, edge1: number, v: number): number {
  const range = edge1 - edge0;
  const denom = Math.abs(range) < EPSILON ? EPSILON : range;
  const t = Math.min(1, Math.max(0, (v - edge0) / denom));
  return t * t * (3 - 2 * t);
}

export function computeHaze(
  distanceM: number,
  heightM: number,
  params: HazeParams,
): HazeResult {
  if (!params.enabled || params.end_m <= params.start_m) {
    return { factor: 0, blendedColor: [0, 0, 0] };
  }

  const distFactor = smoothstep(params.start_m, params.end_m, distanceM);

  const heightFade = Math.exp(-Math.max(0, heightM) * params.height_falloff);

  const rawFactor = distFactor * heightFade;
  const factor = Math.min(1, Math.max(0, rawFactor * params.strength));

  return {
    factor,
    blendedColor: [params.color[0], params.color[1], params.color[2]],
  };
}

export function blendWithHaze(
  originalColor: [number, number, number],
  haze: HazeResult,
): [number, number, number] {
  if (haze.factor <= 0) return originalColor;
  const t = haze.factor;
  return [
    Math.min(1, Math.max(0, originalColor[0] * (1 - t) + haze.blendedColor[0] * t)),
    Math.min(1, Math.max(0, originalColor[1] * (1 - t) + haze.blendedColor[1] * t)),
    Math.min(1, Math.max(0, originalColor[2] * (1 - t) + haze.blendedColor[2] * t)),
  ];
}

export function computeHazeRange(
  distanceM: number,
  startM: number,
  endM: number,
): number {
  return smoothstep(startM, endM, distanceM);
}
