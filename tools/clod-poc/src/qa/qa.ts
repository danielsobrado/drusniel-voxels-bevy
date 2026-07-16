import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "./qaConfig.js";
import { evaluateCheck, evaluateProbe, evaluateTiming, metricValue } from "./qaEvaluation.js";
import type { WebQaSummary } from "./qaTypes.js";
import { runUnifiedQa } from "./unified/runner.js";

export * from "./qaTypes.js";
export * from "./qaConfig.js";
export * from "./qaEvaluation.js";
export * from "./qaReportWriter.js";
export * from "./qaRunner.js";
export * from "./unified/schema.js";
export * from "./unified/manifest.js";
export * from "./unified/runner.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = resolve(args.summary);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as WebQaSummary;
  const outputDir = resolve(args.output ?? "../../validation-runs/latest");
  const report = await runUnifiedQa({
    manifests: {
      visual: resolve(args.visual),
      performance: resolve(args.performance),
      legacyMap: resolve(args.legacyMap),
    },
    summary,
    summaryPath,
    outputDir,
    tags: args.tags,
    sceneIds: args.scenes,
    actualRoot: args.actualRoot ? resolve(args.actualRoot) : undefined,
  });
  console.log(`[QA] overall_status=${report.status}`);
  if (report.status === "FAIL" || report.status === "ERROR") process.exitCode = 1;
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
