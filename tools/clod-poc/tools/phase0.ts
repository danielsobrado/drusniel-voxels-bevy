import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { clodUrl, launchWebGPU } from "./launch.js";

interface Phase0SceneReport {
  scene: string;
  config_hash: string;
  timestamp: string;
  metrics: Record<string, number | boolean>;
  required_counters_present: boolean;
  missing_counters: string[];
}

interface Phase0AcceptanceResult {
  scene: string;
  visible_target_met: boolean;
  horizon_hole_ratio_ok: boolean;
  streamer_missing_chunks_ok: boolean;
  streamer_missing_pages_ok: boolean;
  all_counters_present: boolean;
  missing_counters: string[];
  passed: boolean;
}

interface Phase0SceneConfig {
  world: number;
  camera: { mode: string; [k: string]: unknown };
  require_visible_m?: number;
  simulated_streaming_only?: boolean;
}

interface Phase0Config {
  phase0: {
    target_visible_m: number;
    target_future_visible_m: number;
    scenes: Record<string, Phase0SceneConfig>;
  };
  metrics: {
    required_counters: string[];
  };
  acceptance: {
    allow_current_4km_failure: boolean;
    visible_target_required_for_future_phases: boolean;
    max_horizon_hole_ratio: number;
    max_streamer_simulated_missing_chunks: number;
    max_streamer_simulated_missing_pages: number;
  };
}

const CONFIG_PATH = resolve(import.meta.dirname ?? ".", "../config/infinite_streaming_phase0.yaml");
const RUN_DIR = resolve(import.meta.dirname ?? ".", "../phase0-runs");
const SCENE_MAP: Record<string, string> = {
  long_view_4km: "long-view-4km",
  long_view_forest_4km: "long-view-forest-4km",
  long_view_edit_stress: "long-view-edit-stress",
  infinite_stream_straight: "infinite-stream-straight",
  infinite_stream_fast_turn: "infinite-stream-fast-turn",
};

function loadConfig(): Phase0Config {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  return load(raw) as Phase0Config;
}

function summarizeAcceptance(input: {
  metrics: Record<string, number | boolean>;
  config: Phase0Config;
  sceneName: string;
}): Phase0AcceptanceResult {
  const { metrics, config, sceneName } = input;
  const missing = config.metrics.required_counters.filter((k) => !(k in metrics));

  const effectiveVisible = Number(metrics["effective_visible_m"] ?? 0);
  const targetVisible = Number(metrics["target_visible_m"] ?? 0);
  const visible_target_met = effectiveVisible >= targetVisible;

  const horizonRatio = Number(metrics["horizon_hole_ratio"] ?? -1);
  const horizon_hole_ratio_ok = horizonRatio === -1
    ? true
    : horizonRatio <= config.acceptance.max_horizon_hole_ratio;

  const missingChunks = Number(metrics["streamer_simulated_missing_chunks"] ?? 0);
  const streamer_missing_chunks_ok =
    missingChunks <= config.acceptance.max_streamer_simulated_missing_chunks;

  const missingPages = Number(metrics["streamer_simulated_missing_pages"] ?? 0);
  const streamer_missing_pages_ok =
    missingPages <= config.acceptance.max_streamer_simulated_missing_pages;

  const all_counters_present = missing.length === 0;

  const passed = (visible_target_met || config.acceptance.allow_current_4km_failure)
    && horizon_hole_ratio_ok
    && streamer_missing_chunks_ok
    && streamer_missing_pages_ok
    && all_counters_present;

  return {
    scene: sceneName,
    visible_target_met,
    horizon_hole_ratio_ok,
    streamer_missing_chunks_ok,
    streamer_missing_pages_ok,
    all_counters_present,
    missing_counters: missing,
    passed,
  };
}

