import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  validateTreeParityEvidence,
  type TreeParityEvidenceManifest,
} from "../src/trees/tree_parity_evidence.js";

type Args = Record<string, string | boolean>;

const DEFAULT_CONFIG = "config/tree-parity-evidence.yaml";

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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(stringArg(args, "root", process.cwd()));
  const configPath = resolve(root, stringArg(args, "config", DEFAULT_CONFIG));
  const manifest = yaml.load(readFileSync(configPath, "utf8")) as TreeParityEvidenceManifest;

  const result = validateTreeParityEvidence({
    manifest,
    fileInfo: (path) => {
      const resolved = resolve(root, path);
      if (!existsSync(resolved)) return { exists: false, sizeBytes: 0 };
      return { exists: true, sizeBytes: statSync(resolved).size };
    },
    readJson: (path) => JSON.parse(readFileSync(resolve(root, path), "utf8")),
  });

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

main();
