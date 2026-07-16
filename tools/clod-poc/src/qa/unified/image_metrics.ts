import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { sobelMagnitudes } from "./edge_metrics.js";
import { linearToSrgb8, rec709Luminance, type LinearImage } from "./image_linear.js";

export interface ImageMetrics {
  meanAbsoluteError: number;
  p50AbsoluteError: number;
  p95AbsoluteError: number;
  p99AbsoluteError: number;
  changedPixelFraction: number;
  luminanceMeanBaseline: number;
  luminanceMeanActual: number;
  luminanceStddevBaseline: number;
  luminanceStddevActual: number;
  chromaMeanBaseline: number;
  chromaMeanActual: number;
  edgeMagnitudeMeanBaseline: number;
  edgeMagnitudeMeanActual: number;
  edgeErrorMean: number;
}

export interface ImageComparison {
  metrics: ImageMetrics;
  pixelErrors: Float32Array;
  changedMask: Uint8Array;
}

export function compareImages(
  baseline: LinearImage,
  actual: LinearImage,
  changedPixelThreshold: number,
  weights?: Float32Array,
): ImageComparison {
  assertSameDimensions(baseline, actual);
  const pixels = baseline.width * baseline.height;
  if (weights && weights.length !== pixels) throw new Error("mask weight count does not match image pixels");
  const errors = new Float32Array(pixels);
  const changedMask = new Uint8Array(pixels);
  const luminanceBaseline = new Float64Array(pixels);
  const luminanceActual = new Float64Array(pixels);
  const chromaBaseline = new Float64Array(pixels);
  const chromaActual = new Float64Array(pixels);
  let weightSum = 0;
  let errorSum = 0;
  let changedWeight = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const weight = weights?.[pixel] ?? 1;
    if (weight <= 0) continue;
    const offset = pixel * 3;
    const br = baseline.rgb[offset] ?? 0;
    const bg = baseline.rgb[offset + 1] ?? 0;
    const bb = baseline.rgb[offset + 2] ?? 0;
    const ar = actual.rgb[offset] ?? 0;
    const ag = actual.rgb[offset + 1] ?? 0;
    const ab = actual.rgb[offset + 2] ?? 0;
    const error = (Math.abs(br - ar) + Math.abs(bg - ag) + Math.abs(bb - ab)) / 3;
    errors[pixel] = error;
    luminanceBaseline[pixel] = rec709Luminance(br, bg, bb);
    luminanceActual[pixel] = rec709Luminance(ar, ag, ab);
    chromaBaseline[pixel] = Math.max(br, bg, bb) - Math.min(br, bg, bb);
    chromaActual[pixel] = Math.max(ar, ag, ab) - Math.min(ar, ag, ab);
    weightSum += weight;
    errorSum += error * weight;
    if (error > changedPixelThreshold) {
      changedMask[pixel] = 255;
      changedWeight += weight;
    }
  }
  if (weightSum <= 0) throw new Error("image mask excludes every pixel");
  const baselineEdges = sobelMagnitudes(baseline);
  const actualEdges = sobelMagnitudes(actual);
  return {
    metrics: {
      meanAbsoluteError: errorSum / weightSum,
      p50AbsoluteError: weightedPercentile(errors, weights, 0.50),
      p95AbsoluteError: weightedPercentile(errors, weights, 0.95),
      p99AbsoluteError: weightedPercentile(errors, weights, 0.99),
      changedPixelFraction: changedWeight / weightSum,
      luminanceMeanBaseline: weightedMean(luminanceBaseline, weights),
      luminanceMeanActual: weightedMean(luminanceActual, weights),
      luminanceStddevBaseline: weightedStddev(luminanceBaseline, weights),
      luminanceStddevActual: weightedStddev(luminanceActual, weights),
      chromaMeanBaseline: weightedMean(chromaBaseline, weights),
      chromaMeanActual: weightedMean(chromaActual, weights),
      edgeMagnitudeMeanBaseline: weightedMean(baselineEdges, weights),
      edgeMagnitudeMeanActual: weightedMean(actualEdges, weights),
      edgeErrorMean: weightedAbsoluteDifference(baselineEdges, actualEdges, weights),
    },
    pixelErrors: errors,
    changedMask,
  };
}

