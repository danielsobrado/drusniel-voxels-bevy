import { mkdirSync, writeFileSync } from "node:fs";
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
  runWaterFoamRendererMatrixLeg,
  waterFoamRendererMatrixLegKey,
  type WaterFoamRendererMatrixLegResult,
} from "./water-foam-renderer-matrix-leg.js";
import {
  evaluateWaterFoamQualityParity,
  type WaterFoamQualityParityResult,
} from "./water-foam-quality-parity-contract.js";
import {
  evaluateWaterFoamRendererParity,
  type WaterFoamRendererParityResult,
} from "./water-foam-renderer-parity-contract.js";
import type { WaterFoamAcceptanceRenderer } from "./water-foam-renderer-profile.js";

const RENDERERS: readonly WaterFoamAcceptanceRenderer[] = ["webgpu", "webgl"];

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const seed = stringArg(args, "seed", "1");
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(args, "out", "shots/water/foam-renderer-matrix"));
  mkdirSync(outRoot, { recursive: true });

  const runnerPath = fileURLToPath(new URL("./water-foam-visual-acceptance.ts", import.meta.url));
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const legs: WaterFoamRendererMatrixLegResult[] = [];

  const canonical = runWaterFoamRendererMatrixLeg({
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
      legs.push(runWaterFoamRendererMatrixLeg({
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

  const byKey = new Map(legs.map((leg) => [
    waterFoamRendererMatrixLegKey(leg.renderer, leg.quality),
    leg,
  ]));
  const webGpuQualityParity = evaluateQualityParity(
    byKey.get(waterFoamRendererMatrixLegKey("webgpu", "high")),
    byKey.get(waterFoamRendererMatrixLegKey("webgpu", "low")),
    "WebGPU high/low",
  );
  const webGlQualityParity = evaluateQualityParity(
    byKey.get(waterFoamRendererMatrixLegKey("webgl", "high")),
    byKey.get(waterFoamRendererMatrixLegKey("webgl", "low")),
    "WebGL high/low",
  );
  const rendererParity = Object.fromEntries(WATER_FOAM_ACCEPTANCE_QUALITIES.map((quality) => [
    quality,
    evaluateRendererParity(
      byKey.get(waterFoamRendererMatrixLegKey("webgpu", quality)),
      byKey.get(waterFoamRendererMatrixLegKey("webgl", quality)),
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

function evaluateQualityParity(
  high: WaterFoamRendererMatrixLegResult | undefined,
  low: WaterFoamRendererMatrixLegResult | undefined,
  label: string,
): WaterFoamQualityParityResult {
  if (!high?.passed || !low?.passed || !high.metrics || !low.metrics) {
    return unavailableQualityParity(`${label} passing metrics are unavailable`);
  }
  return evaluateWaterFoamQualityParity(high.metrics, low.metrics);
}

function evaluateRendererParity(
  webGpu: WaterFoamRendererMatrixLegResult | undefined,
  webGl: WaterFoamRendererMatrixLegResult | undefined,
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

function collectFailures(
  legs: readonly WaterFoamRendererMatrixLegResult[],
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

try {
  main();
} catch (error) {
  console.error(message(error));
  process.exitCode = 1;
}
