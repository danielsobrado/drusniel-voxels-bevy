import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SOFTWARE_ADAPTER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /lavapipe/i,
  /\bwarp\b/i,
  /microsoft basic render/i,
  /software raster/i,
  /software adapter/i,
  /mesa offscreen/i,
] as const;

interface AdapterIdentity {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  source?: string;
}

interface BenchmarkRun {
  kind: "warmup" | "measured";
  scenario: "single" | "dual";
  iteration: number;
  timeToFirstQuietMs: number;
  stabilizedElapsedMs: number;
  pagesRequested: number;
  pagesApplied: number;
  overlapEventsDelta: number;
  snapshot: {
    failedBatches: number;
    fallbackPages: number;
    workerFallbackPages: number;
    streamFailed: number;
    buildMsP95: number;
    readbackMsP95: number;
  };
}

interface BenchmarkSummary {
  schemaVersion: number;
  generatedAt: string;
  adapters: AdapterIdentity[];
  options: { runs: number; minPages: number };
  summary: {
    singleFirstQuietMedianMs: number;
    dualFirstQuietMedianMs: number;
    dualToSingleRatio: number;
    speedup: number;
    singleStabilizedMedianMs: number;
    dualStabilizedMedianMs: number;
    singleBuildMsP95Median: number;
    dualBuildMsP95Median: number;
    singleReadbackMsP95Median: number;
    dualReadbackMsP95Median: number;
  };
  workValidation: { ok: boolean; error?: string | null };
  runs: BenchmarkRun[];
}

interface Options {
  input: string;
  output: string;
  commit: string;
}

function argValue(argv: readonly string[], key: string): string | undefined {
  return argv.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
}

function parseOptions(argv: readonly string[]): Options {
  const input = argValue(argv, "--input");
  const output = argValue(argv, "--out");
  if (!input) throw new Error("--input=<benchmark-summary.json> is required");
  if (!output) throw new Error("--out=<evidence.md> is required");
  return {
    input: resolve(input),
    output: resolve(output),
    commit: argValue(argv, "--commit") ?? process.env["GITHUB_SHA"] ?? "unknown",
  };
}

function adapterText(adapter: AdapterIdentity): string {
  return [adapter.vendor, adapter.architecture, adapter.device, adapter.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function validate(summary: BenchmarkSummary): void {
  if (summary.schemaVersion < 3) throw new Error(`unsupported benchmark schema ${summary.schemaVersion}`);
  if (!summary.workValidation.ok) throw new Error(summary.workValidation.error ?? "benchmark work signatures differ");
  if (summary.adapters.length === 0) throw new Error("benchmark contains no WebGPU adapter identity");
  for (const adapter of summary.adapters) {
    const identity = adapterText(adapter);
    if (!identity) throw new Error("hardware evidence requires a non-empty WebGPU adapter identity");
    if (SOFTWARE_ADAPTER_PATTERNS.some((pattern) => pattern.test(identity))) {
      throw new Error(`software adapter cannot be committed as hardware evidence: ${identity}`);
    }
  }

  const measured = summary.runs.filter((run) => run.kind === "measured");
  if (measured.length === 0) throw new Error("benchmark contains no measured runs");
  for (const run of measured) {
    const fatal = run.snapshot.failedBatches
      + run.snapshot.fallbackPages
      + run.snapshot.workerFallbackPages
      + run.snapshot.streamFailed;
    if (fatal !== 0) throw new Error(`${run.scenario}#${run.iteration} contains failures or fallbacks`);
    if (run.pagesRequested < summary.options.minPages || run.pagesApplied !== run.pagesRequested) {
      throw new Error(`${run.scenario}#${run.iteration} did not complete equivalent page work`);
    }
    if (run.scenario === "single" && run.overlapEventsDelta !== 0) {
      throw new Error(`single#${run.iteration} unexpectedly overlapped GPU pools`);
    }
    if (run.scenario === "dual" && run.overlapEventsDelta <= 0) {
      throw new Error(`dual#${run.iteration} did not demonstrate GPU pool overlap`);
    }
  }

  for (const [name, value] of Object.entries(summary.summary)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid summary metric ${name}=${value}`);
  }
}

function formatNumber(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toString();
}

function render(summary: BenchmarkSummary, options: Options): string {
  const adapter = summary.adapters.map(adapterText).join("; ");
  const measured = summary.runs.filter((run) => run.kind === "measured");
  const rows = measured.map((run) => [
    run.scenario,
    run.iteration,
    formatNumber(run.timeToFirstQuietMs),
    formatNumber(run.stabilizedElapsedMs),
    run.pagesApplied,
    run.overlapEventsDelta,
    formatNumber(run.snapshot.buildMsP95),
    formatNumber(run.snapshot.readbackMsP95),
  ]);
  const table = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");

  return `# GPU CLOD Pool Hardware Evidence\n\n`
    + `- Source commit: \`${options.commit}\`\n`
    + `- Captured: ${summary.generatedAt}\n`
    + `- Adapter: ${adapter}\n`
    + `- Measured runs: ${measured.length}\n`
    + `- Minimum pages per run: ${summary.options.minPages}\n`
    + `- Work signatures equivalent: yes\n`
    + `- Failed/fallback pages: 0\n\n`
    + `## Result\n\n`
    + `| Metric | Single pool | Dual pool |\n`
    + `| --- | ---: | ---: |\n`
    + `| First quiet median (ms) | ${formatNumber(summary.summary.singleFirstQuietMedianMs)} | ${formatNumber(summary.summary.dualFirstQuietMedianMs)} |\n`
    + `| Stabilized median (ms) | ${formatNumber(summary.summary.singleStabilizedMedianMs)} | ${formatNumber(summary.summary.dualStabilizedMedianMs)} |\n`
    + `| Build p95 median (ms) | ${formatNumber(summary.summary.singleBuildMsP95Median)} | ${formatNumber(summary.summary.dualBuildMsP95Median)} |\n`
    + `| Readback p95 median (ms) | ${formatNumber(summary.summary.singleReadbackMsP95Median)} | ${formatNumber(summary.summary.dualReadbackMsP95Median)} |\n\n`
    + `Dual/single ratio: **${formatNumber(summary.summary.dualToSingleRatio, 3)}**  \n`
    + `Measured speedup: **${formatNumber(summary.summary.speedup, 3)}×**\n\n`
    + `## Runs\n\n`
    + `| Scenario | Iteration | First quiet ms | Stabilized ms | Pages | Overlap events | Build p95 ms | Readback p95 ms |\n`
    + `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`
    + `${table}\n`;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const summary = JSON.parse(readFileSync(options.input, "utf8")) as BenchmarkSummary;
  validate(summary);
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, render(summary, options), "utf8");
  console.log(`[gpu-clod-evidence] wrote ${options.output}`);
}

try {
  main();
} catch (error) {
  console.error("[gpu-clod-evidence] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
}
