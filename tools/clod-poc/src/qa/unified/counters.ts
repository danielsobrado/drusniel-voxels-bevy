import type { WebQaCheckpoint } from "../qaTypes.js";
import type { QaCounterGate, QaInformationalMetric } from "./schema.js";
import { resolveMetric, type GateStatus } from "./timing.js";

export interface CounterGateResult {
  id: string;
  key: string;
  status: GateStatus;
  observed: number | null;
  expected: string;
  failure?: string;
}

export interface InformationalMetricResult {
  id: string;
  key: string;
  status: "VALUE" | "NOT_APPLICABLE";
  observed: number | null;
}

export function evaluateCounterGates(checkpoint: WebQaCheckpoint, gates: readonly QaCounterGate[]): CounterGateResult[] {
  return gates.map((gate) => {
    const observed = resolveMetric(checkpoint, gate.key);
    const expected = expectation(gate);
    if (observed === null) {
      return gate.required
        ? { id: gate.id, key: gate.key, status: "FAIL", observed: null, expected, failure: `missing required counter ${gate.key}` }
        : { id: gate.id, key: gate.key, status: "NOT_APPLICABLE", observed: null, expected };
    }
    const pass = matches(gate, observed);
    return pass
      ? { id: gate.id, key: gate.key, status: "PASS", observed, expected }
      : { id: gate.id, key: gate.key, status: "FAIL", observed, expected, failure: `${gate.key}=${observed} expected ${expected}` };
  });
}

export function readInformationalMetrics(checkpoint: WebQaCheckpoint, metrics: readonly QaInformationalMetric[]): InformationalMetricResult[] {
  return metrics.map((metric) => {
    const observed = resolveMetric(checkpoint, metric.key);
    return observed === null
      ? { id: metric.id, key: metric.key, status: "NOT_APPLICABLE", observed: null }
      : { id: metric.id, key: metric.key, status: "VALUE", observed };
  });
}

function matches(gate: QaCounterGate, observed: number): boolean {
  if (gate.operator === "between") return observed >= (gate.range?.[0] ?? Number.NEGATIVE_INFINITY) && observed <= (gate.range?.[1] ?? Number.POSITIVE_INFINITY);
  const value = gate.value ?? 0;
  if (gate.operator === "equals") return observed === value;
  if (gate.operator === "min") return observed >= value;
  return observed <= value;
}
function expectation(gate: QaCounterGate): string {
  if (gate.operator === "between") return `between ${gate.range?.[0]} and ${gate.range?.[1]}`;
  return `${gate.operator} ${gate.value}`;
}
