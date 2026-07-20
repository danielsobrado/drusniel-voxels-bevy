import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  deriveWaterPixelMask,
  measureFoamImage,
  measureFoamLighting,
  measureFoamTemporal,
  type PixelMask,
  type RgbaImage,
} from "./water-foam-visual-metrics.js";
import type {
  WaterFoamReferenceManifest,
  WaterFoamReferenceScene,
  WaterFoamReferenceSourceKind,
} from "./water-foam-reference-manifest.js";

interface CliArgs {
  readonly input: string;
  readonly out: string;
  readonly sourceKind: WaterFoamReferenceSourceKind;
  readonly repository: string;
  readonly commit: string;
  readonly renderer: string;
  readonly capturedAt: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputRoot = resolve(args.input);
  const rapid = await recordScene(inputRoot, "rapid", true);
  const smoothRiver = await recordScene(inputRoot, "smooth-river", false);
  const lakeShore = await recordScene(inputRoot, "lake-shore", false);
  const manifest: WaterFoamReferenceManifest = {
    schemaVersion: 1,
    source: {
      kind: args.sourceKind,
      repository: args.repository,
      commit: args.commit,
      renderer: args.renderer,
      capturedAt: args.capturedAt,
    },
    scenes: { rapid, smoothRiver, lakeShore },
  };
  const output = resolve(args.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`water foam reference manifest: ${output}`);
}

async function recordScene(
  inputRoot: string,
  folder: string,
  temporalAndLighting: boolean,
): Promise<WaterFoamReferenceScene> {
  const sceneRoot = join(inputRoot, folder);
  const foamAPath = requiredFile(sceneRoot, "foam-a.png");
  const foamA = await loadRgba(foamAPath);
  const waterMask = await loadWaterMask(sceneRoot, foamA);
  const files = {
    waterMaskSha256: sha256(waterMask.data),
    foamASha256: sha256(readFileSync(foamAPath)),
  } as {
    waterMaskSha256: string;
    foamASha256: string;
    foamBSha256?: string;
    finalSha256?: string;
  };
  if (!temporalAndLighting) {
    return {
      width: foamA.width,
      height: foamA.height,
      image: measureFoamImage(foamA, waterMask),
      files,
    };
  }

  const foamBPath = requiredFile(sceneRoot, "foam-b.png");
  const finalPath = requiredFile(sceneRoot, "final.png");
  const foamB = await loadRgba(foamBPath);
  const finalImage = await loadRgba(finalPath);
  files.foamBSha256 = sha256(readFileSync(foamBPath));
  files.finalSha256 = sha256(readFileSync(finalPath));
  return {
    width: foamA.width,
    height: foamA.height,
    image: measureFoamImage(foamA, waterMask),
    temporal: measureFoamTemporal(foamA, foamB, waterMask),
    lighting: measureFoamLighting(finalImage, foamB, waterMask),
    files,
  };
}

async function loadWaterMask(sceneRoot: string, foamA: RgbaImage): Promise<PixelMask> {
  const explicitPath = join(sceneRoot, "water-mask.png");
  if (existsSync(explicitPath)) {
    const image = await loadRgba(explicitPath);
    assertSameDimensions(image, foamA, "explicit water mask");
    const data = new Uint8Array(image.width * image.height);
    for (let pixel = 0; pixel < data.length; pixel++) {
      const offset = pixel * image.channels;
      const r = image.data[offset] ?? 0;
      const g = image.data[offset + 1] ?? 0;
      const b = image.data[offset + 2] ?? 0;
      data[pixel] = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255 >= 0.5 ? 1 : 0;
    }
    requireWaterPixels(data, sceneRoot);
    return { data, width: image.width, height: image.height };
  }

  const bodyMask = await loadRgba(requiredFile(sceneRoot, "body-mask.png"));
  const depth = await loadRgba(requiredFile(sceneRoot, "depth.png"));
  const mask = deriveWaterPixelMask(bodyMask, depth, foamA);
  requireWaterPixels(mask.data, sceneRoot);
  return mask;
}

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (const item of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(item);
    if (!match) throw new Error(`invalid argument: ${item}; expected --name=value`);
    values.set(match[1]!, match[2]!);
  }
  const sourceKind = requiredArg(values, "source-kind");
  if (sourceKind !== "fable5-world-demo" && sourceKind !== "drusniel-clod-poc") {
    throw new Error("--source-kind must be fable5-world-demo or drusniel-clod-poc");
  }
  const commit = requiredArg(values, "commit");
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("--commit must be a 40-character Git SHA");
  const capturedAt = values.get("captured-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error("--captured-at must be ISO-8601");
  return {
    input: requiredArg(values, "input"),
    out: requiredArg(values, "out"),
    sourceKind,
    repository: requiredArg(values, "repository"),
    commit,
    renderer: requiredArg(values, "renderer"),
    capturedAt,
  };
}

function requiredArg(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`missing required --${name}=... argument`);
  return value;
}

function requiredFile(root: string, name: string): string {
  const path = join(root, name);
  if (!existsSync(path)) throw new Error(`missing required foam evidence file: ${path}`);
  return path;
}

function requireWaterPixels(mask: Uint8Array, label: string): void {
  let count = 0;
  for (const value of mask) count += value !== 0 ? 1 : 0;
  if (count < 1_000) throw new Error(`${label} water mask has ${count} pixels; at least 1000 are required`);
}

function assertSameDimensions(a: RgbaImage, b: RgbaImage, label: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`${label} dimensions ${a.width}x${a.height} do not match foam ${b.width}x${b.height}`);
  }
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
