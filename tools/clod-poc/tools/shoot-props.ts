import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { launchWebGPU, clodUrl } from "./launch.js";
import {
  validatePropShotStats,
  type PropAcceptanceConfig,
} from "../src/props/prop_acceptance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = yaml.load(
  readFileSync(join(ROOT, "config/custom_props_acceptance.yaml"), "utf8"),
) as PropAcceptanceConfig;

const BENCH_SCENES = ["500", "5000", "20000"] as const;

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

async function shootScene(
  tier: string,
  args: Args,
): Promise<{ stats: Record<string, unknown>; out: string; statsOut: string }> {
  const width = Number(str(args["w"]) ?? 1920);
  const height = Number(str(args["h"]) ?? 1080);
  const settleFrames = Number(str(args["settle"]) ?? 24);
  const timeoutMs = Number(str(args["timeout"]) ?? 180000);
  const outDir = str(args["outDir"]) ?? "shots/props";
  const out = join(outDir, `bench-${tier}.png`);
  const statsOut = join(outDir, `bench-${tier}-stats.json`);

  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("console", (msg: { text(): string; type(): string }) => {
      const text = msg.text();
      if (text.startsWith("[clod-poc]") || text.startsWith("[custom-props]") || msg.type() === "error") {
        console.log(`[page:${msg.type()}] ${text}`);
      }
    });
    page.on("pageerror", (error: Error) => console.error("[pageerror]", error.message));

    const url = clodUrl({
      extra: {
        customProps: "1",
        customPropScene: tier,
        world: str(args["world"]) ?? "8",
        freeze: "1",
        hud: args["hud"] === false || args["hud"] === "0" ? "0" : "1",
      },
    });
    console.log(`[shoot-props] ${url} -> ${out}`);

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
      undefined,
      { timeout: timeoutMs, polling: 250 },
    );

    const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
    if (error) throw new Error(`App reported fatal error:\n${error}`);

    await page.evaluate(async (frames: number) => window.__drusnielClod?.settle?.(frames), settleFrames);

    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    const statsText = await page.evaluate(() => {
      const hooks = window.__drusnielClod;
      return JSON.stringify({
        ready: hooks?.ready ?? false,
        error: hooks ? hooks.error ?? null : "missing hooks",
        ...(hooks?.stats ?? {}),
      }, null, 2);
    });
    writeFileSync(statsOut, statsText);
    console.log(`[shoot-props] wrote ${out} and ${statsOut}`);
    return { stats: JSON.parse(statsText) as Record<string, unknown>, out, statsOut };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const only = str(args["scene"]);
  const scenes = only ? [only] : [...BENCH_SCENES];
  const failures: string[] = [];

  for (const tier of scenes) {
    const { stats, statsOut } = await shootScene(tier, args);
    const shotFailures = validatePropShotStats(tier, {
      frameMs: stats["frameMs"] as number | undefined,
      counters: stats["counters"] as Record<string, number> | undefined,
    }, ACCEPTANCE);
    if (shotFailures.length > 0) {
      for (const f of shotFailures) {
        failures.push(`${tier}: ${f.metric}=${f.actual} expected ${f.expected}`);
      }
    } else {
      console.log(`[shoot-props] ${tier} acceptance OK (${statsOut})`);
    }
  }

  if (failures.length > 0) {
    console.error("[shoot-props] acceptance failures:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("[shoot-props] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
