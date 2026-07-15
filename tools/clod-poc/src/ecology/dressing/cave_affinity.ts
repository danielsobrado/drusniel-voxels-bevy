import { DRESSING_CLASS_DEFINITIONS, type DressingClassId } from "./class_registry.js";
import type { DressingEnvironmentSample } from "./types.js";

const CAVE_FLOOR_CLASSES: ReadonlySet<DressingClassId> = new Set([
  "moss_patch",
  "cap_fungus",
  "wet_stone_cluster",
  "cave_mouth_fern",
]);

export function evaluateCaveAffinity(classId: DressingClassId, sample: DressingEnvironmentSample): boolean {
  const definition = DRESSING_CLASS_DEFINITIONS[classId];
  const inCaveContext = sample.caveMouthFactor > 0 || sample.skyExposure < 0.1;
  if (!inCaveContext) return definition.cavePolicy !== "mouth_only";
  if (classId === "cave_mouth_fern") {
    return sample.caveMouthFactor >= 0.45
      && sample.skyExposure >= 0.1
      && sample.skyExposure <= 0.65
      && sample.moisture >= 0.5;
  }
  if (classId === "cliff_fern") return definition.cavePolicy === "allow_wall";
  return CAVE_FLOOR_CLASSES.has(classId) && definition.cavePolicy !== "reject";
}
