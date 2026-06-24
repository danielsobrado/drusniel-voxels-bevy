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
  acceptance: {
    allow_current_4km_failure: boolean;
    [k: string]: unknown;
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

  try {
    for (const [sceneId, sceneConfig] of Object.entries(config.phase0.scenes)) {
      const report = await runScene(browser, sceneId, sceneConfig, outDir);
      if (report) reports.push(report);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Print table.
  const hdr = `${padR("Scene", 30)} ${padL("Target", 8)} ${padL("Effective", 10)} ${padL("Met", 5)} ${padL("FarTris", 10)} ${padL("MissPg", 8)} ${padL("P95", 8)}`;
  console.log(hdr);
  console.log("-".repeat(hdr.length));

  const summaryRows: Record<string, unknown>[] = [];
  for (const r of reports) {
    const m = r.metrics;
    const target = Number(m["target_visible_m"] ?? 0);
    const effective = Number(m["effective_visible_m"] ?? 0);
    const met = m["visible_target_met"] === 1 || m["visible_target_met"] === true;
    const farTris = Number(m["far_shell_tris"] ?? 0);
    const missPg = Number(m["streamer_simulated_missing_pages"] ?? 0);
    const p95 = Number(m["frame_ms_p95"] ?? -1);
    console.log(
      `${padR(r.scene, 30)} ${padL(String(target), 8)} ${padL(String(effective), 10)} ${padL(met ? "YES" : "NO", 5)} ${padL(String(farTris), 10)} ${padL(String(missPg), 8)} ${padL(p95 >= 0 ? p95.toFixed(1) : "n/a", 8)}`,
    );
    summaryRows.push({
      scene: r.scene,
      target_visible_m: target,
      effective_visible_m: effective,
      visible_target_met: met,
      far_shell_tris: farTris,
      missing_pages: missPg,
      frame_ms_p95: p95,
    });
  }

  const allMet = reports.every((r) => {
    const met = r.metrics["visible_target_met"] === 1 || r.metrics["visible_target_met"] === true;
    return met || config.acceptance.allow_current_4km_failure;
  });
  const result = allMet
    ? (reports.some((r) => r.metrics["visible_target_met"] !== 1 && r.metrics["visible_target_met"] !== true)
      ? "BASELINE_RECORDED_WITH_EXPECTED_FAILURES"
      : "ALL_TARGETS_MET")
    : "BASELINE_RECORDED_WITH_FAILURES";

  console.log(`\nResult: ${result}`);

  const summary = {
    timestamp,
    result,
    scenes: summaryRows,
    config: {
      target_visible_m: config.phase0.target_visible_m,
      allow_current_4km_failure: config.acceptance.allow_current_4km_failure,
    },
  };
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nReports written to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error("[phase0] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
