import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

const METRIC_GROUPS = [
  "rapid",
  "smoothRiver",
  "lakeShore",
  "rapidTemporal",
  "rapidLighting",
] as const;

export function extractWaterFoamAcceptanceMetrics(report: unknown): FoamVisualAcceptanceInput {
  const root = record(report, "foam acceptance report");
  const metrics = record(root.metrics, "foam acceptance metrics");
  for (const group of METRIC_GROUPS) record(metrics[group], `foam acceptance metrics.${group}`);
  return metrics as unknown as FoamVisualAcceptanceInput;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
