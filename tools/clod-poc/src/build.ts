// Phase 1 headless builder. Builds the quadtree, runs all assertions, prints the stats
// panel (tris per level, build ms, low-benefit rate, error_world) and the cross-page
// border-match check (gate A2, proven by induction on LOD1/LOD2 adjacency — plan §3.1).
//
// Run: npm run build-pages [worldPages]   (default 4x4 LOD0 pages)

import { loadConfig } from "./config_node.js";
import { initSimplifier } from "./simplify.js";
import { buildWorld } from "./quadtree.js";
import { borderChain, assertBorderMatch } from "./validate.js";
import { ClodPageNode } from "./types.js";

function fmt(n: number, w = 8): string {
  return n.toLocaleString("en-US").padStart(w);
}

async function main() {
  const cfg = loadConfig();
  const world = Number(process.argv[2] ?? 4);

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

  // Gate-relevant metrics (informational here; the formal gate is Phase 3).
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
        );
        checks++;
      }
      const down = idx.get(`${nx},${nz + 1}`);
      if (down) {
        assertBorderMatch(
          borderChain(a.mesh, "z", a.footprint.maxZ, a.footprint),
          borderChain(down.mesh, "z", down.footprint.minZ, down.footprint),
        );
        checks++;
      }
    }
  }
  console.log(`\nA2 border-match: ${checks} adjacent same-level page pairs matched (pos<=1e-6, dot>=0.9999, mat<=1e-4). PASS`);
  console.log("\nbuild complete — no assertion failures.");
}

main().catch((e) => {
  console.error("\nBUILD FAILED:", e.message ?? e);
  process.exit(1);
});
