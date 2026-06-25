// Headless builder. Builds the quadtree, runs all assertions, prints the stats
// panel (tris per level, build ms, low-benefit rate, error_world) and the cross-page
// border-match check.
//
// Run: npm run build-pages [worldPages]   (default 4x4 LOD0 pages)

import { loadConfig } from "./config_node.js";
import { initSimplifier } from "./simplify.js";
import { buildWorld } from "./quadtree.js";
import { borderChain, assertBorderMatch } from "./validate.js";
import { ClodPageNode } from "./types.js";
import { aggregateDiagonalPolishStats, formatDiagonalPolishStats } from "./diagonalPolish.js";

function fmt(n: number, w = 8): string {
  return n.toLocaleString("en-US").padStart(w);
}

async function main() {
  const cfg = loadConfig();
  const rawArg = process.argv[2];
  const world = rawArg === "smoke"
    ? cfg.poc.smoke_lod0_pages_x
    : rawArg
      ? Number(rawArg)
      : cfg.poc.lod0_pages_x;

  await initSimplifier();
  const t0 = performance.now();
  const result = buildWorld(world, world, cfg);
  const totalMs = performance.now() - t0;

  console.log(`\n=== CLOD page build: ${world}x${world} LOD0 pages, ${cfg.page.quadtree_levels} levels ===`);
  console.log(`meshopt package version (config): ${cfg.meshopt_package_version}`);
  console.log(`page = ${cfg.page.chunks_per_page}x${cfg.page.chunks_per_page} chunks of ${cfg.page.chunk_size} cells\n`);

  // Per-level summary.
  console.log("level   nodes      tris   avg_err_world  low_benefit   build_ms");
  let lod0Tris = 0;
  let topTris = 0;
  const levels = [...result.nodesByLevel.keys()].sort((a, b) => a - b);
  for (const lvl of levels) {
    const nodes = result.nodesByLevel.get(lvl)!;
    const lvlStats = result.stats.filter((s) => s.level === lvl);
    const tris = nodes.reduce((a, n) => a + n.mesh.indices.length / 3, 0);
    const avgErr = lvlStats.reduce((a, s) => a + s.errorWorld, 0) / lvlStats.length;
    const lowB = lvlStats.filter((s) => s.lowBenefit).length;
    const ms = lvlStats.reduce((a, s) => a + s.buildMs, 0);
    console.log(
      `  ${lvl}   ${fmt(nodes.length, 5)}  ${fmt(tris)}   ${avgErr.toExponential(3).padStart(11)}   ` +
        `${fmt(lowB, 4)}/${String(lvlStats.length).padEnd(4)}  ${ms.toFixed(1).padStart(8)}`,
    );
    if (lvl === 0) lod0Tris = tris;
    topTris = tris;
  }
  console.log(`\ntotal build: ${totalMs.toFixed(1)} ms`);
  console.log(formatDiagonalPolishStats(aggregateDiagonalPolishStats(result.stats.map((s) => s.polish))));

  // Gate-relevant metrics.
  const allLowBenefit = result.stats.filter((s) => s.level >= 1 && s.level <= 2);
  const lowRate = allLowBenefit.length
    ? allLowBenefit.filter((s) => s.lowBenefit).length / allLowBenefit.length
    : 0;
  const perAreaReduction = topTris / lod0Tris; // top covers same area as all LOD0
  console.log(`\nA4 reduction (top vs LOD0, same covered area): ${(perAreaReduction * 100).toFixed(1)}%  (target <= ~15%)`);
  console.log(`A6 low-benefit rate (levels 1-2): ${(lowRate * 100).toFixed(1)}%  (target < 10%)`);

  // A2 border match: adjacent same-level nodes must share matching border chains.
  let checks = 0;
  for (const lvl of levels) {
    const idx = new Map<string, ClodPageNode>();
    const span = (1 << lvl) * cfg.page.chunks_per_page * cfg.page.chunk_size;
    for (const n of result.nodesByLevel.get(lvl)!) {
      idx.set(`${n.footprint.minX / span},${n.footprint.minZ / span}`, n);
    }
    for (const [key, a] of idx) {
      const [nx, nz] = key.split(",").map(Number);
      const right = idx.get(`${nx + 1},${nz}`);
      if (right) {
        assertBorderMatch(
          borderChain(a.mesh, "x", a.footprint.maxX, a.footprint),
          borderChain(right.mesh, "x", right.footprint.minX, right.footprint),
          { position: cfg.validation.position_epsilon, normalDot: cfg.validation.normal_dot_min, material: cfg.validation.material_weight_epsilon },
        );
        checks++;
      }
      const down = idx.get(`${nx},${nz + 1}`);
      if (down) {
        assertBorderMatch(
          borderChain(a.mesh, "z", a.footprint.maxZ, a.footprint),
          borderChain(down.mesh, "z", down.footprint.minZ, down.footprint),
          { position: cfg.validation.position_epsilon, normalDot: cfg.validation.normal_dot_min, material: cfg.validation.material_weight_epsilon },
        );
        checks++;
      }
    }
  }
  const v = cfg.validation;
  console.log(`\nA2 border-match: ${checks} adjacent same-level page pairs matched (pos<=${v.position_epsilon}, dot>=${v.normal_dot_min}, mat<=${v.material_weight_epsilon}). PASS`);

  // ---- Acceptance gate verdict ----
  const maxNodeMs = Math.max(...result.stats.map((s) => s.buildMs));
  const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");
  // A4 targets the deepest LOD. A world only reaches it when it is large enough to merge
  // up to the configured max level (LOD3 needs an 8x8 world). Smaller worlds top out lower,
  // so their verdict is informational only — the formal gate runs on LOD3-capable worlds.
  const topLevel = levels[levels.length - 1];
  const maxLod = cfg.page.quadtree_levels - 1;
  const isGateRun = topLevel >= maxLod;
  const a1 = true; // reached here => every watertightness assertion (weld + no-internal-border) held
  const a2 = checks > 0; // border chains matched at gate tolerances
  const a4 = perAreaReduction <= 0.15;
  const a5 = totalMs < 30_000 && maxNodeMs < 250; // seconds total, tens of ms per node
  const a6 = lowRate < 0.1;
  console.log(isGateRun ? "\n=== Acceptance gate ===" : "\n=== Acceptance metrics (informational) ===");
  console.log(`A1 watertight (no holes/lips; weld + border asserts): ${verdict(a1)}`);
  console.log(`A2 no dark seams (matched border attrs):              ${verdict(a2)}  (${checks} pairs)`);
  console.log(`A3 density scars acceptable:                          VISUAL — inspect in viewer (npm run dev)`);
  console.log(
    `A4 triangle reduction (LOD${topLevel} <= ~15% of LOD0):         ` +
      `${isGateRun ? verdict(a4) : "INFO"}  (${(perAreaReduction * 100).toFixed(1)}%)`,
  );
  console.log(`A5 build cost (seconds total, tens of ms / node):     ${verdict(a5)}  (total ${(totalMs / 1000).toFixed(1)}s, max node ${maxNodeMs.toFixed(0)}ms)`);
  console.log(`A6 low-benefit rate (< 10% at levels 1-2):           ${verdict(a6)}  (${(lowRate * 100).toFixed(1)}%)`);
  const measured = a1 && a2 && a4 && a5 && a6;
  if (!isGateRun) {
    console.log(
      `\nMEASURED CRITERIA: INFO  (${world}x${world} world tops out at LOD${topLevel}; ` +
        `the formal gate needs an LOD${maxLod}-capable world — run \`build-pages 8\`)`,
    );
    return;
  }
  console.log(`\nMEASURED CRITERIA: ${verdict(measured)}  (A3 remains a visual judgement)`);
  if (!measured) process.exitCode = 1; // fail the command so CI/automation catches it
}

main().catch((e) => {
  console.error("\nBUILD FAILED:", e.message ?? e);
  process.exit(1);
});
