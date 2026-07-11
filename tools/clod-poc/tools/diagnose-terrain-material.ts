import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import { clodBaseUrl, launchWebGPU } from "./launch.js";
import type {
  TerrainDiagnosticFinding,
  TerrainMaterialDiagnosticSnapshot,
} from "../src/terrain/material/terrain_material_diagnostics.js";

type Args = Record<string, string | boolean>;

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SETTLE_FRAMES = 48;
const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 900;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      index++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function stringArg(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: string | boolean | undefined, fallback: number): number {
  const parsed = Number(stringArg(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function buildDiagnosticUrl(rawUrl: string): URL {
  const url = new URL(rawUrl, clodBaseUrl());
  if (!url.searchParams.has("scene")) url.searchParams.set("scene", "infinite-islands");
  if (!url.searchParams.has("seed")) url.searchParams.set("seed", "1");

  // The far shell and far clipmap are independent renderers. The diagnosis must
  // sample only the near CLOD material path or the result is ambiguous.
  const forced: Record<string, string> = {
    farShell: "0",
    farClipmap: "0",
    materialTiers: "0",
    clodPerf: "0",
    terrainMaterial: "procedural",
    proceduralDebug: "final",
    webgpuSelection: "1",
    canopy: "0",
    hud: "0",
    freeze: "1",
  };
  for (const [key, value] of Object.entries(forced)) url.searchParams.set(key, value);
  return url;
}

async function waitForReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = (window as typeof window & {
        __drusnielClod?: { ready?: boolean; error?: string | null };
      }).__drusnielClod;
      return Boolean(hooks?.ready || hooks?.error);
    },
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );

  const error = await page.evaluate(() => (
    window as typeof window & { __drusnielClod?: { error?: string | null } }
  ).__drusnielClod?.error ?? null);
  if (error) throw new Error(`CLOD runtime reported a fatal error: ${error}`);
}

async function settle(page: Page, frames: number): Promise<void> {
  await page.evaluate(async (settleFrames) => {
    const hooks = (window as typeof window & {
      __drusnielClod?: { settle?: (frames: number) => Promise<void> | void };
    }).__drusnielClod;
    await hooks?.settle?.(settleFrames);
  }, frames);
}

async function readSnapshot(page: Page, timeoutMs: number): Promise<TerrainMaterialDiagnosticSnapshot> {
  await page.waitForFunction(
    () => Boolean((window as typeof window & {
      __drusnielTerrainMaterialDiagnostics?: { snapshot?: () => unknown };
    }).__drusnielTerrainMaterialDiagnostics?.snapshot),
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );

  return await page.evaluate(() => {
    const diagnostics = (window as typeof window & {
      __drusnielTerrainMaterialDiagnostics?: { snapshot(): TerrainMaterialDiagnosticSnapshot };
    }).__drusnielTerrainMaterialDiagnostics;
    if (!diagnostics) throw new Error("terrain material diagnostics hook is missing");
    return diagnostics.snapshot();
  });
}

