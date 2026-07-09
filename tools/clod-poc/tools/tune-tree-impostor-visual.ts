import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

interface SweepConfig {
  output_dir: string;
  report: string;
  cases: SweepCase[];
}

interface SweepCase {
  name: string;
  scene?: string;
  target?: [number, number, number];
  radius?: number;
  height?: number;
  samples?: number;
  settle?: number;
  fov?: number;
  thresholds?: Record<string, number>;
  params?: Record<string, string | number | boolean>;
}

interface CaseResult {
  name: string;
  status: "pass" | "fail";
  reportPath: string;
  error?: string;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config/tree_impostor_visual_sweep.yaml");
const VISUAL_GATE_SCRIPT = join(PACKAGE_ROOT, "tools/verify-tree-impostor-visual.ts");

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
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

function loadConfig(path: string): SweepConfig {
  const parsed = yaml.load(readFileSync(path, "utf8")) as SweepConfig;
  if (!parsed || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Invalid tree impostor sweep config: ${path}`);
  }
  return parsed;
}

function caseArgs(config: SweepConfig, testCase: SweepCase): string[] {
  const outDir = join(config.output_dir, testCase.name);
  const reportPath = join(outDir, "report.json");
  const args = [
    VISUAL_GATE_SCRIPT,
    "--out", outDir,
    "--report", reportPath,
  ];
  pushOptional(args, "scene", testCase.scene);
  pushOptional(args, "target", testCase.target?.join(","));
  pushOptional(args, "radius", testCase.radius);
  pushOptional(args, "height", testCase.height);
  pushOptional(args, "samples", testCase.samples);
  pushOptional(args, "settle", testCase.settle);
  pushOptional(args, "fov", testCase.fov);
  for (const [key, value] of Object.entries(testCase.thresholds ?? {})) pushOptional(args, key, value);
  for (const [key, value] of Object.entries(testCase.params ?? {})) pushOptional(args, key, value);
  return args;
}

function pushOptional(args: string[], key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) return;
  args.push(`--${key}`, String(value));
}

async function runCase(config: SweepConfig, testCase: SweepCase): Promise<CaseResult> {
  const reportPath = join(config.output_dir, testCase.name, "report.json");
  const args = caseArgs(config, testCase);
  console.log(`[tree-impostor-sweep] running ${testCase.name}`);
  const code = await spawnNode(args);
  return {
    name: testCase.name,
    status: code === 0 ? "pass" : "fail",
    reportPath,
    ...(code === 0 ? {} : { error: `visual gate exited with ${code}` }),
  };
}

function spawnNode(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      cwd: PACKAGE_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = typeof args.config === "string" ? args.config : DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);
  mkdirSync(config.output_dir, { recursive: true });
  const results: CaseResult[] = [];
  for (const testCase of config.cases) {
    results.push(await runCase(config, testCase));
  }
  const status = results.every((result) => result.status === "pass") ? "pass" : "fail";
  const report = { status, configPath, results };
  mkdirSync(dirname(config.report), { recursive: true });
  writeFileSync(config.report, JSON.stringify(report, null, 2));
  console.log(`[tree-impostor-sweep] wrote ${config.report}`);
  if (status !== "pass") process.exit(1);
}

main().catch((error: unknown) => {
  console.error("[tree-impostor-sweep] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
