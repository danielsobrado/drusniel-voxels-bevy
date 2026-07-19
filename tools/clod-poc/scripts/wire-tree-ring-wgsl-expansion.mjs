import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, "../src/gpu/wgsl_modules.ts");

const edits = [
  {
    label: "species expansion import",
    expected: `import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";\nimport { applyTreeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";`,
    replacement: `import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";\nimport { applyTreeRingSpeciesWgslExpansion } from "./tree_ring_species_wgsl_expansion.js";\nimport { applyTreeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";`,
  },
  {
    label: "species expansion compose body",
    expected: `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const treeEntry = applyTreeRingWgslLayoutConstants(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry)), treeLayout).replace(`,
    replacement: `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const baseTreeEntry = withTreePcgHash(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry)));\n  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);\n  const treeEntry = applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout).replace(`,
    alreadyApplied: [
      `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const baseTreeEntry = withTreeShadowLodGate(withTreePcgHash(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry))));\n  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);\n  const treeEntry = replaceConstU32(\n    applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout),`,
      `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const baseTreeEntry = withTreeTerrainVisibilityCull(withTreeShadowLodGate(withTreePcgHash(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry)))));\n  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);\n  const treeEntry = replaceConstU32(\n    applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout),`,
      `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const baseTreeEntry = withTreeTerrainVisibilityCull(withTreeShadowLodGate(withTreeSharedPcgModule(withTreePcgHash(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry))))));\n  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);\n  const treeEntry = replaceConstU32(\n    applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout),`,
      `  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);\n  const baseTreeEntry = withTreeTerrainVisibilityCull(\n    withTreeShadowLodGate(\n      withTreeSharedPcgModule(\n        withTreePcgHash(\n          withTreeFinalPlacementHeight(\n            withRiverEcologyConstants(treeRingEntry),\n          ),\n        ),\n      ),\n    ),\n  );\n  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);\n  const crownProxyTreeEntry = withTreeCrownProxyShadowIndexCount(\n    expandedTreeEntry,\n    TREE_CROWN_PROXY_INDEX_COUNT,\n  );\n  const treeEntry = replaceConstU32(\n    applyTreeRingWgslLayoutConstants(crownProxyTreeEntry, treeLayout),`,
    ],
  },
];

export function wireTreeRingWgslExpansionSource(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let source = input.replace(/\r\n/g, "\n");
  let changed = false;
  const applied = [];
  const skipped = [];
  for (const edit of edits) {
    const expectedCount = countOccurrences(source, edit.expected);
    const appliedCount = [edit.replacement, ...(edit.alreadyApplied ?? [])]
      .reduce((count, applied) => count + countOccurrences(source, applied), 0);
    if (appliedCount === 1) {
      skipped.push(edit.label);
      continue;
    }
    if (appliedCount > 1 || expectedCount !== 1) {
      throw new Error(`Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${appliedCount} already-applied matches.`);
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }
  return { source: eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source, changed, applied, skipped };
}

export function wireTreeRingWgslExpansionFile(path = defaultPath, options = {}) {
  const result = wireTreeRingWgslExpansionSource(readFileSync(path, "utf8"));
  if (!options.dryRun && result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeRingWgslExpansionFile(defaultPath, { dryRun });
  console.log(`${dryRun ? "Checked" : "Updated"} ${defaultPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}
