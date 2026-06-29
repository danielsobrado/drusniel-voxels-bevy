import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system.ts");

export function repairTreeGeneratedOutputSource(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let source = input.replace(/\r\n/g, "\n");
  const before = source;
  source = removeDuplicateShadowTierDraw(source);
  return {
    source: eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source,
    changed: source !== before,
  };
}

export function repairTreeGeneratedOutputFile(path = defaultTreeSystemPath, options = {}) {
  const result = repairTreeGeneratedOutputSource(readFileSync(path, "utf8"));
  if (!options.dryRun && result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const result = repairTreeGeneratedOutputFile(defaultTreeSystemPath, { dryRun });
  console.log(`${dryRun ? "Checked" : "Updated"} ${defaultTreeSystemPath}`);
  console.log(result.changed ? "Removed duplicate generated shadow-tier draw method." : "No generated-output repair needed.");
}

function removeDuplicateShadowTierDraw(source) {
  const marker = "  private createGpuRingShadowTierDraw(\n";
  const first = source.indexOf(marker);
  if (first < 0) return source;
  const second = source.indexOf(marker, first + marker.length);
  if (second < 0) return source;
  const end = source.indexOf("\n  private usesGpuRingPrepass", second);
  if (end < 0) return source;
  return `${source.slice(0, second)}${source.slice(end + 1)}`;
}