export async function writeImageArtifacts(
  baseline: LinearImage,
  actual: LinearImage,
  comparison: ImageComparison,
  output: { diff: string; heatmap: string; changedMask: string },
): Promise<void> {
  mkdirSync(dirname(output.diff), { recursive: true });
  const baselineBytes = toSrgbBytes(baseline);
  const actualBytes = toSrgbBytes(actual);
  const rowBytes = baseline.width * 3;
  const combined = Buffer.alloc(baselineBytes.length + actualBytes.length);
  for (let y = 0; y < baseline.height; y++) {
    const sourceStart = y * rowBytes;
    const targetStart = y * rowBytes * 2;
    baselineBytes.copy(combined, targetStart, sourceStart, sourceStart + rowBytes);
    actualBytes.copy(combined, targetStart + rowBytes, sourceStart, sourceStart + rowBytes);
  }
  await sharp(combined, { raw: { width: baseline.width * 2, height: baseline.height, channels: 3 } }).png().toFile(output.diff);
  const heatmap = Buffer.alloc(comparison.pixelErrors.length);
  for (let i = 0; i < comparison.pixelErrors.length; i++) heatmap[i] = Math.round(Math.min(1, comparison.pixelErrors[i] ?? 0) * 255);
  await sharp(heatmap, { raw: { width: baseline.width, height: baseline.height, channels: 1 } }).png().toFile(output.heatmap);
  await sharp(Buffer.from(comparison.changedMask), { raw: { width: baseline.width, height: baseline.height, channels: 1 } }).png().toFile(output.changedMask);
}

function assertSameDimensions(a: LinearImage, b: LinearImage): void {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
}
function toSrgbBytes(image: LinearImage): Buffer {
  const bytes = Buffer.alloc(image.rgb.length);
  for (let i = 0; i < image.rgb.length; i++) bytes[i] = linearToSrgb8(image.rgb[i] ?? 0);
  return bytes;
}
function weightedPercentile(values: Float32Array, weights: Float32Array | undefined, quantile: number): number {
  const samples: Array<{ value: number; weight: number }> = [];
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = weights?.[i] ?? 1;
    if (weight <= 0) continue;
    samples.push({ value: values[i] ?? 0, weight });
    totalWeight += weight;
  }
  samples.sort((a, b) => a.value - b.value);
  const target = totalWeight * quantile;
  let cumulative = 0;
  for (const sample of samples) {
    cumulative += sample.weight;
    if (cumulative >= target) return sample.value;
  }
  return samples.at(-1)?.value ?? 0;
}
function weightedMean(values: ArrayLike<number>, weights?: Float32Array): number {
  let sum = 0; let weightSum = 0;
  for (let i = 0; i < values.length; i++) { const weight = weights?.[i] ?? 1; if (weight > 0) { sum += (values[i] ?? 0) * weight; weightSum += weight; } }
  return weightSum > 0 ? sum / weightSum : 0;
}
function weightedStddev(values: ArrayLike<number>, weights?: Float32Array): number {
  const mean = weightedMean(values, weights); let sum = 0; let weightSum = 0;
  for (let i = 0; i < values.length; i++) { const weight = weights?.[i] ?? 1; if (weight > 0) { const delta = (values[i] ?? 0) - mean; sum += delta * delta * weight; weightSum += weight; } }
  return weightSum > 0 ? Math.sqrt(sum / weightSum) : 0;
}
function weightedAbsoluteDifference(a: ArrayLike<number>, b: ArrayLike<number>, weights?: Float32Array): number {
  let sum = 0; let weightSum = 0;
  for (let i = 0; i < a.length; i++) { const weight = weights?.[i] ?? 1; if (weight > 0) { sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0)) * weight; weightSum += weight; } }
  return weightSum > 0 ? sum / weightSum : 0;
}
