import type { PixelMask, RgbaImage } from "./water-foam-visual-metrics.js";

const MONOTONIC_TOLERANCE = 1.5 / 255;
const LINEAR_NEAR_MIN = 0.04;
const LINEAR_NEAR_MAX = 0.45;

export interface WaterFoamDistanceVisualMetrics {
  readonly waterPixelCount: number;
  readonly nearActivePixelCount: number;
  readonly nearMeanCoverage: number;
  readonly midMeanCoverage: number;
  readonly farMeanCoverage: number;
  readonly midNearRatio: number;
  readonly farNearRatio: number;
  readonly monotonicFraction: number;
  readonly nearActiveMonotonicFraction: number;
  readonly linearSampleCount: number;
  readonly linearMonotonicFraction: number;
  readonly linearMidNearRatio: number;
  readonly linearFarNearRatio: number;
}

export function measureWaterFoamDistanceResponse(
  near: RgbaImage,
  mid: RgbaImage,
  far: RgbaImage,
  waterMask: PixelMask,
): WaterFoamDistanceVisualMetrics {
  assertCompatible(near, mid);
  assertCompatible(near, far);
  assertMaskCompatible(near, waterMask);

  const pixelCount = near.width * near.height;
  let waterPixelCount = 0;
  let nearActivePixelCount = 0;
  let nearSum = 0;
  let midSum = 0;
  let farSum = 0;
  let monotonicCount = 0;
  let nearActiveMonotonicCount = 0;
  let linearSampleCount = 0;
  let linearMonotonicCount = 0;
  let linearNearSum = 0;
  let linearMidSum = 0;
  let linearFarSum = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (waterMask.data[pixel] === 0) continue;
    const nearValue = luminanceAt(near, pixel);
    const midValue = luminanceAt(mid, pixel);
    const farValue = luminanceAt(far, pixel);
    const monotonic = nearValue + MONOTONIC_TOLERANCE >= midValue
      && midValue + MONOTONIC_TOLERANCE >= farValue;
    waterPixelCount += 1;
    nearSum += nearValue;
    midSum += midValue;
    farSum += farValue;
    if (monotonic) monotonicCount += 1;
    if (nearValue >= LINEAR_NEAR_MIN) {
      nearActivePixelCount += 1;
      if (monotonic) nearActiveMonotonicCount += 1;
    }
    if (nearValue < LINEAR_NEAR_MIN || nearValue > LINEAR_NEAR_MAX) continue;
    linearSampleCount += 1;
    if (monotonic) linearMonotonicCount += 1;
    linearNearSum += nearValue;
    linearMidSum += midValue;
    linearFarSum += farValue;
  }

  const nearMeanCoverage = divide(nearSum, waterPixelCount);
  const midMeanCoverage = divide(midSum, waterPixelCount);
  const farMeanCoverage = divide(farSum, waterPixelCount);
  return {
    waterPixelCount,
    nearActivePixelCount,
    nearMeanCoverage,
    midMeanCoverage,
    farMeanCoverage,
    midNearRatio: ratio(midMeanCoverage, nearMeanCoverage),
    farNearRatio: ratio(farMeanCoverage, nearMeanCoverage),
    monotonicFraction: divide(monotonicCount, waterPixelCount),
    nearActiveMonotonicFraction: divide(nearActiveMonotonicCount, nearActivePixelCount),
    linearSampleCount,
    linearMonotonicFraction: divide(linearMonotonicCount, linearSampleCount),
    linearMidNearRatio: ratio(linearMidSum, linearNearSum),
    linearFarNearRatio: ratio(linearFarSum, linearNearSum),
  };
}

function assertCompatible(a: RgbaImage, b: RgbaImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  if (a.channels < 3 || b.channels < 3) {
    throw new Error("foam distance metrics require RGB or RGBA images");
  }
}

function assertMaskCompatible(image: RgbaImage, mask: PixelMask): void {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(`image and mask dimensions differ: ${image.width}x${image.height} vs ${mask.width}x${mask.height}`);
  }
}

function luminanceAt(image: RgbaImage, pixel: number): number {
  const offset = pixel * image.channels;
  const r = image.data[offset] ?? 0;
  const g = image.data[offset + 1] ?? 0;
  const b = image.data[offset + 2] ?? 0;
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 1e-9 ? numerator / denominator : 0;
}

function divide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
