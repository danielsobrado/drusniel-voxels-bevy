import type { LargePropOcclusionSample } from "../props/large_prop_occlusion_field.js";

export function riverMistPropTransmission(
  sample: LargePropOcclusionSample,
  spawnY: number,
  clipStrength: number,
): number {
  if (
    !sample.valid
    || !sample.enabled
    || sample.fogOccupancy <= 0
    || !Number.isFinite(spawnY)
    || spawnY < sample.fogBottomY
    || spawnY > sample.fogTopY
  ) {
    return 1;
  }

  const strength = clamp01(clipStrength);
  return clamp01(1 - sample.fogOccupancy * strength);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
