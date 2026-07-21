import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildQaAffectedPlan, loadQaPathOwnership } from "../src/qa/affected/path_ownership.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const CLOD_ROOT = resolve(REPOSITORY_ROOT, "tools/clod-poc");
const DEFAULT_CONFIG = resolve(CLOD_ROOT, "config/qa_path_ownership.yaml");

interface Args {
  base: string;
  config: string;
  output: string;
  run: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadQaPathOwnership(args.config);
  const changedFiles = gitChangedFiles(args.base);
  const plan = buildQaAffectedPlan(config, changedFiles);
  validateScripts(plan.scripts);
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify({ schemaVersion: 1, base: args.base, ...plan }, null, 2)}\n`);
  console.log(`[qa-affected] battery=${plan.battery} rules=${plan.matchedRules.join(",") || "none"}`);
  console.log(`[qa-affected] scripts=${plan.scripts.join(",") || "none"}`);
  console.log(`[qa-affected] wrote ${args.output}`);
  if (!args.run) return;

  const runRoot = `validation-runs/affected/${Date.now()}`;
  await runCommand([
    "--prefix", "tools/clod-poc", "run", "qa:orchestrator", "--",
    "--mode", "run",
    "--battery", plan.battery,
    "--target", "clod-poc",
    "--output", runRoot,
  ]);
  for (const script of plan.scripts) await runCommand(["--prefix", "tools/clod-poc", "run", script]);
}

function gitChangedFiles(base: string): string[] {
  const ranges = [`${base}...HEAD`, `${base}..HEAD`];
  for (const range of ranges) {
    try {
      const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", range], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        windowsHide: true,
      });
      return output.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
    } catch {
      // Try the non-merge-base range before failing with a useful error.
    }
  }
  throw new Error(`unable to resolve QA diff base ${base}`);
}

function validateScripts(scripts: readonly string[]): void {
  const packageJson = JSON.parse(readFileSync(resolve(CLOD_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const script of scripts) {
    if (!packageJson.scripts?.[script]) throw new Error(`QA ownership references unknown npm script ${script}`);
  }
}

async function runCommand(args: readonly string[]): Promise<void> {
  const program = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(program, [...args], {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`npm ${args.join(" ")} exited with ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
    });
  });
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    base: process.env["GITHUB_BASE_REF"] ? `origin/${process.env["GITHUB_BASE_REF"]}` : "origin/main",
    config: DEFAULT_CONFIG,
    output: resolve(CLOD_ROOT, "qa-runs/affected-plan.json"),
    run: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--base" && value) { args.base = value; index++; }
    else if (arg === "--config" && value) { args.config = resolve(value); index++; }
    else if (arg === "--out" && value) { args.output = resolve(value); index++; }
    else if (arg === "--run") args.run = true;
    else throw new Error(`unknown or incomplete qa-affected argument: ${String(arg)}`);
  }
  return args;
}

main().catch((error) => {
  console.error(`[qa-affected] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
