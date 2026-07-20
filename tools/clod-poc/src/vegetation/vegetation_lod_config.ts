import { load } from "js-yaml";
import type { TreeSettings } from "../trees/tree_config.js";
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
  const startM = finiteNumber(raw?.start_m, 620);
  const endM = finiteNumber(raw?.end_m, 760);

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

  if (farEndM >= vegetation.canopyHandoff.startM) {
    throw new Error(
      `tree far LOD end (${farEndM}) must be below canopy handoff start ` +
      `(${vegetation.canopyHandoff.startM})`,
    );
  }

  if (vegetation.canopyHandoff.endM > canopy.distances.shellEndM) {
    throw new Error(
      `canopy handoff end (${vegetation.canopyHandoff.endM}) must be <= ` +
      `canopy shell end (${canopy.distances.shellEndM})`,
    );
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
