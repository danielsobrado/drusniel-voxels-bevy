import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WATER_FOAM_ACCEPTANCE_QUALITIES,
  type WaterFoamAcceptanceQuality,
} from "./water-foam-acceptance-profile.js";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  stringArg,
} from "./water-harness.js";
import {
  assertWaterFoamAcceptancePosesMatch,
  extractWaterFoamAcceptancePoses,
  type WaterFoamAcceptancePoses,
} from "./water-foam-pose-parity.js";
import {
  evaluateWaterFoamQualityParity,
  type WaterFoamQualityParityResult,
} from "./water-foam-quality-parity-contract.js";
import {
  evaluateWaterFoamRendererParity,
  type WaterFoamRendererParityResult,
} from "./water-foam-renderer-parity-contract.js";
import type { WaterFoamAcceptanceRenderer } from "./water-foam-renderer-profile.js";
import { extractWaterFoamAcceptanceMetrics } from "./water-foam-report-metrics.js";
import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

const RENDERERS: readonly WaterFoamAcceptanceRenderer[] = ["webgpu", "webgl"];

interface LegResult {
  readonly renderer: WaterFoamAcceptanceRenderer;
  readonly quality: WaterFoamAcceptanceQuality;
  readonly reportPath: string;
  readonly processStatus: number | null;
  readonly reportFound: boolean;
  readonly passed: boolean;
  readonly poseParity: boolean;
  readonly failures: readonly string[];
  readonly metrics: FoamVisualAcceptanceInput | null;
  readonly poses: WaterFoamAcceptancePoses | null;
}

interface ParsedReport {
  readonly quality?: unknown;
  readonly renderer?: {
    readonly requested?: unknown;
    readonly actual?: unknown;
  };
  readonly acceptance?: {
    readonly passed?: unknown;
    readonly failures?: unknown;
  };
  readonly [key: string]: unknown;
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const seed = stringArg(args, "seed", "1");
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(args, "out", "shots/water/foam-renderer-matrix"));
  mkdirSync(outRoot, { recursive: true });

  const runnerPath = fileURLToPath(new URL("./water-foam-visual-acceptance.ts", import.meta.url));
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const legs: LegResult[] = [];

  const canonical = runLeg({
    renderer: "webgpu",
    quality: "high",
    seed,
    world,
    sourceUrl,
    outRoot,
    runnerPath,
    tsxCli,
    canonicalReportPath: null,
    canonicalPoses: null,
  });
  legs.push(canonical);
  const canonicalReportPath = canonical.poses ? canonical.reportPath : null;
  const canonicalPoses = canonical.poses;

  for (const renderer of RENDERERS) {
    for (const quality of WATER_FOAM_ACCEPTANCE_QUALITIES) {
      if (renderer === "webgpu" && quality === "high") continue;
      legs.push(runLeg({
        renderer,
        quality,
        seed,
        world,
        sourceUrl,
        outRoot,
        runnerPath,
        tsxCli,
        canonicalReportPath,
        canonicalPoses,
      }));
    }
  }

  const byKey = new Map(legs.map((leg) => [legKey(leg.renderer, leg.quality), leg]));
  const webGpuQualityParity = evaluateQualityParity(
    byKey.get(legKey("webgpu", "high")),
    byKey.get(legKey("webgpu", "low")),
    "WebGPU high/low",
  );
  const webGlQualityParity = evaluateQualityParity(
    byKey.get(legKey("webgl", "high")),
    byKey.get(legKey("webgl", "low")),
    "WebGL high/low",
  );
  const rendererParity = Object.fromEntries(WATER_FOAM_ACCEPTANCE_QUALITIES.map((quality) => [
    quality,
    evaluateRendererParity(
      byKey.get(legKey("webgpu", quality)),
      byKey.get(legKey("webgl", quality)),
      `${quality} WebGL/WebGPU`,
    ),
  ])) as Record<WaterFoamAcceptanceQuality, WaterFoamRendererParityResult>;

  const passed = legs.every((leg) => leg.passed)
    && webGpuQualityParity.passed
    && webGlQualityParity.passed
    && Object.values(rendererParity).every((result) => result.passed);
  const report = {
    schemaVersion: 1 as const,
    seed,
    world,
    canonicalPoseReport: canonicalReportPath,
    legs: legs.map(({ metrics: _metrics, poses: _poses, ...leg }) => leg),
    qualityParity: {
      webgpu: webGpuQualityParity,
      webgl: webGlQualityParity,
    },
    rendererParity,
    passed,
  };
  const reportPath = join(outRoot, "renderer-matrix-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`foam renderer matrix report: ${reportPath}`);

  if (!passed) {
    throw new Error(`water foam renderer matrix failed:\n- ${collectFailures(
      legs,
      webGpuQualityParity,
      webGlQualityParity,
      rendererParity,
    ).join("\n- ")}`);
  }
}

