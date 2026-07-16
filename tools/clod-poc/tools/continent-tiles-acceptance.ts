import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateThresholds,
  extractAcceptanceCounters,
  THRESHOLD_RULES,
} from "./infinite_acceptance/thresholds.js";
import { clodUrl, launchWebGPU } from "./launch.js";

/**
 * Acceptance gate for the streamed continent heightfield tile layer (continent plan Phase 2).
 *
 * The infinite-islands harness cannot cover this path: streamed tiles only become *authoritative*
 * in `scene=continent` (see `heightfield_tile_runtime.ts`), so with `heightTiles=1` on
 * infinite-islands there is no page gating and no GPU tile atlas. This entry boots the continent
 * scene, waits for the tile cache to converge at a fixed pose, then applies the shared continent
 * tile rules from `infinite_acceptance/thresholds.ts`.
 */

const argIndex = (flag: string): number => process.argv.indexOf(flag);
const argValue = (flag: string, fallback: string): string => {
  const index = argIndex(flag);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const OUT_DIR = argValue("--out", join("acceptance-runs", "continent-tiles", new Date().toISOString().replace(/[:.]/g, "-")));
const CONVERGE_TIMEOUT_MS = Number(argValue("--converge-timeout-ms", "180000"));
const SETTLE_FRAMES = Number(argValue("--settle", "240"));
const SURFACE_CACHE_PARITY_EPSILON_M = 0.001;
const FALLBACK_DRAIN_TIMEOUT_MS = 60_000;
const FALLBACK_DRAIN_STABLE_POLLS = 2;
const CONTINENT_TILE_RULES = THRESHOLD_RULES.filter((rule) => rule.key.startsWith("heightfield_tile"));

interface TileSnapshot {
  required: number;
  resident: number;
  pending: number;
  inflight: number;
}

const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const url = clodUrl({
    scene: "continent",
    seed: 19,
    freeze: true,
    extra: { world: "8", startupWorld: "2", acceptance: "1", surfaceCacheParity: "1" },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Boot, including the continent hydrology graph build.
  await page.waitForFunction(
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error != null,
    undefined,
    { timeout: CONVERGE_TIMEOUT_MS, polling: 250 },
  );

  // Converge the tile cache at a fixed pose: every required tile resident, queues drained.
  const trail: TileSnapshot[] = [];
  let converged = false;
  const deadline = Date.now() + CONVERGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate((): TileSnapshot => {
      const counters = window.__drusnielClod?.stats?.counters ?? {};
      return {
        required: counters["heightfield_tiles_required"] ?? -1,
        resident: counters["heightfield_tiles_resident"] ?? -1,
        pending: counters["heightfield_tiles_pending"] ?? -1,
        inflight: counters["heightfield_tiles_inflight"] ?? -1,
      };
    });
    trail.push(snapshot);
    if (snapshot.required > 0 && snapshot.pending === 0 && snapshot.inflight === 0
      && snapshot.resident >= snapshot.required) {
      converged = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  await page.evaluate(async (frames) => {
    await window.__drusnielClod?.settle?.(frames);
  }, SETTLE_FRAMES);

  let fallbackDrainStablePolls = 0;
  const fallbackDrainDeadline = Date.now() + FALLBACK_DRAIN_TIMEOUT_MS;
  while (Date.now() < fallbackDrainDeadline && fallbackDrainStablePolls < FALLBACK_DRAIN_STABLE_POLLS) {
    await page.evaluate(async () => {
      await window.__drusnielClod?.settle?.(30);
    });
    const drain = await page.evaluate(() => {
      const counters = window.__drusnielClod?.stats?.counters ?? {};
      return {
        fallbackSamples: counters["heightfield_tiles_fallback_samples_this_frame"] ?? -1,
        paritySamples: counters["surface_cache_parity_samples"] ?? 0,
      };
    });
    fallbackDrainStablePolls = drain.fallbackSamples === 0 && drain.paritySamples > 0
      ? fallbackDrainStablePolls + 1
      : 0;
  }

  const stats = await page.evaluate(() => ({
    counters: { ...(window.__drusnielClod?.stats?.counters ?? {}) },
    error: window.__drusnielClod?.error ?? null,
  }));

  const values = extractAcceptanceCounters(stats as unknown as Record<string, unknown>);
  const evaluation = evaluateThresholds(values, [], CONTINENT_TILE_RULES);

  const failures = [...evaluation.failures];
  if (!converged) failures.push("continent heightfield tiles did not converge before the timeout");
  if (fallbackDrainStablePolls < FALLBACK_DRAIN_STABLE_POLLS) failures.push("continent heightfield fallback samples did not reach a stable drained window");
  if (stats.error) failures.push(`fail-loud boot error: ${String(stats.error)}`);
  if (errors.length > 0) failures.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
  if (values["heightfield_tiles_enabled"] !== 1) {
    failures.push("heightfield_tiles_enabled != 1: the continent scene did not stream tiles at all");
  }
  if (values["heightfield_tile_gpu_atlas_enabled"] !== 1) {
    failures.push("heightfield_tile_gpu_atlas_enabled != 1: streamed tiles were not authoritative on the GPU");
  }
  const paritySamples = values["surface_cache_parity_samples"];
  const parityMaxErrorM = values["surface_cache_parity_max_error_m"];
  if (!Number.isFinite(paritySamples) || paritySamples! <= 0) {
    failures.push("surface_cache_parity_samples missing or zero");
  }
  if (!Number.isFinite(parityMaxErrorM) || parityMaxErrorM! > SURFACE_CACHE_PARITY_EPSILON_M) {
    failures.push(`surface_cache_parity_max_error_m=${String(parityMaxErrorM)} exceeds ${SURFACE_CACHE_PARITY_EPSILON_M}`);
  }

  const passed = failures.length === 0;
  const report = {
    url,
    passed,
    converged,
    fallbackDrained: fallbackDrainStablePolls >= FALLBACK_DRAIN_STABLE_POLLS,
    convergeSeconds: trail.length,
    rulesEvaluated: CONTINENT_TILE_RULES.length,
    failures,
    counters: Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("heightfield_tile") || key.startsWith("surface_cache_parity"))),
    frameMsP95: values["frame_ms_p95"] ?? null,
    trail,
    errors,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  console.log(`[continent-tiles] ${passed ? "PASS" : "FAIL"} converged=${converged} in ~${trail.length}s`);
  for (const [key, value] of Object.entries(report.counters)) console.log(`  ${key} = ${value}`);
  for (const failure of failures) console.log(`  FAIL: ${failure}`);
  console.log(`[continent-tiles] report: ${join(OUT_DIR, "report.json")}`);
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
