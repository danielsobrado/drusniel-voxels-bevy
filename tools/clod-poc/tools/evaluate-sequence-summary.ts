import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SequenceSummaryGateResult {
  path: string;
  passed: boolean;
  violations: string[];
}

const REQUIRED_KEYS = [
  "schemaVersion",
  "id",
  "mode",
  "frameCount",
  "passed",
  "gateViolations",
] as const;

export function evaluateSequenceSummary(path: string): SequenceSummaryGateResult {
  const summary = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const violations: string[] = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in summary)) violations.push(`missing required key ${key}`);
  }
  if (summary.schemaVersion !== 1) violations.push(`schemaVersion ${String(summary.schemaVersion)} !== 1`);
  if (typeof summary.frameCount !== "number" || summary.frameCount < 2) {
    violations.push(`frameCount must be >= 2`);
  }
  if (!Array.isArray(summary.gateViolations)) violations.push("gateViolations must be an array");
  if (summary.passed !== true) {
    const gateViolations = Array.isArray(summary.gateViolations) ? summary.gateViolations.map(String) : [];
    violations.push(`summary.passed is not true${gateViolations.length ? `: ${gateViolations.join("; ")}` : ""}`);
  }
  return { path, passed: violations.length === 0, violations };
}

function parseArgs(argv: readonly string[]): { summary: string } {
  let summary: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--summary" && argv[index + 1]) summary = argv[++index];
    else if (arg?.startsWith("--summary=")) summary = arg.slice("--summary=".length);
  }
  if (!summary) throw new Error("--summary is required");
  return { summary: resolve(summary) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluateSequenceSummary(args.summary);
  console.log(`[sequence:evaluate] ${result.path} passed=${result.passed}`);
  if (!result.passed) {
    for (const violation of result.violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
