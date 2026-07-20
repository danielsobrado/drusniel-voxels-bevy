import type { TreeLod, TreeSettings } from "./tree_config.js";
import { treeImpostorVisibility } from "./tree_lod_transition.js";

export interface TreeLodSelection {
  lod: TreeLod;
  fade: number;
  secondaryLod: TreeLod | null;
  secondaryFade: number;
}

export interface TreeLodSelectionOptions {
  allowCrossfade?: boolean;
}

const LOD_ORDER: readonly TreeLod[] = ["near", "mid", "far", "impostor"] as const;

export function treeLodDistances(settings: TreeSettings): {
  near: number;
  mid: number;
  far: number;
  impostor: number;
} {
  return {
    near: settings.distanceM * settings.lod.nearFraction,
    mid: settings.distanceM * settings.lod.midFraction,
    far: settings.distanceM * settings.lod.farFraction,
    impostor: settings.lod.impostorEndM,
  };
}

export function selectTreeLod(
  distance: number,
  previousLod: TreeLod | null,
  settings: TreeSettings,
  options: TreeLodSelectionOptions = {},
): TreeLodSelection {
  const distances = treeLodDistances(settings);
  const baseLod = lodForDistance(distance, distances);
  const allowCrossfade = options.allowCrossfade ?? true;
  const crossfadeActive = allowCrossfade
    && settings.lod.crossfadeEnabled
    && settings.lod.ditherEnabled
    && settings.lod.crossfadeBandM > 0;

  if (crossfadeActive) {
    return applyCanopyHandoff(selectTreeLodWithCrossfade(distance, baseLod, settings), distance, settings);
  }

  const lod = previousLod
    ? lodWithHysteresis(distance, baseLod, previousLod, settings.lod.hysteresisM, distances)
    : baseLod;
  return applyCanopyHandoff({ lod, fade: 1, secondaryLod: null, secondaryFade: 0 }, distance, settings);
}

function applyCanopyHandoff(
  selection: TreeLodSelection,
  distance: number,
  settings: TreeSettings,
): TreeLodSelection {
  const visibility = treeImpostorVisibility(distance, settings);
  if (visibility >= 1) return selection;
  return {
    ...selection,
    fade: selection.lod === "impostor" ? selection.fade * visibility : selection.fade,
    secondaryFade: selection.secondaryLod === "impostor" ? selection.secondaryFade * visibility : selection.secondaryFade,
  };
}

function selectTreeLodWithCrossfade(
  distance: number,
  baseLod: TreeLod,
  settings: TreeSettings,
): TreeLodSelection {
  const band = settings.lod.crossfadeBandM;
  if (band <= 0) return { lod: baseLod, fade: 1, secondaryLod: null, secondaryFade: 0 };

  const distances = treeLodDistances(settings);
  const thresholds: readonly { distance: number; lower: TreeLod; upper: TreeLod }[] = [
    { distance: distances.near, lower: "near", upper: "mid" },
    { distance: distances.mid, lower: "mid", upper: "far" },
    { distance: distances.far, lower: "far", upper: "impostor" },
  ];
  for (const threshold of thresholds) {
    const halfBand = band * 0.5;
    if (distance < threshold.distance - halfBand || distance > threshold.distance + halfBand) continue;
    const upperWeight = clamp01((distance - (threshold.distance - halfBand)) / band);
    if (baseLod === threshold.upper) {
      return {
        lod: threshold.upper,
        fade: upperWeight,
        secondaryLod: threshold.lower,
        secondaryFade: 1 - upperWeight,
      };
    }
    return {
      lod: threshold.lower,
      fade: 1 - upperWeight,
      secondaryLod: threshold.upper,
      secondaryFade: upperWeight,
    };
  }

  return { lod: baseLod, fade: 1, secondaryLod: null, secondaryFade: 0 };
}

function lodForDistance(distance: number, distances: ReturnType<typeof treeLodDistances>): TreeLod {
  if (distance <= distances.near) return "near";
  if (distance <= distances.mid) return "mid";
  if (distance <= distances.far) return "far";
  return "impostor";
}

function lodWithHysteresis(
  distance: number,
  baseLod: TreeLod,
  previousLod: TreeLod,
  hysteresisM: number,
  distances: ReturnType<typeof treeLodDistances>,
): TreeLod {
  const previousIndex = LOD_ORDER.indexOf(previousLod);
  if (previousIndex < 0) return baseLod;

  const lowerBoundary = previousIndex > 0 ? lodUpperBoundary(LOD_ORDER[previousIndex - 1], distances) : Number.NEGATIVE_INFINITY;
  const upperBoundary = previousIndex < LOD_ORDER.length - 1 ? lodUpperBoundary(previousLod, distances) : Number.POSITIVE_INFINITY;
  if (distance >= lowerBoundary - hysteresisM && distance <= upperBoundary + hysteresisM) return previousLod;
  return baseLod;
}

function lodUpperBoundary(lod: TreeLod, distances: ReturnType<typeof treeLodDistances>): number {
  if (lod === "near") return distances.near;
  if (lod === "mid") return distances.mid;
  if (lod === "far") return distances.far;
  return distances.impostor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
