/**
 * Aggregate D4 village toggle A/B marginal costs.
 * Usage: npx tsx tools/aggregate-rpg-dense-cost.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CASES = [
  "rpg-village",
  "rpg-village-trees-off",
  "rpg-village-grass-off",
  "rpg-village-props-off",
  "rpg-village-construction-off",
  "rpg-village-water-off",
  "rpg-village-vegetation-off",
] as const;

function loadFrame(caseName: string) {
  const path = join("perf-runs", "rpg-dense-cost", caseName, "summary.json");
  if (!existsSync(path)) return null;
  const summary = JSON.parse(readFileSync(path, "utf8"));
  const c = summary.cases?.[0];
  if (!c?.snapshot?.metrics) return null;
  return {
    caseName,
    frameMs: c.snapshot.metrics.frameMs,
    renderMs: c.snapshot.metrics.renderMs,
    topBroad: c.snapshot.broadBucketsByP95?.[0]?.name ?? "?",
  };
}

function main(): void {
  const rows = CASES.map(loadFrame).filter(Boolean) as NonNullable<ReturnType<typeof loadFrame>>[];
  const baseline = rows.find((r) => r.caseName === "rpg-village");
  if (!baseline) throw new Error("missing rpg-village baseline cost run");
  const marginal = rows
    .filter((r) => r.caseName !== "rpg-village")
    .map((r) => ({
      caseName: r.caseName,
      system: r.caseName.replace("rpg-village-", "").replace("-off", ""),
      deltaFrameP95: baseline.frameMs.p95 - r.frameMs.p95,
      deltaRenderP95: baseline.renderMs.p95 - r.renderMs.p95,
      offFrameP95: r.frameMs.p95,
      baselineFrameP95: baseline.frameMs.p95,
      topBroadOff: r.topBroad,
    }))
    .sort((a, b) => b.deltaFrameP95 - a.deltaFrameP95);

  const goNoGo = marginal.map((row) => {
    const justifyGpuVis = row.deltaFrameP95 >= 3;
    return {
      system: row.system,
      marginalFrameP95Ms: Number(row.deltaFrameP95.toFixed(2)),
      decision: justifyGpuVis ? "go-investigate-gpu-visibility" : "local-or-low-priority",
      rationale: justifyGpuVis
        ? `Turning off saves ≥3ms frame p95 (${row.deltaFrameP95.toFixed(2)}ms) at village settled — candidate for plan 4.`
        : `Marginal save ${row.deltaFrameP95.toFixed(2)}ms frame p95 — prefer local fix or leave.`,
    };
  });

  const outDir = join("perf-runs", "rpg-dense-cost");
  mkdirSync(outDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline,
    marginal,
    goNoGo,
  };
  writeFileSync(join(outDir, "cost-table.json"), JSON.stringify(report, null, 2));
  const md = [
    "# RPG dense D4 cost table",
    "",
    `baseline village frameMs p95: **${baseline.frameMs.p95.toFixed(2)}**`,
    "",
    "| system off | Δ frame p95 (ms) | Δ render p95 (ms) | off p95 | decision |",
    "|---|---:|---:|---:|---|",
    ...goNoGo.map((row, i) => {
      const m = marginal[i]!;
      return `| ${row.system} | ${m.deltaFrameP95.toFixed(2)} | ${m.deltaRenderP95.toFixed(2)} | ${m.offFrameP95.toFixed(2)} | ${row.decision} |`;
    }),
    "",
  ].join("\n");
  writeFileSync(join(outDir, "cost-table.md"), md);
  console.log(md);
}

main();
