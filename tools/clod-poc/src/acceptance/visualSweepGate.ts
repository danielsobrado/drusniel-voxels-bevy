import type { ClodPageNode } from "../types.js";
import type { AcceptanceGateResult, AcceptanceConfig } from "./acceptanceTypes.js";

export interface VisualSweepMetrics {
  visualHolePixelRatio: number;
  visualLipPixelRatio: number;
  scenesChecked: number;
}

export function computeVisualSweep(
  _nodesByLevel: Map<number, ClodPageNode[]>,
): VisualSweepMetrics {
  return {
    visualHolePixelRatio: -1,
    visualLipPixelRatio: -1,
    scenesChecked: 0,
  };
}

export function runGateA1VisualSweep(
  _nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  _fixtureName: string,
): AcceptanceGateResult | null {
  if (!config.visual.enabled) {
    return null;
  }

  const message = "Visual sweep not available in headless mode. Requires Playwright/browser for rendered screenshots.";

  return {
    id: "A1",
    name: "Watertight (visual sweep)",
    status: "warn",
    message,
    measurements: {
      visualHolePixelRatio: -1,
      visualLipPixelRatio: -1,
      visualHolePixelRatioMax: config.thresholds.visualHolePixelRatioMax,
      visualLipPixelRatioMax: config.thresholds.visualLipPixelRatioMax,
      visualSweepAvailable: false,
      visualSweepStatus: "not_available",
    },
    failures: [],
  };
}
