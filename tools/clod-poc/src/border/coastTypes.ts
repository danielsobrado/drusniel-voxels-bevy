import type { CoastTypeWeightsConfig } from "../config/borderCoastOceanConfig.js";

export type CoastType = "sandyBeach" | "rockyBeach" | "cliff" | "cove" | "reef";

export interface CoastWeights {
  sandyBeach: number;
  rockyBeach: number;
  cliff: number;
  cove: number;
  reef: number;
}

const COAST_TYPES: readonly CoastType[] = [
  "sandyBeach",
  "rockyBeach",
  "cliff",
  "cove",
  "reef",
];

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function segmentRandom(seed: number, segmentId: number): number {
  const hash = mix32((seed >>> 0) ^ Math.imul(segmentId + 1, 0x9e3779b1));
  return hash / 0x100000000;
}

function oneHot(type: CoastType): CoastWeights {
  return {
    sandyBeach: type === "sandyBeach" ? 1 : 0,
    rockyBeach: type === "rockyBeach" ? 1 : 0,
    cliff: type === "cliff" ? 1 : 0,
    cove: type === "cove" ? 1 : 0,
    reef: type === "reef" ? 1 : 0,
  };
}

export function selectCoastType(
  seed: number,
  segmentId: number,
  weights: CoastTypeWeightsConfig,
): CoastType {
  const roll = segmentRandom(seed, segmentId);
  const thresholds = [
    weights.sandy_beach,
    weights.sandy_beach + weights.rocky_beach,
    weights.sandy_beach + weights.rocky_beach + weights.cliff,
    weights.sandy_beach + weights.rocky_beach + weights.cliff + weights.cove,
    1,
  ];
  for (let index = 0; index < thresholds.length; index += 1) {
    if (roll < thresholds[index]) return COAST_TYPES[index];
  }
  return "reef";
}

export function blendCoastTypes(
  first: CoastType,
  second: CoastType,
  alpha: number,
): CoastWeights {
  const t = Math.min(1, Math.max(0, alpha));
  const a = oneHot(first);
  const b = oneHot(second);
  return {
    sandyBeach: a.sandyBeach * (1 - t) + b.sandyBeach * t,
    rockyBeach: a.rockyBeach * (1 - t) + b.rockyBeach * t,
    cliff: a.cliff * (1 - t) + b.cliff * t,
    cove: a.cove * (1 - t) + b.cove * t,
    reef: a.reef * (1 - t) + b.reef * t,
  };
}

export function dominantCoastType(weights: CoastWeights): CoastType {
  let dominant = COAST_TYPES[0];
  let dominantWeight = weights[dominant];
  for (let index = 1; index < COAST_TYPES.length; index += 1) {
    const type = COAST_TYPES[index];
    if (weights[type] > dominantWeight) {
      dominant = type;
      dominantWeight = weights[type];
    }
  }
  return dominant;
}