function renderMarkdown(
  snapshot: TerrainMaterialDiagnosticSnapshot,
  screenshotPath: string,
  consoleMessages: readonly string[],
): string {
  const lines: string[] = [
    "# Near CLOD Terrain Material Diagnosis",
    "",
    `Generated: ${snapshot.generatedAt}`,
    "",
    `URL: \`${snapshot.url}\``,
    "",
    `Screenshot: \`${screenshotPath}\``,
    "",
    "## Verdict",
    "",
  ];

  for (const finding of snapshot.findings) {
    lines.push(`- **${finding.severity.toUpperCase()} ${finding.code}** — ${finding.message}`);
  }

  lines.push(
    "",
    "## Material",
    "",
    "| Field | Value |",
    "|---|---:|",
    `| Backend | ${snapshot.backend} |`,
    `| Near CLOD isolated | ${snapshot.isolatedNearClod} |`,
    `| Source | ${snapshot.material.source} |`,
    `| Textures active | ${snapshot.material.texturesActive} |`,
    `| Triplanar | ${snapshot.material.triplanar} |`,
    `| Biome splat | ${snapshot.material.biomeSplat} |`,
    `| Texture scale control | ${snapshot.material.textureScale} |`,
    `| Blend mode | ${snapshot.material.blendMode} |`,
    `| Blend width | ${snapshot.material.blendWidth.toFixed(2)} m |`,
    `| Albedo array | ${formatTexture(snapshot.textures.albedo)} |`,
    `| Normal array | ${formatTexture(snapshot.textures.normal)} |`,
    "",
    "## Visible CLOD Samples",
    "",
    "| Field | Value |",
    "|---|---:|",
    `| Visible pages | ${snapshot.visible.pageCount} |`,
    `| Source vertices | ${snapshot.visible.vertexCount.toLocaleString()} |`,
    `| Sampled vertices | ${snapshot.visible.sampledVertices.toLocaleString()} |`,
    `| Height range | ${formatRange(snapshot.visible.heightMin, snapshot.visible.heightMax, "m")} |`,
    `| Height span | ${snapshot.visible.heightSpan.toFixed(2)} m |`,
    `| Dominant layer | ${snapshot.visible.dominantLayer ?? "none"} |`,
    `| Dominant ratio | ${(snapshot.visible.dominantLayerRatio * 100).toFixed(1)}% |`,
    `| Nearest-band fallback | ${(snapshot.visible.nearestFallbackRatio * 100).toFixed(1)}% |`,
    "",
    "### Biome histogram",
    "",
    "```json",
    JSON.stringify(snapshot.visible.biomeHistogram, null, 2),
    "```",
    "",
    "### Selected layer histogram",
    "",
    "```json",
    JSON.stringify(snapshot.visible.selectedLayerHistogram, null, 2),
    "```",
    "",
    "## Texture Slots",
    "",
    "| # | Name | ID | Height | Base scale | Resolved scale | Repeat period |",
    "|---:|---|---|---:|---:|---:|---:|",
  );

  for (const slot of snapshot.slots) {
    lines.push(
      `| ${slot.index} | ${slot.name} | ${slot.selectedId} | ${slot.heightMin.toFixed(1)}–${slot.heightMax.toFixed(1)} m | ${slot.baseScale.toFixed(4)} | ${slot.resolvedScale.toFixed(4)} | ${slot.repeatPeriodM.toFixed(2)} m |`,
    );
  }

  lines.push(
    "",
    "## Biome Layer Sets",
    "",
    "| Biome | Layers | Names |",
    "|---:|---|---|",
  );
  for (const set of snapshot.biomeLayerSets) {
    lines.push(`| ${set.biomeId} | ${set.layers.join(", ")} | ${set.names.join(" / ")} |`);
  }

  if (consoleMessages.length > 0) {
    lines.push(
      "",
      "## Browser Warnings and Errors",
      "",
      "```text",
      ...consoleMessages,
      "```",
    );
  }
  lines.push("");
  return lines.join("\n");
}

function formatTexture(texture: TerrainMaterialDiagnosticSnapshot["textures"]["albedo"]): string {
  if (!texture) return "missing";
  return `${texture.width}×${texture.height}×${texture.depth}, mipmaps=${texture.mipmaps}`;
}

function formatRange(min: number | null, max: number | null, unit: string): string {
  if (min === null || max === null) return "n/a";
  return `${min.toFixed(2)}–${max.toFixed(2)} ${unit}`;
}

function printFinding(finding: TerrainDiagnosticFinding): void {
  const prefix = finding.severity === "error"
    ? "ERROR"
    : finding.severity === "warning"
      ? "WARN"
      : "INFO";
  console.log(`[terrain:diagnose] ${prefix} ${finding.code}: ${finding.message}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rawUrl = stringArg(args.url) ?? clodBaseUrl();
  const url = buildDiagnosticUrl(rawUrl);
  const timeoutMs = numberArg(args.timeout, DEFAULT_TIMEOUT_MS);
  const settleFrames = numberArg(args.settle, DEFAULT_SETTLE_FRAMES);
  const width = numberArg(args.w, DEFAULT_WIDTH);
  const height = numberArg(args.h, DEFAULT_HEIGHT);
  const outputDir = stringArg(args.out) ?? join("artifacts", "terrain-diagnostics", timestamp());
  const screenshotPath = join(outputDir, "near-clod-final.png");
  const jsonPath = join(outputDir, "report.json");
  const markdownPath = join(outputDir, "report.md");
  const consoleMessages: string[] = [];

  mkdirSync(outputDir, { recursive: true });
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() !== "warning" && message.type() !== "error") return;
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleMessages.push(`[pageerror] ${error.message}`));

    console.log(`[terrain:diagnose] loading isolated near CLOD path: ${url}`);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForReady(page, timeoutMs);
    await settle(page, settleFrames);
    const snapshot = await readSnapshot(page, timeoutMs);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    writeFileSync(jsonPath, JSON.stringify({ snapshot, consoleMessages }, null, 2));
    writeFileSync(markdownPath, renderMarkdown(snapshot, screenshotPath, consoleMessages));

    for (const finding of snapshot.findings) printFinding(finding);
    console.log(`[terrain:diagnose] JSON: ${jsonPath}`);
    console.log(`[terrain:diagnose] report: ${markdownPath}`);
    console.log(`[terrain:diagnose] screenshot: ${screenshotPath}`);

    const hasError = snapshot.findings.some((finding) => finding.severity === "error");
    const hasWarning = snapshot.findings.some((finding) => finding.severity === "warning");
    if (hasError || (args.strict === true && hasWarning)) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[terrain:diagnose] FAILED: ${message}`);
  process.exit(1);
});
