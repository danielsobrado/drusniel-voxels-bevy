import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  stringArg,
} from "./water-harness.js";
import { WATER_FOAM_ACCEPTANCE_QUALITIES } from "./water-foam-acceptance-profile.js";
import {
  assertWaterFoamAcceptancePosesMatch,
  extractWaterFoamAcceptancePoses,
  type WaterFoamAcceptancePoses,
} from "./water-foam-pose-parity.js";

interface TierReport {
  readonly quality: string;
  readonly reportPath: string;
  readonly passed: boolean;
  readonly poseParity: boolean;
  readonly failures: readonly string[];
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const seed = stringArg(args, "seed", "1");
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(args, "out", "shots/water/foam-acceptance"));
  const runnerPath = fileURLToPath(new URL("./water-foam-visual-acceptance.ts", import.meta.url));
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const reports: TierReport[] = [];
  let canonicalReportPath: string | null = null;
  let canonicalPoses: WaterFoamAcceptancePoses | null = null;

  for (const quality of WATER_FOAM_ACCEPTANCE_QUALITIES) {
    const tierOut = join(outRoot, quality);
    const childArgs = [
      tsxCli,
      runnerPath,
      `--quality=${quality}`,
      `--seed=${seed}`,
      `--world=${world}`,
      `--out=${tierOut}`,
    ];
    if (sourceUrl) childArgs.push(`--url=${sourceUrl}`);
    if (canonicalReportPath) childArgs.push(`--pose-report=${canonicalReportPath}`);

    const result = spawnSync(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;

    const reportPath = join(tierOut, "report.json");
    if (!existsSync(reportPath)) {
      throw new Error(`foam acceptance ${quality} did not write ${reportPath}`);
    }
    const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
      acceptance?: { passed?: boolean; failures?: unknown };
      [key: string]: unknown;
    };
    const poses = extractWaterFoamAcceptancePoses(parsed);
    let poseParity = true;
    if (!canonicalPoses) {
      canonicalPoses = poses;
      canonicalReportPath = reportPath;
    } else {
      try {
        assertWaterFoamAcceptancePosesMatch(canonicalPoses, poses);
      } catch (error) {
        poseParity = false;
        const message = error instanceof Error ? error.message : String(error);
        const existing = Array.isArray(parsed.acceptance?.failures)
          ? parsed.acceptance.failures.filter((entry): entry is string => typeof entry === "string")
          : [];
        parsed.acceptance = {
          passed: false,
          failures: [...existing, message],
        };
      }
    }

    const failures = Array.isArray(parsed.acceptance?.failures)
      ? parsed.acceptance.failures.filter((entry): entry is string => typeof entry === "string")
      : [];
    const passed = result.status === 0 && parsed.acceptance?.passed === true && poseParity;
    reports.push({ quality, reportPath, passed, poseParity, failures });
  }

  const passed = reports.every((report) => report.passed && report.poseParity);
  const matrixReport = {
    schemaVersion: 2,
    seed,
    world,
    canonicalPoseReport: canonicalReportPath,
    passed,
    tiers: reports,
  };
  const matrixPath = join(outRoot, "matrix-report.json");
  writeFileSync(matrixPath, `${JSON.stringify(matrixReport, null, 2)}\n`);
  console.log(`foam quality matrix report: ${matrixPath}`);

  if (!passed) {
    const failures = reports
      .filter((report) => !report.passed)
      .flatMap((report) => report.failures.length > 0
        ? report.failures.map((failure) => `${report.quality}: ${failure}`)
        : [`${report.quality}: acceptance process failed`]);
    throw new Error(`water foam quality matrix failed:\n- ${failures.join("\n- ")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
