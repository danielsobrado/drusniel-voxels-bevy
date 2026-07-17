// Honest baseline (playable-world-contract P0.4) + contract gates. Runs the same
// deterministic 10-sim-minute scripted route twice — legacy configuration vs the
// P1/P2 contract wiring — and asserts the contract behaviors that the legacy run
// provably violates. Set PLAYABLE_BASELINE_WRITE=1 to write the evidence report
// (npm run baseline:playable).
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPlayableBaseline, UNSTREAMED, type BaselineRunResult } from "./playable_baseline.js";

const SIM_SECONDS = 600;

function counterRows(legacy: BaselineRunResult, contract: BaselineRunResult): string {
  const keys = [...new Set([...Object.keys(legacy.counters), ...Object.keys(contract.counters)])].sort();
  return keys
    .map((key) => `| ${key} | ${formatValue(legacy.counters[key])} | ${formatValue(contract.counters[key])} |`)
    .join("\n");
}

function formatValue(value: number | undefined): string {
  if (value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function writeEvidence(legacy: BaselineRunResult, contract: BaselineRunResult): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../../docs/performance");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = resolve(outDir, `playable-world-baseline-${stamp}.json`);
  const mdPath = resolve(outDir, `playable-world-baseline-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify({ legacy, contract }, null, 2));
  writeFileSync(mdPath, `# Playable-world honest baseline — ${stamp}

Deterministic scripted run (${SIM_SECONDS} s simulated at 120 Hz fixed step): walk +
sprint + jump every 7 s + dig every 20 s + periodic teleports + one cave-void teleport
(minute 5) + a walk at a never-streamed frontier (minute 8). Synthetic 640 m world,
seeded route; harness: \`tools/playable_baseline/playable_baseline.ts\` (vitest-driven,
same collider/controller code as the app).

Legacy = pre-contract configuration (unrestricted height fallback, synchronous collider
rebuilds, no frontier barrier). Contract = P1/P2 wiring (certified fallback, async
revision-validated rebuilds, barrier, readiness-gated teleports).

| counter | legacy | contract |
|---|---|---|
${counterRows(legacy, contract)}

| observation | legacy | contract |
|---|---|---|
| invented-floor frames in cave | ${legacy.fakeFloorFramesInCave} | ${contract.fakeFloorFramesInCave} |
| invented-floor frames in unstreamed zone | ${legacy.fakeFloorFramesUnstreamed} | ${contract.fakeFloorFramesUnstreamed} |
| entered unstreamed zone | ${legacy.enteredUnstreamed} | ${contract.enteredUnstreamed} |
| reached real cave floor | ${legacy.caveFloorReached} | ${contract.caveFloorReached} |
| digs / teleports / jumps | ${legacy.digs} / ${legacy.teleports} / ${legacy.jumps} | ${contract.digs} / ${contract.teleports} / ${contract.jumps} |
| wall clock (ms) | ${legacy.wallClockMs.toFixed(0)} | ${contract.wallClockMs.toFixed(0)} |
`);
  console.log(`[playable-baseline] evidence written: ${mdPath}`);
}

describe("playable-world honest baseline (10 simulated minutes per configuration)", () => {
  const legacy = runPlayableBaseline("legacy", SIM_SECONDS);
  const contract = runPlayableBaseline("contract", SIM_SECONDS);

  if (process.env.PLAYABLE_BASELINE_WRITE === "1") writeEvidence(legacy, contract);

  it("legacy: the height fallback invents floors in the cave and over the unstreamed frontier", () => {
    expect(legacy.fakeFloorFramesInCave).toBeGreaterThan(0);
    expect(legacy.enteredUnstreamed).toBe(true);
    expect(legacy.fakeFloorFramesUnstreamed).toBeGreaterThan(0);
    expect(legacy.caveFloorReached).toBe(false); // never allowed to actually be in the cave
    expect(legacy.counters["collider_sync_frame_builds"] ?? 0).toBeGreaterThan(0); // sync rebuild stalls
  });

  it("contract: the cave is enterable (real floor), no invented floors anywhere", () => {
    expect(contract.caveFloorReached).toBe(true);
    expect(contract.fakeFloorFramesInCave).toBe(0);
    expect(contract.fakeFloorFramesUnstreamed).toBe(0);
    expect(contract.counters["fallback_denied_uncertified"] ?? 0).toBeGreaterThan(0); // the restriction bit
  });

  it("contract: the frontier barrier holds the unstreamed boundary", () => {
    expect(contract.enteredUnstreamed).toBe(false);
    expect(contract.counters["frontier_barrier_engagements"] ?? 0).toBeGreaterThan(0);
    expect(contract.finalPosition[0]).toBeLessThan(UNSTREAMED.minX + 1);
  });

  it("contract: zero coverage loss, zero recoveries, zero sync frame builds on the whole route", () => {
    expect(contract.counters["collider_coverage_missing"] ?? 0).toBe(0);
    expect(contract.counters["player_recovery_backstop_depth"] ?? 0).toBe(0);
    expect(contract.counters["collider_sync_frame_builds"] ?? 0).toBe(0);
    expect(contract.counters["collider_jobs_completed"] ?? 0).toBeGreaterThan(0); // digs really rebuilt async
  });

  it("both runs completed the full scripted route deterministically", () => {
    for (const run of [legacy, contract]) {
      expect(run.digs).toBeGreaterThanOrEqual(25);
      expect(run.teleports).toBeGreaterThanOrEqual(4);
      expect(run.jumps).toBeGreaterThanOrEqual(80);
    }
  });

  it("P3 gate: 5 route-seed variations — zero coverage loss, zero recoveries, zero sync builds, frontier held", () => {
    for (const seed of [0xd275, 1, 2, 3, 4]) {
      const run = runPlayableBaseline("contract", SIM_SECONDS, undefined, seed);
      const recoveries = (run.counters["player_recovery_non_finite"] ?? 0)
        + (run.counters["player_recovery_kill_plane"] ?? 0)
        + (run.counters["player_recovery_missing_collider"] ?? 0)
        + (run.counters["player_recovery_backstop_depth"] ?? 0);
      expect({
        seed,
        coverageMissing: run.counters["collider_coverage_missing"] ?? 0,
        recoveries,
        syncBuilds: run.counters["collider_sync_frame_builds"] ?? 0,
        enteredUnstreamed: run.enteredUnstreamed,
        fakeFloors: run.fakeFloorFramesInCave + run.fakeFloorFramesUnstreamed,
      }).toEqual({
        seed,
        coverageMissing: 0,
        recoveries: 0,
        syncBuilds: 0,
        enteredUnstreamed: false,
        fakeFloors: 0,
      });
    }
  });
});
