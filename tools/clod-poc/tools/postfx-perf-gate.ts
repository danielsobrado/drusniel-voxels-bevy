import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluatePostFxPerfGate,
  parsePostFxPerfGateConfig,
  type PostFxPerfSummary,
} from "../src/gpu/postfx_perf_gate.js";

interface Args {
  summary: string;
  config: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--summary" && argv[i + 1]) args.summary = argv[++i];
    else if (argv[i] === "--config" && argv[i + 1]) args.config = argv[++i];
  }
  if (!args.summary) throw new Error("Missing --summary path");
  return {
    summary: args.summary,
    config: args.config ?? "src/environment/config/postfx_perf_gate.yaml",
  };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "Infinity";
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const summary = JSON.parse(readFileSync(resolve(args.summary), "utf8")) as PostFxPerfSummary;
  const config = parsePostFxPerfGateConfig(readFileSync(resolve(args.config), "utf8"));
  const result = evaluatePostFxPerfGate(summary, config);

  if (!result.enabled) {
    console.log("[postfx-perf-gate] disabled");
    return;
  }

  console.log(`[postfx-perf-gate] baseline ${result.baselineCase}`);
  for (const row of result.rows) {
    console.log(
      `[postfx-perf-gate] ${row.caseName} ` +
        `frameP50 +${fmt(row.frameP50DeltaMs)}/${row.thresholds.maxFrameP50DeltaMs} ` +
        `frameP95 +${fmt(row.frameP95DeltaMs)}/${row.thresholds.maxFrameP95DeltaMs} ` +
        `renderP95 +${fmt(row.renderP95DeltaMs)}/${row.thresholds.maxRenderP95DeltaMs}`,
    );
  }

  if (result.failures.length === 0) {
    console.log("[postfx-perf-gate] PASS");
    return;
  }

  for (const item of result.failures) {
    console.error(`[postfx-perf-gate] LIMIT ${item.caseName} ${item.metric} +${fmt(item.deltaMs)} > ${item.thresholdMs}`);
  }
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error("[postfx-perf-gate] ERROR", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
