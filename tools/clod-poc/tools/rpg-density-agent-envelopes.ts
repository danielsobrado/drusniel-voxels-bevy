/**
 * D5 scaffolding: sweep synthetic agent envelopes at village center.
 *
 * Usage (dev server must be running; never through rtk):
 *   npm --prefix tools/clod-poc run perf:rpg-agent-envelopes
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { launchWebGPU } from "./launch.js";

type Args = Record<string, string | boolean>;

interface AgentSweepCase {
  readonly name: string;
  readonly agentCount: number;
  readonly agentSkin: "0" | "1";
}

interface AgentSweepResult {
  readonly name: string;
  readonly url: string;
  readonly frameMsP50: number;
  readonly frameMsP95: number;
  readonly renderMsP95: number;
  readonly counters: Record<string, number>;
  readonly errors: readonly string[];
}

const AGENT_COUNTS = [0, 10, 25, 50, 100] as const;
const WARMUP_FRAMES = 120;
const SAMPLE_FRAMES = 120;
const READY_TIMEOUT_MS = 360_000;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function buildCases(): AgentSweepCase[] {
  const cases: AgentSweepCase[] = [];
  for (const skin of ["0", "1"] as const) {
    for (const agentCount of AGENT_COUNTS) {
      cases.push({
        name: `agents-${agentCount}-skin-${skin}`,
        agentCount,
        agentSkin: skin,
      });
    }
  }
  return cases;
}

function buildUrl(baseUrl: string, sweepCase: AgentSweepCase): string {
  const url = new URL(baseUrl);
  url.searchParams.set("scene", "rpg-village");
  url.searchParams.set("seed", "1337");
  url.searchParams.set("world", "32");
  url.searchParams.set("startupWorld", "2");
  url.searchParams.set("freeze", "0");
  url.searchParams.set("agentEnvelope", "1");
  url.searchParams.set("agentCount", String(sweepCase.agentCount));
  url.searchParams.set("agentSkin", sweepCase.agentSkin);
  url.searchParams.set("perfProbe", "1");
  url.searchParams.set("perfWarmupFrames", String(WARMUP_FRAMES));
  url.searchParams.set("perfSampleFrames", String(SAMPLE_FRAMES));
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function counter(snapshot: { counters: Record<string, number> }, key: string): number {
  return snapshot.counters[key] ?? 0;
}

function markdown(results: readonly AgentSweepResult[]): string {
  const lines = [
    "# RPG dense agent envelopes (D5 scaffolding)",
    "",
    "| case | frame p50 | frame p95 | render p95 | agents_total | agent_draws | agent_anim_ms | agents_full | agent_sim_ms | agent_terrain_query_ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.name} | ${result.frameMsP50.toFixed(2)} | ${result.frameMsP95.toFixed(2)} | ${result.renderMsP95.toFixed(2)} | ` +
        `${counter(result, "agents_total")} | ${counter(result, "agent_draws")} | ${counter(result, "agent_anim_ms").toFixed(2)} | ` +
        `${counter(result, "agents_full")} | ${counter(result, "agent_sim_ms").toFixed(2)} | ${counter(result, "agent_terrain_query_ms").toFixed(2)} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function runCase(browser: Browser, baseUrl: string, sweepCase: AgentSweepCase): Promise<AgentSweepResult> {
  const url = buildUrl(baseUrl, sweepCase);
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    console.log(`[rpg-agent-envelopes] ${sweepCase.name}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < READY_TIMEOUT_MS) {
      const state = await page.evaluate(`(function(){
        var clod = window.__drusnielClod;
        var perf = window.__drusnielPerf;
        return {
          clodReady: !!(clod && clod.ready),
          clodError: clod ? clod.error : null,
          perfReady: !!(perf && perf.ready),
          sampleCount: perf && perf.snapshot ? (perf.snapshot().sampleCount || 0) : 0,
          progress: clod ? clod.progressMsg : null
        };
      })()`) as {
        clodReady: boolean;
        clodError: string | null;
        perfReady: boolean;
        sampleCount: number;
        progress: string | null;
      };
      if (state.clodError) throw new Error(state.clodError);
      if (state.perfReady) break;
      if (Date.now() - lastLog >= 5000) {
        lastLog = Date.now();
        console.log(
          `[rpg-agent-envelopes] ${sweepCase.name}: waiting (clod=${state.clodReady}, samples=${state.sampleCount}, ${state.progress ?? "no progress"})`,
        );
      }
      await delay(250);
    }
    const snapshot = await page.evaluate(`(function(){
      var perf = window.__drusnielPerf;
      var clod = window.__drusnielClod;
      var snap = perf && perf.snapshot ? perf.snapshot() : null;
      var live = (clod && clod.stats && clod.stats.counters) ? clod.stats.counters : {};
      return { snap: snap, live: live };
    })()`) as {
      snap: {
        ready: boolean;
        metrics: { frameMs: { p50: number; p95: number }; renderMs: { p95: number } };
        counters: Record<string, number>;
      } | null;
      live: Record<string, number>;
    };
    if (!snapshot.snap?.ready) throw new Error(`Perf probe not ready for ${sweepCase.name}`);
    const c = snapshot.snap.counters;
    const live = snapshot.live;
    return {
      name: sweepCase.name,
      url,
      frameMsP50: snapshot.snap.metrics.frameMs.p50,
      frameMsP95: snapshot.snap.metrics.frameMs.p95,
      renderMsP95: snapshot.snap.metrics.renderMs.p95,
      counters: {
        agents_total: c.agentsTotalAvg ?? live.agents_total ?? 0,
        agent_draws: c.agentDrawsAvg ?? live.agent_draws ?? 0,
        agent_anim_ms: c.agentAnimMsAvg ?? live.agent_anim_ms ?? 0,
        agents_full: c.agentsFullAvg ?? live.agents_full ?? 0,
        agents_mid: c.agentsMidAvg ?? live.agents_mid ?? 0,
        agents_frozen: c.agentsFrozenAvg ?? live.agents_frozen ?? 0,
        agent_sim_ms: c.agentSimMsAvg ?? live.agent_sim_ms ?? 0,
        agent_terrain_query_ms: c.agentTerrainQueryMsAvg ?? live.agent_terrain_query_ms ?? 0,
        wd_agents_full: c.wdAgentsFullAvg ?? live.wd_agents_full ?? 0,
        wd_agents_mid: c.wdAgentsMidAvg ?? live.wd_agents_mid ?? 0,
        wd_agents_frozen: c.wdAgentsFrozenAvg ?? live.wd_agents_frozen ?? 0,
      },
      errors,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = str(args["baseUrl"]) ?? process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
  const outDir = str(args["out"]) ?? "perf-runs/rpg-dense-agents";
  mkdirSync(outDir, { recursive: true });

  const { browser } = await launchWebGPU();
  try {
    const results: AgentSweepResult[] = [];
    for (const sweepCase of buildCases()) {
      results.push(await runCase(browser, baseUrl, sweepCase));
      writeFileSync(join(outDir, `${sweepCase.name}.json`), JSON.stringify(results[results.length - 1], null, 2));
    }
    const summary = { cases: results };
    writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(join(outDir, "summary.md"), markdown(results));
    console.log(`[rpg-agent-envelopes] wrote ${join(outDir, "summary.md")}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
