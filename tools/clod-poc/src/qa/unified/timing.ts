import type { WebQaCheckpoint } from "../qaTypes.js";
import type { QaTimingGate } from "./schema.js";

export type GateStatus = "PASS" | "FAIL" | "ADVISORY_EXCEEDED" | "NOT_APPLICABLE";

export interface TimingGateResult {
  id: string;
  metric: string;
  status: GateStatus;
  observed: number | null;
  max: number;
  failure?: string;
}

export function evaluateTimingGates(checkpoint: WebQaCheckpoint, gates: readonly QaTimingGate[]): TimingGateResult[] {
  return gates.map((gate) => {
    const observed = resolveMetric(checkpoint, gate.metric);
    if (observed === null) {
      return gate.required
        ? { id: gate.id, metric: gate.metric, status: "FAIL", observed: null, max: gate.max, failure: `missing required timing metric ${gate.metric}` }
        : { id: gate.id, metric: gate.metric, status: "NOT_APPLICABLE", observed: null, max: gate.max };
    }
    if (observed <= gate.max) return { id: gate.id, metric: gate.metric, status: "PASS", observed, max: gate.max };
    if (gate.enforcement === "advisory") return { id: gate.id, metric: gate.metric, status: "ADVISORY_EXCEEDED", observed, max: gate.max };
    return { id: gate.id, metric: gate.metric, status: "FAIL", observed, max: gate.max, failure: `${gate.metric} ${observed} > ${gate.max}` };
  });
}

export function resolveMetric(checkpoint: WebQaCheckpoint, key: string): number | null {
  if (key === "frame_ms_p50") return finite(checkpoint.median_frame_ms);
  if (key === "frame_ms_p95") return finite(checkpoint.p95_frame_ms);
  if (key === "frame_ms_p99") return finite(checkpoint.p99_frame_ms);
  if (!key.startsWith("areas.")) return null;
  const rest = key.slice("areas.".length);
  const separator = rest.indexOf(".");
  if (separator <= 0) return null;
  const area = rest.slice(0, separator);
  const field = rest.slice(separator + 1);
  return finite(checkpoint.areas?.[area]?.[field]);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
