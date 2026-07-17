import type { ConstructionStabilityConfig } from "./types.js";

export const CONSTRUCTION_STABILITY_COLORS = {
  grounded: 0x3380ff,
  strong: 0x33e633,
  moderate: 0xffe626,
  weak: 0xff801a,
  failing: 0xf21a1a,
} as const;

export function constructionStabilityColorHex(input: {
  grounded: boolean;
  value: number;
  maxSupport: number;
  config: ConstructionStabilityConfig;
}): number {
  if (input.grounded) return CONSTRUCTION_STABILITY_COLORS.grounded;
  const ratio = input.maxSupport > 0 ? input.value / input.maxSupport : 0;
  if (ratio >= 0.67) return CONSTRUCTION_STABILITY_COLORS.strong;
  if (ratio >= 0.40) return CONSTRUCTION_STABILITY_COLORS.moderate;
  if (input.value + input.config.epsilon >= input.config.collapseThreshold) return CONSTRUCTION_STABILITY_COLORS.weak;
  return CONSTRUCTION_STABILITY_COLORS.failing;
}
