import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

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

async function sideBySide(aPath: string, bPath: string, outPath: string): Promise<void> {
  const [aMeta, bMeta] = await Promise.all([sharp(aPath).metadata(), sharp(bPath).metadata()]);
  const targetHeight = Math.min(1080, Math.max(1, aMeta.height ?? bMeta.height ?? 1080));
  const aWidth = Math.max(1, Math.round(((aMeta.width ?? 1) * targetHeight) / (aMeta.height ?? 1)));
  const bWidth = Math.max(1, Math.round(((bMeta.width ?? 1) * targetHeight) / (bMeta.height ?? 1)));
  const gutter = 12;
  const [aBuffer, bBuffer] = await Promise.all([
    sharp(aPath).resize(aWidth, targetHeight).png().toBuffer(),
    sharp(bPath).resize(bWidth, targetHeight).png().toBuffer(),
  ]);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: aWidth + gutter + bWidth,
      height: targetHeight,
      channels: 3,
      background: { r: 10, g: 12, b: 11 },
    },
  })
    .composite([
      { input: aBuffer, left: 0, top: 0 },
      { input: bBuffer, left: aWidth + gutter, top: 0 },
    ])
    .png()
    .toFile(outPath);
  console.log(`[compare] wrote ${outPath} (ours left, reference right)`);
}

async function samplePixels(path: string, px: string): Promise<void> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  for (const pair of px.split(";")) {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= info.width || y >= info.height) {
      console.log(`[compare] (${pair}) out of bounds`);
      continue;
    }
    const idx = (Math.floor(y) * info.width + Math.floor(x)) * info.channels;
    console.log(`[compare] (${x},${y}) rgb(${data[idx] ?? 0},${data[idx + 1] ?? 0},${data[idx + 2] ?? 0})`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sample = str(args["sample"]);
  if (sample) {
    await samplePixels(sample, str(args["px"]) ?? "");
    return;
  }
  const a = str(args["a"]);
  const b = str(args["b"]);
  const out = str(args["out"]) ?? "shots/phase-0/cmp_sanity_vs_scene1.png";
  if (!a || !b) throw new Error("need --a <ours.png> --b <reference.png> [--out <cmp.png>]");
  await sideBySide(a, b, out);
}

main().catch((error: unknown) => {
  console.error("[compare] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
