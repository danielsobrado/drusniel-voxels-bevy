export interface RgbaImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

export interface ImageDeltaMetrics {
  readonly sampledPixels: number;
  readonly changedPixels: number;
  readonly changedRatio: number;
  readonly meanRgbDelta: number;
  readonly maxRgbDelta: number;
}

export function deriveImageDifferenceMask(
  left: RgbaImage,
  right: RgbaImage,
  minimumRgbDelta = 8,
): Uint8Array {
  assertCompatibleImages(left, right);
  const pixels = left.width * left.height;
  const mask = new Uint8Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * left.channels;
    if (rgbDelta(left.data, right.data, offset) >= minimumRgbDelta) mask[pixel] = 1;
  }
  return mask;
}

export function unionImageMasks(...masks: readonly Uint8Array[]): Uint8Array {
  if (masks.length === 0) return new Uint8Array();
  const length = masks[0]?.length ?? 0;
  const union = new Uint8Array(length);
  for (const mask of masks) {
    if (mask.length !== length) throw new Error("image masks must have equal lengths");
    for (let index = 0; index < length; index += 1) {
      if (mask[index] !== 0) union[index] = 1;
    }
  }
  return union;
}

export function measureImageDelta(
  left: RgbaImage,
  right: RgbaImage,
  mask?: Uint8Array,
  changedThreshold = 8,
): ImageDeltaMetrics {
  assertCompatibleImages(left, right);
  const pixels = left.width * left.height;
  if (mask && mask.length !== pixels) throw new Error("image mask size does not match image dimensions");

  let sampledPixels = 0;
  let changedPixels = 0;
  let deltaSum = 0;
  let maxRgbDelta = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (mask && mask[pixel] === 0) continue;
    const offset = pixel * left.channels;
    const delta = rgbDelta(left.data, right.data, offset);
    sampledPixels += 1;
    deltaSum += delta;
    if (delta >= changedThreshold) changedPixels += 1;
    if (delta > maxRgbDelta) maxRgbDelta = delta;
  }

  return {
    sampledPixels,
    changedPixels,
    changedRatio: sampledPixels > 0 ? changedPixels / sampledPixels : 0,
    meanRgbDelta: sampledPixels > 0 ? deltaSum / sampledPixels : 0,
    maxRgbDelta,
  };
}

function rgbDelta(left: Uint8Array, right: Uint8Array, offset: number): number {
  return (
    Math.abs((left[offset] ?? 0) - (right[offset] ?? 0))
    + Math.abs((left[offset + 1] ?? 0) - (right[offset + 1] ?? 0))
    + Math.abs((left[offset + 2] ?? 0) - (right[offset + 2] ?? 0))
  );
}

function assertCompatibleImages(left: RgbaImage, right: RgbaImage): void {
  if (
    left.width !== right.width
    || left.height !== right.height
    || left.channels !== right.channels
    || left.data.length !== right.data.length
  ) {
    throw new Error("images must have matching dimensions and channel counts");
  }
}
