import type { MaterialQuality } from "../config/longViewMaterialsConfig.js";

export interface QualityLadderRule {
  nearPages: MaterialQuality;
  midPages: MaterialQuality;
  farPages: MaterialQuality;
  farShell: MaterialQuality;
}

const DEFAULT_LADDER: QualityLadderRule = {
  nearPages: "full_debug",
  midPages: "single_projection_far",
  farPages: "single_projection_far",
  farShell: "horizon_proxy",
};

const DEBUG_LADDER: QualityLadderRule = {
  nearPages: "atlas_only_debug",
  midPages: "atlas_only_debug",
  farPages: "atlas_only_debug",
  farShell: "atlas_only_debug",
};

export function resolveQualityLadder(
  farShellQuality: MaterialQuality,
  forceDebug: boolean,
): QualityLadderRule {
  if (forceDebug) return DEBUG_LADDER;
  if (farShellQuality === "atlas_only_debug") return DEBUG_LADDER;

  return {
    nearPages: farShellQuality === "full_debug" ? "full_debug" : DEFAULT_LADDER.nearPages,
    midPages: DEFAULT_LADDER.midPages,
    farPages: DEFAULT_LADDER.farPages,
    farShell: farShellQuality,
  };
}

export function pageQualityForDistance(
  distanceM: number,
  nearThresholdM: number,
  farThresholdM: number,
  ladder: QualityLadderRule,
): MaterialQuality {
  if (distanceM <= nearThresholdM) return ladder.nearPages;
  if (distanceM <= farThresholdM) return ladder.midPages;
  return ladder.farPages;
}

export function tierIndexForQuality(quality: MaterialQuality): number {
  switch (quality) {
    case "full_debug": return 0;
    case "slope_tint_debug": return 1;
    case "single_projection_far": return 2;
    case "horizon_proxy": return 3;
    case "atlas_only_debug": return 4;
  }
}

export const QUALITY_LABELS: Record<MaterialQuality, string> = {
  full_debug: "Full Debug (near)",
  slope_tint_debug: "Slope Tint Debug",
  single_projection_far: "Single Projection (mid/far)",
  horizon_proxy: "Horizon Proxy (far shell)",
  atlas_only_debug: "Atlas Debug",
};
