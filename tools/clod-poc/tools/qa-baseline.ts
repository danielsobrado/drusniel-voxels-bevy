import { resolve } from "node:path";
import { loadUnifiedRegistry } from "../src/qa/unified/manifest.js";
import { updateQaBaselines } from "../src/qa/unified/baseline.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const VISUAL = resolve(REPOSITORY_ROOT, "validation/manifests/visual-regression.yaml");
const PERFORMANCE = resolve(REPOSITORY_ROOT, "validation/manifests/performance-regression.yaml");
const LEGACY = resolve(REPOSITORY_ROOT, "validation/manifests/legacy-id-map.yaml");

interface Args { runRoot?: string; scenes: string[]; approve: boolean; allowCi: boolean }

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runRoot) throw new Error("--run-root is required");
  const registry = loadUnifiedRegistry({ visual: VISUAL, performance: PERFORMANCE, legacyMap: LEGACY });
  const authorities = updateQaBaselines(registry, {
    repositoryRoot: REPOSITORY_ROOT,
    runRoot: resolve(REPOSITORY_ROOT, args.runRoot),
    visualManifest: VISUAL,
    performanceManifest: PERFORMANCE,
    sceneIds: args.scenes,
    approve: args.approve,
    allowCi: args.allowCi,
  });
  console.log(`[qa-baseline] promoted ${authorities.length} baselines to version ${authorities[0]?.baseline_version ?? registry.baselineVersion}`);
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenes: [], approve: false, allowCi: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--run-root" && value) { args.runRoot = value; index++; }
    else if (arg === "--scene" && value) { args.scenes.push(value); index++; }
    else if (arg === "--approve") args.approve = true;
    else if (arg === "--allow-ci") args.allowCi = true;
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return args;
}

try { main(); }
catch (error) {
  console.error("[qa-baseline] error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
