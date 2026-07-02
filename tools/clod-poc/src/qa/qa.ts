import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadQaConfig, parseArgs } from "./qaConfig.js";
import { evaluateCheck, evaluateProbe, evaluateTiming, metricValue } from "./qaEvaluation.js";
import { runQa } from "./qaRunner.js";
import type { WebQaSummary } from "./qaTypes.js";

export * from "./qaTypes.js";
export * from "./qaConfig.js";
export * from "./qaEvaluation.js";
export * from "./qaReportWriter.js";
export * from "./qaRunner.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config);
  const summaryPath = resolve(args.summary);
  const config = loadQaConfig(configPath);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as WebQaSummary;
  const outputDir = resolve(args.output ?? `${config.output_root ?? "qa-runs"}/latest`);
  const report = runQa(config, summary, args.summary, outputDir);
  console.log(`[QA] overall_status=${report.overall_status}`);
  if (report.overall_status === "fail") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error("[QA] error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export const testOnly = {
  evaluateProbe,
  evaluateTiming,
  evaluateCheck,
  metricValue,
};
