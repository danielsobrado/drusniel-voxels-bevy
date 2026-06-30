import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import {
  buildTreeParityCaptureCommands,
  buildTreeParityEvidenceMarkdownReport,
  validateTreeParityEvidence,
  validateTreeParityManifestCaptureConfig,
  type TreeParityCaptureCommandOptions,
  type TreeParityEvidenceInput,
  type TreeParityEvidenceManifest,
} from "../src/trees/tree_parity_evidence.js";

type Args = Record<string, string | boolean>;

const DEFAULT_CONFIG = "config/tree-parity-evidence.yaml";
const DEFAULT_REPORT = "docs/performance/clod-poc-tree-parity-evidence-latest.md";

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function stringArg(args: Args, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function numberArg(args: Args, key: string): number | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(stringArg(args, "root", process.cwd()));
  const configPath = resolve(root, stringArg(args, "config", DEFAULT_CONFIG));
  const manifest = yaml.load(readFileSync(configPath, "utf8")) as TreeParityEvidenceManifest;

  if (args["check-manifest"] === true) {
    checkManifest(manifest);
    return;
  }

  if (args["commands"] === true) {
    printCaptureCommands(manifest, captureCommandOptions(args));
    return;
  }

  const input = treeParityEvidenceInput(root, manifest);
  const reportArg = args["report"];
  if (reportArg !== undefined) {
    const reportPath = resolve(root, typeof reportArg === "string" ? reportArg : DEFAULT_REPORT);
    writeReport(reportPath, input);
  }

  const result = validateTreeParityEvidence(input);
  if (result.ok) {
    console.log(`[tree-evidence] PASS ${manifest.captures.length} captures`);
    return;
  }

  console.error(`[tree-evidence] FAIL ${result.failures.length} issues`);
  for (const failure of result.failures) {
    console.error(`- ${failure.captureId}: ${failure.message}`);
  }
  process.exit(1);
}

function checkManifest(manifest: TreeParityEvidenceManifest): void {
  const failures = validateTreeParityManifestCaptureConfig(manifest);
  if (failures.length === 0) {
    console.log(`[tree-evidence] manifest PASS ${manifest.captures.length} captures`);
    return;
  }
  console.error(`[tree-evidence] manifest FAIL ${failures.length} issues`);
  for (const failure of failures) console.error(`- ${failure.captureId}: ${failure.message}`);
  process.exit(1);
}

function treeParityEvidenceInput(root: string, manifest: TreeParityEvidenceManifest): TreeParityEvidenceInput {
  return {
    manifest,
    fileInfo: (path) => {
      const resolved = resolve(root, path);
      if (!existsSync(resolved)) return { exists: false, sizeBytes: 0 };
      return { exists: true, sizeBytes: statSync(resolved).size };
    },
    readJson: (path) => JSON.parse(readFileSync(resolve(root, path), "utf8")),
  };
}

function writeReport(reportPath: string, input: TreeParityEvidenceInput): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, buildTreeParityEvidenceMarkdownReport(input), "utf8");
  console.log(`[tree-evidence] wrote ${reportPath}`);
}

function captureCommandOptions(args: Args): TreeParityCaptureCommandOptions {
  return {
    baseUrl: stringArg(args, "baseUrl", "http://127.0.0.1:5180/"),
    renderer: stringArg(args, "renderer", "webgpu") === "webgl" ? "webgl" : "webgpu",
    world: numberArg(args, "world"),
    width: numberArg(args, "w"),
    height: numberArg(args, "h"),
    settleFrames: numberArg(args, "settle"),
    warmupFrames: numberArg(args, "warmup"),
    sampleFrames: numberArg(args, "frames"),
    timeoutMs: numberArg(args, "timeout"),
  };
}

function printCaptureCommands(manifest: TreeParityEvidenceManifest, options: TreeParityCaptureCommandOptions): void {
  for (const command of buildTreeParityCaptureCommands(manifest, options)) {
    console.log(`# ${command.captureId}`);
    if (command.screenshotCommand) console.log(command.screenshotCommand);
    if (command.perfCommand) console.log(command.perfCommand);
    console.log("");
  }
  console.log("npm --prefix tools/clod-poc run trees:verify-parity-evidence -- --report");
}

main();
