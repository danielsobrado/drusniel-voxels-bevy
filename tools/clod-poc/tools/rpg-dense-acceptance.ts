/**
 * Plan 2 D2 dense standing gate: validate settled baseline aggregate against
 * hardware-tier shipping budgets. Does not clone sparse-route thresholds.
 *
 * Usage:
 *   npm --prefix tools/clod-poc run accept:rpg-dense
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RPG_DENSE_PRIMARY_TIER } from "./infinite_acceptance/rpg_dense_thresholds.js";

interface AggregateSlice {
  runs: number;
  frameMs: {
    p50_median: number;
    p50_worst: number;
    p95_median: number;
    p95_worst: number;
    max_worst: number;
    spread_p95: number;
  };
}

interface AggregateFile {
  village: AggregateSlice;
  base: AggregateSlice;
  move?: AggregateSlice;
}

interface GateResult {
  name: string;
  ok: boolean;
  detail: string;
}

function checkSettled(
  label: string,
  slice: AggregateSlice,
  p95Max: number,
  maxMax: number,
): GateResult[] {
  return [
    {
      name: `${label}.runs`,
      ok: slice.runs >= 5,
      detail: `runs=${slice.runs} (need ≥5)`,
    },
    {
      name: `${label}.frameMs.p95_worst`,
      ok: slice.frameMs.p95_worst <= p95Max,
      detail: `${slice.frameMs.p95_worst.toFixed(2)} ≤ ${p95Max}`,
    },
    {
      name: `${label}.frameMs.max_worst`,
      ok: slice.frameMs.max_worst <= maxMax,
      detail: `${slice.frameMs.max_worst.toFixed(2)} ≤ ${maxMax}`,
    },
  ];
}

function main(): void {
  const root = join("perf-runs", "rpg-dense-baseline");
  const aggregatePath = join(root, "aggregate.json");
  if (!existsSync(aggregatePath)) {
    throw new Error(`Missing ${aggregatePath}; run aggregate-rpg-dense-baseline.ts first`);
  }
  const aggregate = JSON.parse(readFileSync(aggregatePath, "utf8")) as AggregateFile;
  const results: GateResult[] = [
    ...checkSettled(
      "village",
      aggregate.village,
      RPG_DENSE_PRIMARY_TIER.villageSettledFrameMsP95Max,
      RPG_DENSE_PRIMARY_TIER.villageSettledFrameMsMaxMax,
    ),
    ...checkSettled(
      "player-base",
      aggregate.base,
      RPG_DENSE_PRIMARY_TIER.playerBaseSettledFrameMsP95Max,
      RPG_DENSE_PRIMARY_TIER.playerBaseSettledFrameMsMaxMax,
    ),
  ];
  if (aggregate.move && aggregate.move.runs > 0) {
    results.push(
      ...checkSettled(
        "move",
        aggregate.move,
        RPG_DENSE_PRIMARY_TIER.moveFrameMsP95Max,
        RPG_DENSE_PRIMARY_TIER.moveFrameMsMaxMax,
      ),
    );
  }

  const failed = results.filter((r) => !r.ok);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tier: RPG_DENSE_PRIMARY_TIER,
    results,
    ok: failed.length === 0,
    residencyEvictionAb: "none — D1c peaks did not require residency/eviction config changes",
  };
  const outDir = join("perf-runs", "rpg-dense-gates");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "gate-report.json"), JSON.stringify(report, null, 2));
  const md = [
    "# RPG dense standing gate (D2)",
    "",
    `ok: **${report.ok}**`,
    "",
    "## Tier budgets (primary discrete)",
    "",
    "```json",
    JSON.stringify(RPG_DENSE_PRIMARY_TIER, null, 2),
    "```",
    "",
    "## Results",
    "",
    ...results.map((r) => `- ${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`),
    "",
    `Residency/eviction A/B: ${report.residencyEvictionAb}`,
    "",
  ].join("\n");
  writeFileSync(join(outDir, "gate-report.md"), md);
  console.log(md);
  if (!report.ok) process.exit(1);
}

main();
