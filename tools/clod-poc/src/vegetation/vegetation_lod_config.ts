import { load } from "js-yaml";
import type { TreeSettings } from "../trees/tree_config.js";
import { treeLodCrossfadeHalfBandM } from "../trees/tree_lod_transition.js";
import type { CanopyShellConfig } from "../canopy/canopy_config.js";

export interface VegetationLodConfig {
  canopyHandoff: {
    startM: number;
    endM: number;
  };
}

export function parseVegetationLodConfig(yamlText: string): VegetationLodConfig {
  const root = load(yamlText) as {
    vegetation_lod?: {
      canopy_handoff?: {
        start_m?: unknown;
        end_m?: unknown;
      };
    };
  } | null;

  const raw = root?.vegetation_lod?.canopy_handoff;
  const startM = requiredFiniteNumber(raw?.start_m, "vegetation_lod.canopy_handoff.start_m");
  const endM = requiredFiniteNumber(raw?.end_m, "vegetation_lod.canopy_handoff.end_m");

  if (startM < 0) {
    throw new Error("vegetation_lod.canopy_handoff.start_m must be >= 0");
  }
  if (endM <= startM) {
    throw new Error(
      "vegetation_lod.canopy_handoff.end_m must be greater than start_m",
    );
  }

  return {
    canopyHandoff: { startM, endM },
  };
}

export function validateVegetationLodContract(
  vegetation: VegetationLodConfig,
  trees: TreeSettings,
  canopy: CanopyShellConfig,
): void {
  const farEndM = trees.distanceM * trees.lod.farFraction;
  const farTransitionEndM = farEndM + treeLodCrossfadeHalfBandM(trees);

  if (farTransitionEndM >= vegetation.canopyHandoff.startM) {
    throw new Error(
      `tree far LOD transition end (${farTransitionEndM}) must be below canopy handoff start ` +
      `(${vegetation.canopyHandoff.startM})`,
    );
  }

  if (trees.lod.impostorEndM !== vegetation.canopyHandoff.endM
    || trees.lod.canopyFadeStartM !== vegetation.canopyHandoff.startM
    || trees.lod.canopyFadeEndM !== vegetation.canopyHandoff.endM) {
    throw new Error("tree runtime settings must match the shared vegetation LOD handoff");
  }

  if (vegetation.canopyHandoff.endM > canopy.distances.shellEndM) {
    throw new Error(
      `canopy handoff end (${vegetation.canopyHandoff.endM}) must be <= ` +
      `canopy shell end (${canopy.distances.shellEndM})`,
    );
  }
}

function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}
