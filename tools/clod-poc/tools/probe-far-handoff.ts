// Targeted far/near handoff ("two areas") convergence probe.
//
// Symptom under test: flat square-edged plateau pages around the streamed-root region —
// the far clipmap rendering placeholder/macro-fallback heights while far-summary tiles
// are still building. This probe boots (or attaches to) infinite-islands at a fixed
// camera pose and watches the authoritative counters until the placeholder area
// converges away:
//   far_summary_procedural_fallback_samples  (per frame; the flat area itself)
//   far_clipmap_pending_tiles                (tiles still waiting for heights)
//   far_clipmap_gpu_ownership_holes          (cells with no owner at all)
//
// Fast iteration: point --url at an already-running dev server to skip the boot cost.
//   npx tsx tools/probe-far-handoff.ts --url "http://127.0.0.1:5180/" [--timeout 180]
//     [--prc-max 0] [--sustain 3] [--out qa-runs/far-handoff/report.json]
// Exit code 1 when the scene does not converge inside the timeout.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { withWaterHarness, type WaterHarness } from "./water-harness.js";

interface FarHandoffSample {
  tMs: number;
  proceduralFallbackSamples: number;
  lowerRingFallbackSamples: number;
  conservativeFallbackSamples: number;
  farClipmapPendingTiles: number;
  farClipmapReadyTiles: number;
  farClipmapOwnershipHoles: number;
  farSummaryTilesReady: number;
  farSummaryTilesRequired: number;
  safetyReadyPages: number;
  safetyRequiredPages: number;
  // Root activation diagnostics: safety coverage counts pages covered by ACTIVE roots,
  // so slow activation (root switches) starves safety even when pages are cached.
  activeRootPages: number;
  applyQueuePages: number;
  rootSwitchesTotal: number;
  rootSwitchSuppressedFrames: number;
  streamPendingPages: number;
  safetyPendingPages: number;
  safetyInflightPages: number;
  scheduledPagesThisFrame: number;
}

const COUNTER_KEYS: Record<keyof Omit<FarHandoffSample, "tMs">, string> = {
  proceduralFallbackSamples: "far_summary_procedural_fallback_samples",
  lowerRingFallbackSamples: "far_summary_lower_ring_fallback_samples",
  conservativeFallbackSamples: "far_summary_conservative_fallback_samples",
  farClipmapPendingTiles: "far_clipmap_pending_tiles",
  farClipmapReadyTiles: "far_clipmap_ready_tiles",
  farClipmapOwnershipHoles: "far_clipmap_gpu_ownership_holes",
  farSummaryTilesReady: "far_summary_tiles_ready",
  farSummaryTilesRequired: "far_summary_tiles_required",
  safetyReadyPages: "live_clod_stream_safety_ready_pages",
  safetyRequiredPages: "live_clod_stream_safety_required_pages",
  activeRootPages: "live_clod_stream_active_root_pages",
  applyQueuePages: "live_clod_stream_apply_queue_pages",
  rootSwitchesTotal: "live_clod_stream_root_switches_total",
  rootSwitchSuppressedFrames: "live_clod_stream_root_switch_suppressed_frames",
  streamPendingPages: "live_clod_stream_pending_pages",
  safetyPendingPages: "live_clod_stream_safety_pending_pages",
  safetyInflightPages: "live_clod_stream_safety_inflight_pages",
  scheduledPagesThisFrame: "live_clod_stream_scheduled_pages_this_frame",
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const DEFAULT_POSE_URL =
  "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&hud=1&clodPerf=1&webgpuSelection=1" +
  "&farClipmap=1&farClipmapMode=replace&farClipmapShaderDisplacement=1&cam=1824,220,1780,3.1,-0.6,55";

async function sampleCounters(harness: WaterHarness): Promise<FarHandoffSample | null> {
  const raw = await harness.page
    .evaluate<Record<string, number> | null>(
      "(window.__drusnielClod && window.__drusnielClod.stats && window.__drusnielClod.stats.counters) || null",
    )
    .catch(() => null);
  if (!raw) return null;
  const sample = { tMs: 0 } as FarHandoffSample;
  for (const [field, counter] of Object.entries(COUNTER_KEYS) as Array<[keyof Omit<FarHandoffSample, "tMs">, string]>) {
    sample[field] = Number(raw[counter] ?? 0);
  }
  return sample;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Number(args.timeout ?? 180) * 1000;
  const prcMax = Number(args["prc-max"] ?? 0);
  const sustainRequired = Math.max(1, Number(args.sustain ?? 3));
  const pollMs = 500;
  const outPath = resolve(
    String(args.out ?? `qa-runs/far-handoff/far-handoff-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
  );

  // Attach to a running dev server (fast iteration). A bare origin gets the default
  // problem pose appended; a URL that already carries scene= is used verbatim.
  const base = String(args.url ?? "http://127.0.0.1:5180/");
  const url = base.includes("scene=")
    ? base
    : DEFAULT_POSE_URL.replace("http://127.0.0.1:5180/", base.endsWith("/") ? base : `${base}/`);

  const result = await withWaterHarness({ url }, async (harness) => {
    const t0 = Date.now();
    const timeline: FarHandoffSample[] = [];
    let sustained = 0;
    let convergedAtMs: number | null = null;
    while (Date.now() - t0 < timeoutMs) {
      const sample = await sampleCounters(harness);
      if (sample) {
        sample.tMs = Date.now() - t0;
        timeline.push(sample);
        const safetyConverged =
          sample.safetyRequiredPages > 0 && sample.safetyReadyPages >= sample.safetyRequiredPages;
        const converged =
          sample.proceduralFallbackSamples <= prcMax &&
          sample.farClipmapPendingTiles === 0 &&
          sample.farClipmapOwnershipHoles === 0 &&
          (!args["require-safety"] || safetyConverged);
        sustained = converged ? sustained + 1 : 0;
        process.stderr.write(
          `[far-handoff] t=${(sample.tMs / 1000).toFixed(1)}s prc=${sample.proceduralFallbackSamples} ` +
            `pending=${sample.farClipmapPendingTiles} holes=${sample.farClipmapOwnershipHoles} ` +
            `summary=${sample.farSummaryTilesReady}/${sample.farSummaryTilesRequired} ` +
            `safety=${sample.safetyReadyPages}/${sample.safetyRequiredPages} ` +
            `roots=${sample.activeRootPages} switches=${sample.rootSwitchesTotal} applyQ=${sample.applyQueuePages} ` +
            `inflight=${sample.streamPendingPages} sPend=${sample.safetyPendingPages} sInfl=${sample.safetyInflightPages} sched=${sample.scheduledPagesThisFrame}` +
            (converged ? ` (converged ${sustained}/${sustainRequired})` : "") +
            "\n",
        );
        if (sustained >= sustainRequired) {
          convergedAtMs = sample.tMs;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return { timeline, convergedAtMs };
  });

  const report = {
    ok: result.convergedAtMs !== null,
    convergedAtMs: result.convergedAtMs,
    criteria: { prcMax, sustainRequired, timeoutMs },
    finalSample: result.timeline[result.timeline.length - 1] ?? null,
    timeline: result.timeline,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, convergedAtMs: report.convergedAtMs, report: outPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
