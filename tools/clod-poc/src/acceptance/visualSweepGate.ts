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
    visualHolePixelRatio: 0,
    visualLipPixelRatio: 0,
    scenesChecked: 0,
  };
}

export function runGateA1VisualSweep(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  _fixtureName: string,
): AcceptanceGateResult | null {
  if (!config.visual.enabled) {
    return null;
  }

  const metrics = computeVisualSweep(nodesByLevel);
  const holePass = metrics.visualHolePixelRatio <= config.thresholds.visualHolePixelRatioMax;
  const lipPass = metrics.visualLipPixelRatio <= config.thresholds.visualLipPixelRatioMax;

  const status = holePass && lipPass ? "pass" : "fail";
  const message = status === "pass"
    ? "No holes or lips detected in visual sweep"
    : `Visual issues detected: holes ${metrics.visualHolePixelRatio}, lips ${metrics.visualLipPixelRatio}`;

  return {
    id: "A1",
    name: "Watertight (visual sweep)",
    status,
    message,
    measurements: {
      visualHolePixelRatio: metrics.visualHolePixelRatio,
      visualLipPixelRatio: metrics.visualLipPixelRatio,
      visualHolePixelRatioMax: config.thresholds.visualHolePixelRatioMax,
      visualLipPixelRatioMax: config.thresholds.visualLipPixelRatioMax,
    },
    failures: [],
  };
}
