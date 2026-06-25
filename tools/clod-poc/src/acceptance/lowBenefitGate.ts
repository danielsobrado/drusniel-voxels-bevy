import type { ClodPageNode } from "../types.js";
import type { AcceptanceGateResult, AcceptanceConfig, AcceptanceFailure } from "./acceptanceTypes.js";

export interface LowBenefitMetrics {
  lowBenefitRateLevel1: number;
  lowBenefitRateLevel2: number;
  lowBenefitRateLevel3: number;
  overallLowBenefitRate: number;
  totalNodes: number;
  lowBenefitNodes: number;
}

export function computeLowBenefitRates(
  nodesByLevel: Map<number, ClodPageNode[]>,
): LowBenefitMetrics {
  let lowBenefitRateLevel1 = 0;
  let lowBenefitRateLevel2 = 0;
  let lowBenefitRateLevel3 = 0;
  let totalNodes = 0;
  let lowBenefitNodes = 0;

  for (const [level, nodes] of nodesByLevel) {
    const lbCount = nodes.filter((n) => n.lowBenefit).length;
    if (level === 1) lowBenefitRateLevel1 = nodes.length > 0 ? lbCount / nodes.length : 0;
    else if (level === 2) lowBenefitRateLevel2 = nodes.length > 0 ? lbCount / nodes.length : 0;
    else if (level === 3) lowBenefitRateLevel3 = nodes.length > 0 ? lbCount / nodes.length : 0;
    totalNodes += nodes.length;
    lowBenefitNodes += lbCount;
  }

  return {
    lowBenefitRateLevel1,
    lowBenefitRateLevel2,
    lowBenefitRateLevel3,
    overallLowBenefitRate: totalNodes > 0 ? lowBenefitNodes / totalNodes : 0,
    totalNodes,
    lowBenefitNodes,
  };
}

export function runGateA6(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  _fixtureName: string,
): AcceptanceGateResult {
  const metrics = computeLowBenefitRates(nodesByLevel);
  const threshold = config.thresholds.lowBenefitRateMax;

  const l1Fail = metrics.lowBenefitRateLevel1 >= threshold;
  const l2Fail = metrics.lowBenefitRateLevel2 >= threshold;
  const l3High = metrics.lowBenefitRateLevel3 >= threshold;

  const failures: AcceptanceFailure[] = [];

  if (l1Fail) {
    failures.push({
      code: "LOW_BENEFIT_RATE_L1_EXCEEDED",
      message: `Level 1 low-benefit rate ${(metrics.lowBenefitRateLevel1 * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}%`,
      value: metrics.lowBenefitRateLevel1,
      threshold,
      level: 1,
    });
  }

  if (l2Fail) {
    failures.push({
      code: "LOW_BENEFIT_RATE_L2_EXCEEDED",
      message: `Level 2 low-benefit rate ${(metrics.lowBenefitRateLevel2 * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}%`,
      value: metrics.lowBenefitRateLevel2,
      threshold,
      level: 2,
    });
  }

  let status: "pass" | "warn" | "fail";
  if (l1Fail || l2Fail) {
    status = "fail";
  } else if (l3High) {
    status = "warn";
  } else {
    status = "pass";
  }

  const message = status === "pass"
    ? `Level 1 ${(metrics.lowBenefitRateLevel1 * 100).toFixed(1)}% / ${(threshold * 100).toFixed(0)}%, Level 2 ${(metrics.lowBenefitRateLevel2 * 100).toFixed(1)}% / ${(threshold * 100).toFixed(0)}%`
    : status === "warn"
      ? `Level 3 high, levels 1-2 ok`
      : `Low-benefit rates exceed maximum`;

  return {
    id: "A6",
    name: "Low-benefit rate",
    status,
    message,
    measurements: {
      lowBenefitRateLevel1: metrics.lowBenefitRateLevel1,
      lowBenefitRateLevel2: metrics.lowBenefitRateLevel2,
      lowBenefitRateLevel3: metrics.lowBenefitRateLevel3,
      overallLowBenefitRate: metrics.overallLowBenefitRate,
      totalNodes: metrics.totalNodes,
      lowBenefitNodes: metrics.lowBenefitNodes,
      lowBenefitRateMax: threshold,
    },
    failures,
  };
}
