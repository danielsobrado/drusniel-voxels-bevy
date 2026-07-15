import { DRESSING_CLASS_DEFINITIONS, type DressingClassId } from "./class_registry.js";
import { evaluateCaveAffinity } from "./cave_affinity.js";
import { evaluateHydrologyAffinity } from "./hydrology_affinity.js";
import type { DressingEnvironmentSample } from "./types.js";

function slopeDegrees(normalY: number): number {
  return Math.acos(Math.max(-1, Math.min(1, normalY))) * 180 / Math.PI;
}

export function acceptTerrainCandidate(classId: DressingClassId, sample: DressingEnvironmentSample): boolean {
  const definition = DRESSING_CLASS_DEFINITIONS[classId];
  if (definition.ownership !== "terrain_attached") return false;
  if (sample.structureExcluded || sample.persistentExcluded) return false;
  if (!evaluateCaveAffinity(classId, sample)) return false;
  if (!evaluateHydrologyAffinity(classId, sample).accepted) return false;
  const [grassWeight, rockWeight, sandWeight, snowWeight] = sample.materialWeights;
  if ((classId === "cap_fungus" || classId === "flower_patch") && (snowWeight >= 0.5 || sandWeight >= 0.65)) return false;
  if (classId === "leaf_litter") {
    return sample.canopyBroadleaf >= 0.2 && litterSurfaceAccepted(sample, rockWeight);
  }
  if (classId === "needle_litter") {
    return sample.canopyConifer >= 0.2 && litterSurfaceAccepted(sample, rockWeight);
  }
  if (classId === "cliff_fern") {
    const slope = slopeDegrees(sample.normal[1]);
    return slope >= 55 && slope <= 88 && sample.moisture >= 0.45 && rockWeight >= 0.45
      && (sample.exactVoxelSurface || Number.isFinite(sample.position[1]));
  }
  if (classId === "moss_patch") return mossAffinity(sample) >= 0.35;
  if (classId === "lichen_patch") return lichenAffinity(sample) >= 0.35;
  if (classId === "flower_patch") return sample.waterDepthM === 0 && grassWeight >= 0.25 && sample.sunExposure >= 0.35;
  return sample.waterDepthM <= 0.12;
}

function litterSurfaceAccepted(sample: DressingEnvironmentSample, rockWeight: number): boolean {
  return sample.waterDepthM === 0
    && Math.hypot(sample.flow[0], sample.flow[1]) < 0.15
    && sample.normal[1] >= Math.cos(35 * Math.PI / 180)
    && rockWeight < 0.65
    && !sample.terrainEdited;
}

export function mossAffinity(sample: DressingEnvironmentSample): number {
  const northBias = Math.max(0, sample.normal[2]) * 0.12;
  const shore = sample.shoreDistanceM >= 0 && sample.shoreDistanceM <= 4 ? 0.12 : 0;
  const slope = Math.max(0, sample.normal[1]);
  return Math.max(0, Math.min(1, sample.moisture * 0.38 + (1 - sample.sunExposure) * 0.25 + slope * 0.13 + northBias + shore));
}

export function lichenAffinity(sample: DressingEnvironmentSample): number {
  const rockWeight = sample.materialWeights[1];
  const dryness = 1 - sample.moisture;
  return Math.max(0, Math.min(1, rockWeight * 0.35 + sample.hardness * 0.25 + sample.sunExposure * 0.2 + dryness * 0.2));
}
