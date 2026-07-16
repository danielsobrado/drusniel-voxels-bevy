import { resolve } from "node:path";
import { loadUnifiedRegistry } from "../src/qa/unified/manifest.js";
import { loadQaOrchestration } from "../src/qa/unified/orchestration_manifest.js";
import { runQaBattery } from "../src/qa/unified/battery_runner.js";
import { runQaDeterminism } from "../src/qa/unified/determinism.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const DEFAULTS = {
  visual: resolve(REPOSITORY_ROOT, "validation/manifests/visual-regression.yaml"),
  performance: resolve(REPOSITORY_ROOT, "validation/manifests/performance-regression.yaml"),
  legacyMap: resolve(REPOSITORY_ROOT, "validation/manifests/legacy-id-map.yaml"),
  commands: resolve(REPOSITORY_ROOT, "validation/manifests/command-allowlist.yaml"),
  batteries: resolve(REPOSITORY_ROOT, "validation/manifests/batteries.yaml"),
};

interface Args {
  mode: "validate" | "run" | "determinism";
  battery: string;
  output: string;
  target?: "clod-poc" | "bevy";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenes = loadUnifiedRegistry({ visual: DEFAULTS.visual, performance: DEFAULTS.performance, legacyMap: DEFAULTS.legacyMap });
  const orchestration = loadQaOrchestration({ commands: DEFAULTS.commands, batteries: DEFAULTS.batteries }, scenes);
  console.log(`[qa-orchestrator] validated scenes=${scenes.scenes.length} commands=${orchestration.commands.size} batteries=${orchestration.batteries.size}`);
  if (args.mode === "validate") return;
  const outputDir = resolve(REPOSITORY_ROOT, args.output);
  const report = args.mode === "determinism"
    ? await runQaDeterminism(orchestration, scenes, { repositoryRoot: REPOSITORY_ROOT, outputDir, batteryId: args.battery, target: args.target })
    : await runQaBattery(orchestration, scenes, { repositoryRoot: REPOSITORY_ROOT, outputDir, batteryId: args.battery, target: args.target, runIndex: 1 });
  console.log(`[qa-orchestrator] ${args.mode} status=${report.status}`);
  if (report.status !== "PASS") process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mode: "validate", battery: "combined-smoke", output: "validation-runs/orchestrated/latest" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--mode" && value) {
      if (value !== "validate" && value !== "run" && value !== "determinism") throw new Error(`invalid mode ${value}`);
      args.mode = value;
      index++;
    } else if (arg === "--battery" && value) { args.battery = value; index++; }
    else if (arg === "--output" && value) { args.output = value; index++; }
    else if (arg === "--target" && value) {
      if (value !== "clod-poc" && value !== "bevy") throw new Error(`invalid target ${value}`);
      args.target = value;
      index++;
    } else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return args;
}

main().catch((error: unknown) => {
  console.error("[qa-orchestrator] error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