function runLeg(options: {
  readonly renderer: WaterFoamAcceptanceRenderer;
  readonly quality: WaterFoamAcceptanceQuality;
  readonly seed: string;
  readonly world: number;
  readonly sourceUrl?: string;
  readonly outRoot: string;
  readonly runnerPath: string;
  readonly tsxCli: string;
  readonly canonicalReportPath: string | null;
  readonly canonicalPoses: WaterFoamAcceptancePoses | null;
}): LegResult {
  const output = join(options.outRoot, options.renderer, options.quality);
  const reportPath = join(output, "report.json");
  mkdirSync(output, { recursive: true });
  rmSync(reportPath, { force: true });
  const failures: string[] = [];

  if (options.renderer !== "webgpu" || options.quality !== "high") {
    if (!options.canonicalReportPath || !options.canonicalPoses) {
      return failedLeg(options.renderer, options.quality, reportPath, [
        "canonical WebGPU-high pose report is unavailable",
      ]);
    }
  }

  const childArgs = [
    options.tsxCli,
    options.runnerPath,
    `--renderer=${options.renderer}`,
    `--quality=${options.quality}`,
    `--seed=${options.seed}`,
    `--world=${options.world}`,
    `--out=${output}`,
  ];
  if (options.sourceUrl) childArgs.push(`--url=${options.sourceUrl}`);
  if (options.canonicalReportPath) childArgs.push(`--pose-report=${options.canonicalReportPath}`);

  const child = spawnSync(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (child.error) failures.push(child.error.message);
  if (child.status !== 0) failures.push(`acceptance process exited with status ${String(child.status)}`);
  if (!existsSync(reportPath)) {
    failures.push(`acceptance report was not written: ${reportPath}`);
    return failedLeg(options.renderer, options.quality, reportPath, failures, child.status);
  }

  let parsed: ParsedReport;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8")) as ParsedReport;
  } catch (error) {
    failures.push(`could not parse acceptance report: ${message(error)}`);
    return failedLeg(options.renderer, options.quality, reportPath, failures, child.status, true);
  }
  if (parsed.quality !== options.quality) {
    failures.push(`report quality ${String(parsed.quality)} did not equal ${options.quality}`);
  }
  if (parsed.renderer?.requested !== options.renderer) {
    failures.push(`requested renderer ${String(parsed.renderer?.requested)} did not equal ${options.renderer}`);
  }
  if (parsed.renderer?.actual !== options.renderer) {
    failures.push(`actual renderer ${String(parsed.renderer?.actual)} did not equal ${options.renderer}`);
  }
  if (parsed.acceptance?.passed !== true) failures.push(...reportFailures(parsed.acceptance?.failures));

  let metrics: FoamVisualAcceptanceInput | null = null;
  let poses: WaterFoamAcceptancePoses | null = null;
  try {
    metrics = extractWaterFoamAcceptanceMetrics(parsed);
  } catch (error) {
    failures.push(message(error));
  }
  try {
    poses = extractWaterFoamAcceptancePoses(parsed);
  } catch (error) {
    failures.push(message(error));
  }

  let poseParity = options.canonicalPoses === null;
  if (options.canonicalPoses && poses) {
    try {
      assertWaterFoamAcceptancePosesMatch(options.canonicalPoses, poses);
      poseParity = true;
    } catch (error) {
      failures.push(message(error));
    }
  }

  return {
    renderer: options.renderer,
    quality: options.quality,
    reportPath,
    processStatus: child.status,
    reportFound: true,
    passed: failures.length === 0 && metrics !== null && poses !== null && poseParity,
    poseParity,
    failures,
    metrics,
    poses,
  };
}

function evaluateQualityParity(
  high: LegResult | undefined,
  low: LegResult | undefined,
  label: string,
): WaterFoamQualityParityResult {
  if (!high?.passed || !low?.passed || !high.metrics || !low.metrics) {
    return unavailableQualityParity(`${label} passing metrics are unavailable`);
  }
  return evaluateWaterFoamQualityParity(high.metrics, low.metrics);
}

function evaluateRendererParity(
  webGpu: LegResult | undefined,
  webGl: LegResult | undefined,
  label: string,
): WaterFoamRendererParityResult {
  if (!webGpu?.passed || !webGl?.passed || !webGpu.metrics || !webGl.metrics) {
    return unavailableRendererParity(`${label} passing metrics are unavailable`);
  }
  return evaluateWaterFoamRendererParity(webGpu.metrics, webGl.metrics);
}

function unavailableQualityParity(failure: string): WaterFoamQualityParityResult {
  return { passed: false, failures: [failure], measurements: {} };
}

function unavailableRendererParity(failure: string): WaterFoamRendererParityResult {
  return { passed: false, failures: [failure], measurements: {} };
}

function failedLeg(
  renderer: WaterFoamAcceptanceRenderer,
  quality: WaterFoamAcceptanceQuality,
  reportPath: string,
  failures: readonly string[],
  processStatus: number | null = null,
  reportFound = false,
): LegResult {
  return {
    renderer,
    quality,
    reportPath,
    processStatus,
    reportFound,
    passed: false,
    poseParity: false,
    failures,
    metrics: null,
    poses: null,
  };
}

function reportFailures(value: unknown): string[] {
  if (!Array.isArray(value)) return ["acceptance report did not pass"];
  const failures = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return failures.length > 0 ? failures : ["acceptance report did not pass"];
}

function collectFailures(
  legs: readonly LegResult[],
  webGpuQualityParity: WaterFoamQualityParityResult,
  webGlQualityParity: WaterFoamQualityParityResult,
  rendererParity: Readonly<Record<WaterFoamAcceptanceQuality, WaterFoamRendererParityResult>>,
): string[] {
  return [
    ...legs.flatMap((leg) => leg.failures.map((failure) => `${leg.renderer}/${leg.quality}: ${failure}`)),
    ...webGpuQualityParity.failures.map((failure) => `WebGPU quality: ${failure}`),
    ...webGlQualityParity.failures.map((failure) => `WebGL quality: ${failure}`),
    ...WATER_FOAM_ACCEPTANCE_QUALITIES.flatMap((quality) =>
      rendererParity[quality].failures.map((failure) => `${quality} renderer parity: ${failure}`),
    ),
  ];
}

function legKey(renderer: WaterFoamAcceptanceRenderer, quality: WaterFoamAcceptanceQuality): string {
  return `${renderer}/${quality}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

try {
  main();
} catch (error) {
  console.error(message(error));
  process.exitCode = 1;
}
