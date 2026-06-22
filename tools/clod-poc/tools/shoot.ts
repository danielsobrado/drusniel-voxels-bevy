import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const width = Number(str(args["w"]) ?? 1920);
  const height = Number(str(args["h"]) ?? 1080);
  const scene = str(args["scene"]) ?? "sanity";
  const out = str(args["out"]) ?? `shots/phase-0/${scene}-${Date.now()}.png`;
  const settleFrames = Number(str(args["settle"]) ?? 8);
  const timeoutMs = Number(str(args["timeout"]) ?? 120000);

  const consumed = new Set([
    "scene", "seed", "cam", "out", "w", "h", "hud", "settle", "timeout", "stats",
    "framealign", "gpusample", "freeze",
  ]);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!consumed.has(key)) extra[key] = value === true ? "1" : String(value);
  }

  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[clod-poc]") || text.startsWith("[phase0]") || msg.type() === "error" || msg.type() === "warning") {
      console.log(`[page:${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));

  const url = clodUrl({
    scene,
    seed: args["seed"] !== undefined ? Number(str(args["seed"])) : undefined,
    cam: str(args["cam"]),
    hud: args["hud"] === true || args["hud"] === "1",
    freeze: args["freeze"] === true || args["freeze"] === "1",
    extra,
  });
  console.log(`[shoot] ${url} -> ${out}`);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const start = Date.now();
  await page.waitForFunction(
    () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
    undefined,
    { timeout: timeoutMs, polling: 250 },
  ).catch(async () => {
    const progress = await page.evaluate(() => {
      const hooks = window.__drusnielClod;
      return hooks ? `${hooks.progressMsg} (${hooks.progress})` : "no hooks";
    });
    throw new Error(`Timed out waiting for ready; last progress: ${progress}`);
  });

  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) {
    const failedOut = out.replace(/\.png$/i, "-FAILED.png");
    mkdirSync(dirname(failedOut), { recursive: true });
    await page.screenshot({ path: failedOut });
    throw new Error(`App reported fatal error:\n${error}`);
  }
  console.log(`[shoot] ready in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  await page.evaluate(async (frames) => window.__drusnielClod?.settle?.(frames), settleFrames);

  const frameAlign = str(args["framealign"]);
  if (frameAlign !== undefined) {
    const target = ((Number(frameAlign) % 1024) + 1024) % 1024;
    await page.evaluate(async (targetFrame) => {
      const hooks = window.__drusnielClod;
      if (!hooks?.settle || !hooks.stats) return;
      for (let guard = 0; guard < 1100; guard++) {
        if (hooks.stats.frame % 1024 === targetFrame) break;
        await hooks.settle(1);
      }
    }, target);
    const frame = await page.evaluate(() => window.__drusnielClod?.stats?.frame ?? -1);
    console.log(`[shoot] frame-aligned at ${frame} (mod 1024 = ${frame % 1024})`);
  }

  const gpuSamples = Number(str(args["gpusample"]) ?? 0);
  if (gpuSamples > 0) {
    const samples: number[] = [];
    for (let i = 0; i < gpuSamples; i++) {
      await page.evaluate(async () => window.__drusnielClod?.settle?.(12));
      const passes = await page.evaluate(() => window.__drusnielClod?.stats?.gpuPasses ?? {});
      const total = (passes["render"] ?? 0) + (passes["compute"] ?? 0);
      if (total > 0) samples.push(total);
    }
    samples.sort((a, b) => a - b);
    console.log(`[shoot] gpu median=${(samples[Math.floor(samples.length / 2)] ?? 0).toFixed(2)}ms over ${samples.length} samples`);
  }

  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  const stats = await page.evaluate(() => {
    const hooks = window.__drusnielClod;
    return JSON.stringify({
      ready: hooks?.ready ?? false,
      error: hooks ? hooks.error ?? null : "missing hooks",
      diag: hooks?.diag ?? null,
      ...(hooks?.stats ?? {}),
    }, null, 2);
  });
  console.log(`[stats] ${stats}`);
  const statsOut = str(args["stats"]);
  if (statsOut) {
    mkdirSync(dirname(statsOut), { recursive: true });
    writeFileSync(statsOut, stats);
  }

  await browser.close();
  console.log(`[shoot] wrote ${out}`);
}

main().catch((error: unknown) => {
  console.error("[shoot] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
