import { statSync } from "node:fs";
import sharp from "sharp";

export interface ImageSanityInput {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

export interface ImageSanityResult {
  passed: boolean;
  failures: string[];
  width: number;
  height: number;
  meanLuma: number;
  rgbStddev: number;
  meanAlpha: number;
}

export function classifyImagePixels(input: ImageSanityInput): ImageSanityResult {
  const failures: string[] = [];
  const pixels = Math.max(0, input.width * input.height);
  if (pixels === 0 || input.channels < 3) {
    return {
      passed: false,
      failures: ["image has no RGB pixels"],
      width: input.width,
      height: input.height,
      meanLuma: 0,
      rgbStddev: 0,
      meanAlpha: 0,
    };
  }

  let lumaSum = 0;
  let alphaSum = 0;
  const means = [0, 0, 0];
  for (let i = 0; i < pixels; i++) {
    const base = i * input.channels;
    const r = input.data[base] ?? 0;
    const g = input.data[base + 1] ?? 0;
    const b = input.data[base + 2] ?? 0;
    means[0] += r;
    means[1] += g;
    means[2] += b;
    lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    alphaSum += input.channels >= 4 ? input.data[base + 3] ?? 255 : 255;
  }
  means[0] /= pixels;
  means[1] /= pixels;
  means[2] /= pixels;
  const meanLuma = lumaSum / pixels;
  const meanAlpha = alphaSum / pixels;

  let varianceSum = 0;
  for (let i = 0; i < pixels; i++) {
    const base = i * input.channels;
    for (let c = 0; c < 3; c++) {
      const delta = (input.data[base + c] ?? 0) - means[c]!;
      varianceSum += delta * delta;
    }
  }
  const rgbStddev = Math.sqrt(varianceSum / (pixels * 3));

  if (meanAlpha < 32) failures.push(`image is almost transparent: alpha=${meanAlpha.toFixed(1)}`);
  if (meanLuma < 5) failures.push(`image is almost black: luma=${meanLuma.toFixed(1)}`);
  if (rgbStddev < 2) failures.push(`image is almost all one color: stddev=${rgbStddev.toFixed(2)}`);

  return {
    passed: failures.length === 0,
    failures,
    width: input.width,
    height: input.height,
    meanLuma,
    rgbStddev,
    meanAlpha,
  };
}

export async function inspectPngSanity(
  path: string,
  expected: { width: number; height: number },
): Promise<ImageSanityResult> {
  const stat = statSync(path);
  if (stat.size <= 0) {
    return {
      passed: false,
      failures: ["image file is empty"],
      width: 0,
      height: 0,
      meanLuma: 0,
      rgbStddev: 0,
      meanAlpha: 0,
    };
  }

  const metadata = await sharp(path).metadata();
  const failures: string[] = [];
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    failures.push(`image dimensions ${metadata.width ?? 0}x${metadata.height ?? 0} did not match ${expected.width}x${expected.height}`);
  }

  const { data, info } = await sharp(path)
    .resize({ width: 96, height: 54, fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const classified = classifyImagePixels({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
  return {
    ...classified,
    width: metadata.width ?? classified.width,
    height: metadata.height ?? classified.height,
    failures: [...failures, ...classified.failures],
    passed: failures.length === 0 && classified.passed,
  };
}