function padR(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}
function padL(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

async function runScene(
  browser: Awaited<ReturnType<typeof launchWebGPU>>["browser"],
  sceneId: string,
  sceneConfig: Phase0SceneConfig,
  outDir: string,
): Promise<Phase0SceneReport | null> {
  const urlScene = SCENE_MAP[sceneId];
  if (!urlScene) {
    console.log(`[phase0] skipping unknown scene: ${sceneId}`);
    return null;
  }
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("console", (msg: { text(): string; type(): string }) => {
    const text = msg.text();
    if (text.startsWith("[phase0]") || msg.type() === "error") {
      console.log(`[page:${msg.type()}] ${text}`);
    }
  });

  const url = clodUrl({
    scene: urlScene,
    seed: 12345,
    hud: true,
    freeze: true,
    extra: { world: String(sceneConfig.world) },
  });
  console.log(`[phase0] ${urlScene} -> ${url}`);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
      undefined,
      { timeout: 120000, polling: 250 },
    );

    const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
    if (error) {
      console.error(`[phase0] ${urlScene} error: ${error}`);
      return null;
    }

    await page.evaluate(async (frames: number) => window.__drusnielClod?.settle?.(frames), 8);

    const report = await page.evaluate(() => {
      const r = window.__drusnielPhase0Report;
      return r ? JSON.parse(JSON.stringify(r)) as Phase0SceneReport : null;
    });

    if (!report) {
      console.error(`[phase0] ${urlScene}: no __drusnielPhase0Report`);
      return null;
    }

    mkdirSync(outDir, { recursive: true });
    const shotPath = resolve(outDir, `${urlScene}.png`);
    await page.screenshot({ path: shotPath });
    const jsonPath = resolve(outDir, `${urlScene}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    return report;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(RUN_DIR, timestamp);
  mkdirSync(outDir, { recursive: true });

  console.log("Phase 0 CLOD PoC Long-View Baseline\n");

  const { browser } = await launchWebGPU();
  const reports: Phase0SceneReport[] = [];
  const acceptances: Phase0AcceptanceResult[] = [];

  try {
    for (const [sceneId, sceneConfig] of Object.entries(config.phase0.scenes)) {
      const report = await runScene(browser, sceneId, sceneConfig, outDir);
      if (report) {
        reports.push(report);
        acceptances.push(summarizeAcceptance({
          metrics: report.metrics,
          config,
          sceneName: report.scene,
        }));
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Print table.
  const hdr = `${padR("Scene", 30)} ${padL("Target", 8)} ${padL("Effective", 10)} ${padL("Met", 5)} ${padL("FarTris", 10)} ${padL("MissPg", 8)} ${padL("P95", 8)} ${padL("Pass", 5)}`;
  console.log(hdr);
  console.log("-".repeat(hdr.length));

  const summaryRows: Record<string, unknown>[] = [];
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const a = acceptances[i];
    const m = r.metrics;
    const target = Number(m["target_visible_m"] ?? 0);
    const effective = Number(m["effective_visible_m"] ?? 0);
    const met = a.visible_target_met;
    const farTris = Number(m["far_shell_tris"] ?? 0);
    const missPg = Number(m["streamer_simulated_missing_pages"] ?? 0);
    const p95 = Number(m["frame_ms_p95"] ?? -1);
    console.log(
      `${padR(r.scene, 30)} ${padL(String(target), 8)} ${padL(String(effective), 10)} ${padL(met ? "YES" : "NO", 5)} ${padL(String(farTris), 10)} ${padL(String(missPg), 8)} ${padL(p95 >= 0 ? p95.toFixed(1) : "n/a", 8)} ${padL(a.passed ? "YES" : "NO", 5)}`,
    );
    summaryRows.push({
      scene: r.scene,
      target_visible_m: target,
      effective_visible_m: effective,
      visible_target_met: met,
      far_shell_tris: farTris,
      missing_pages: missPg,
      frame_ms_p95: p95,
      acceptance: {
        passed: a.passed,
        horizon_hole_ratio_ok: a.horizon_hole_ratio_ok,
        streamer_missing_chunks_ok: a.streamer_missing_chunks_ok,
        streamer_missing_pages_ok: a.streamer_missing_pages_ok,
        all_counters_present: a.all_counters_present,
        missing_counters: a.missing_counters,
      },
    });
  }

  const allPassed = acceptances.every((a) => a.passed);
  const anyFailedVisibility = acceptances.some((a) => !a.visible_target_met);
  const result = allPassed
    ? (anyFailedVisibility
      ? "BASELINE_RECORDED_WITH_EXPECTED_FAILURES"
      : "ALL_TARGETS_MET")
    : "BASELINE_RECORDED_WITH_FAILURES";

  console.log(`\nResult: ${result}`);

  // Print acceptance details for failures.
  for (const a of acceptances) {
    if (!a.passed) {
      console.log(`\n  ${a.scene} FAILED:`);
      if (!a.all_counters_present) console.log(`    missing counters: ${a.missing_counters.join(", ")}`);
      if (!a.horizon_hole_ratio_ok) console.log(`    horizon_hole_ratio check failed`);
      if (!a.streamer_missing_chunks_ok) console.log(`    streamer simulated missing chunks > 0`);
      if (!a.streamer_missing_pages_ok) console.log(`    streamer simulated missing pages > 0`);
    }
  }

  const summary = {
    timestamp,
    result,
    scenes: summaryRows,
    config: {
      target_visible_m: config.phase0.target_visible_m,
      allow_current_4km_failure: config.acceptance.allow_current_4km_failure,
      max_horizon_hole_ratio: config.acceptance.max_horizon_hole_ratio,
      max_streamer_simulated_missing_chunks: config.acceptance.max_streamer_simulated_missing_chunks,
      max_streamer_simulated_missing_pages: config.acceptance.max_streamer_simulated_missing_pages,
    },
  };
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nReports written to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error("[phase0] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
