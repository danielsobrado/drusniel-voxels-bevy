import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WaterFoamAcceptanceQuality } from "./water-foam-acceptance-profile.js";
import {
  assertWaterFoamAcceptancePosesMatch,
  extractWaterFoamAcceptancePoses,
  type WaterFoamAcceptancePoses,
} from "./water-foam-pose-parity.js";
import type { WaterFoamAcceptanceRenderer } from "./water-foam-renderer-profile.js";
import { extractWaterFoamAcceptanceMetrics } from "./water-foam-report-metrics.js";
import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

export interface WaterFoamRendererMatrixLegResult {
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

export interface WaterFoamRendererMatrixLegOptions {
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

export function runWaterFoamRendererMatrixLeg(
  options: WaterFoamRendererMatrixLegOptions,
): WaterFoamRendererMatrixLegResult {
  const output = join(options.outRoot, options.renderer, options.quality);
  const reportPath = join(output, "report.json");
  mkdirSync(output, { recursive: true });
  rmSync(reportPath, { force: true });
  const failures: string[] = [];

  if (!isCanonicalLeg(options) && (!options.canonicalReportPath || !options.canonicalPoses)) {
    return failedLeg(options, reportPath, ["canonical WebGPU-high pose report is unavailable"]);
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
    return failedLeg(options, reportPath, failures, child.status);
  }

  const parsed = parseReport(reportPath, failures);
  if (!parsed) return failedLeg(options, reportPath, failures, child.status, true);
  validateReportIdentity(parsed, options, failures);
  if (parsed.acceptance?.passed !== true) failures.push(...reportFailures(parsed.acceptance?.failures));

  const metrics = parseMetrics(parsed, failures);
  const poses = parsePoses(parsed, failures);
  const poseParity = validatePoseParity(options.canonicalPoses, poses, failures);

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

export function waterFoamRendererMatrixLegKey(
  renderer: WaterFoamAcceptanceRenderer,
  quality: WaterFoamAcceptanceQuality,
): string {
  return `${renderer}/${quality}`;
}

function isCanonicalLeg(options: WaterFoamRendererMatrixLegOptions): boolean {
  return options.renderer === "webgpu" && options.quality === "high";
}

function parseReport(reportPath: string, failures: string[]): ParsedReport | null {
  try {
    const value = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("foam acceptance report root must be an object");
    }
    return value as ParsedReport;
  } catch (error) {
    failures.push(`could not parse acceptance report: ${message(error)}`);
    return null;
  }
}

function validateReportIdentity(
  report: ParsedReport,
  options: WaterFoamRendererMatrixLegOptions,
  failures: string[],
): void {
  if (report.quality !== options.quality) {
    failures.push(`report quality ${String(report.quality)} did not equal ${options.quality}`);
  }
  if (report.renderer?.requested !== options.renderer) {
    failures.push(`requested renderer ${String(report.renderer?.requested)} did not equal ${options.renderer}`);
  }
  if (report.renderer?.actual !== options.renderer) {
    failures.push(`actual renderer ${String(report.renderer?.actual)} did not equal ${options.renderer}`);
  }
}

function parseMetrics(report: ParsedReport, failures: string[]): FoamVisualAcceptanceInput | null {
  try {
    return extractWaterFoamAcceptanceMetrics(report);
  } catch (error) {
    failures.push(message(error));
    return null;
  }
}

function parsePoses(report: ParsedReport, failures: string[]): WaterFoamAcceptancePoses | null {
  try {
    return extractWaterFoamAcceptancePoses(report);
  } catch (error) {
    failures.push(message(error));
    return null;
  }
}

function validatePoseParity(
  canonical: WaterFoamAcceptancePoses | null,
  poses: WaterFoamAcceptancePoses | null,
  failures: string[],
): boolean {
  if (canonical === null) return poses !== null;
  if (poses === null) return false;
  try {
    assertWaterFoamAcceptancePosesMatch(canonical, poses);
    return true;
  } catch (error) {
    failures.push(message(error));
    return false;
  }
}

function failedLeg(
  options: WaterFoamRendererMatrixLegOptions,
  reportPath: string,
  failures: readonly string[],
  processStatus: number | null = null,
  reportFound = false,
): WaterFoamRendererMatrixLegResult {
  return {
    renderer: options.renderer,
    quality: options.quality,
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
