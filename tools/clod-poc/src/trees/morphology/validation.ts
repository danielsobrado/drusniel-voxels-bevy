import { MORPHOLOGY_RANGES } from "./constants.js";
import type { TreeInstanceMorphology } from "./types.js";

export function clampTreeInstanceMorphology(input: TreeInstanceMorphology): TreeInstanceMorphology {
  const output = {} as TreeInstanceMorphology;
  for (const name of Object.keys(MORPHOLOGY_RANGES) as (keyof TreeInstanceMorphology)[]) {
    const [min, max] = MORPHOLOGY_RANGES[name];
    const value = Number.isFinite(input[name]) ? input[name] : min;
    output[name] = Math.max(min, Math.min(max, value));
  }
  clampVectorLength(output, "leanX", "leanZ", 0.22);
  clampVectorLength(output, "crownBiasX", "crownBiasZ", 0.35);
  return output;
}

function clampVectorLength(
  output: TreeInstanceMorphology,
  xName: "leanX" | "crownBiasX",
  zName: "leanZ" | "crownBiasZ",
  maxLength: number,
): void {
  const length = Math.hypot(output[xName], output[zName]);
  if (length <= maxLength || length <= 1e-12) return;
  const scale = maxLength / length;
  output[xName] *= scale;
  output[zName] *= scale;
}
