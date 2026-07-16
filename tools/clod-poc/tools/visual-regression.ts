import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WebQaSummary } from "../src/qa/qaTypes.js";
import { loadUnifiedRegistry, selectScenes } from "../src/qa/unified/manifest.js";
import { runUnifiedQa } from "../src/qa/unified/runner.js";

const DEFAULT_VISUAL = "../../validation/manifests/visual-regression.yaml";
const DEFAULT_PERFORMANCE = "../../validation/manifests/performance-regression.yaml";
const DEFAULT_LEGACY_MAP = "../../validation/manifests/legacy-id-map.yaml";

interface Args {
  validateOnly: boolean;
  visual: string;
  performance: string;
  legacyMap: string;
  summary?: string;
  output: string;
  tags: string[];
  scenes: string[];
  actualRoot?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifests = { visual: resolve(args.visual), performance: resolve(args.performance), legacyMap: resolve(args.legacyMap) };
  const registry = loadUnifiedRegistry(manifests);
  const selected = selectScenes(registry, args.tags, args.scenes);
  console.log(`[visual-regression] validated ${registry.scenes.length} scenes; selected ${selected.length}`);
  if (args.validateOnly) return;
  if (!args.summary) throw new Error("--summary <qa-summary.json> is required unless --validate-only is used");
  const summaryPath = resolve(args.summary);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as WebQaSummary;
  const report = await runUnifiedQa({
    manifests,
    summary,
    summaryPath,
    outputDir: resolve(args.output),
    tags: args.tags,
    sceneIds: args.scenes,
    actualRoot: args.actualRoot ? resolve(args.actualRoot) : undefined,
  });
  console.log(`[visual-regression] status=${report.status}`);
  if (report.status === "FAIL" || report.status === "ERROR") process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    validateOnly: false,
    visual: DEFAULT_VISUAL,
    performance: DEFAULT_PERFORMANCE,
    legacyMap: DEFAULT_LEGACY_MAP,
    output: "../../validation-runs/latest",
    tags: [],
    scenes: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--validate-only") args.validateOnly = true;
    else if (arg === "--visual" && value) { args.visual = value; i++; }
    else if (arg === "--performance" && value) { args.performance = value; i++; }
    else if (arg === "--legacy-map" && value) { args.legacyMap = value; i++; }
    else if (arg === "--summary" && value) { args.summary = value; i++; }
    else if (arg === "--output" && value) { args.output = value; i++; }
    else if (arg === "--tags" && value) { args.tags.push(...value.split(",").filter(Boolean)); i++; }
    else if (arg === "--scene" && value) { args.scenes.push(value); i++; }
    else if (arg === "--actual-root" && value) { args.actualRoot = value; i++; }
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return args;
}

main().catch((error: unknown) => {
  console.error("[visual-regression] error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
