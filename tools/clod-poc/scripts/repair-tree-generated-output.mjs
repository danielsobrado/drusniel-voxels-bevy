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
  source = removeDuplicateShadowOnlyLoop(source);
  source = markUnusedShadowAtlasParam(source);
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
  console.log(result.changed ? "Repaired generated tree wiring output." : "No generated-output repair needed.");
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

function removeDuplicateShadowOnlyLoop(source) {
  const newLoopMarker = "materialHandles[shadowMaterialKey] = this.createGpuRingShadowMaterialHandle(";
  const newLoopIndex = source.indexOf(newLoopMarker);
  if (newLoopIndex < 0) return source;
  const oldLoopMarker = "materialHandles[shadowMaterialKey] = lod === \"impostor\" && this.settings.impostors.enabled && atlas?.ready";
  const oldLoopIndex = source.lastIndexOf(oldLoopMarker, newLoopIndex);
  if (oldLoopIndex < 0) return source;
  const loopStart = source.lastIndexOf("        if (this.treeLodCastsShadow(lod)) {", oldLoopIndex);
  if (loopStart < 0) return source;
  const nextLoopStart = source.indexOf("        if (this.treeLodCastsShadow(lod)) {", oldLoopIndex);
  if (nextLoopStart < 0) return source;
  return `${source.slice(0, loopStart)}${source.slice(nextLoopStart)}`;
}

function markUnusedShadowAtlasParam(source) {
  const signature = `  private createGpuRingShadowMaterialHandle(
    species: TreeSpeciesId,
    lod: TreeLod,
    buffers: TreeRingInstanceBuffers,
    atlas: TreeImpostorAtlas | undefined,
  ): TreeMaterialHandle {
`;
  const replacement = `${signature}    void atlas;
`;
  if (!source.includes(signature) || source.includes(`${signature}    void atlas;`)) return source;
  return source.replace(signature, replacement);
}
