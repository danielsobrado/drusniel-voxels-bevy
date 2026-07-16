export interface RawRgbImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

export interface PixelCentroid {
  readonly pixelCount: number;
  readonly xPx: number;
  readonly yPx: number;
}

export interface EdgeDriftSignal {
  readonly edgePixelsA: number;
  readonly edgePixelsB: number;
  readonly changedEdgePixels: number;
  readonly changedEdgeRatio: number;
}

export interface TemporalSecondDifferenceSignal {
  readonly changedPixels: number;
  readonly changedPixelRatio: number;
  readonly meanAbsoluteChannelResidual: number;
  readonly maxChannelResidual: number;
}

function assertCompatible(images: readonly RawRgbImage[]): void {
  const first = images[0];
  if (!first || first.channels < 3) throw new Error("precision image signal requires RGB data");
  for (const image of images) {
    if (image.width !== first.width || image.height !== first.height || image.channels !== first.channels) {
      throw new Error("precision image signals require identical image dimensions");
    }
  }
}

export function colorMarkerCentroid(
  image: RawRgbImage,
  marker: "magenta" | "cyan",
): PixelCentroid | null {
  assertCompatible([image]);
  let count = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * image.channels;
      const r = image.data[offset]!;
      const g = image.data[offset + 1]!;
      const b = image.data[offset + 2]!;
      const matches = marker === "magenta"
        ? r >= 180 && b >= 180 && g <= 120 && r + b - 2 * g >= 180
        : g >= 170 && b >= 170 && r <= 120 && g + b - 2 * r >= 160;
      if (!matches) continue;
      count++;
      xTotal += x;
      yTotal += y;
    }
  }
  return count === 0 ? null : { pixelCount: count, xPx: xTotal / count, yPx: yTotal / count };
}

function luminance(image: RawRgbImage, x: number, y: number): number {
  const offset = (y * image.width + x) * image.channels;
  return image.data[offset]! * 0.2126 + image.data[offset + 1]! * 0.7152 + image.data[offset + 2]! * 0.0722;
}

function edgeAt(image: RawRgbImage, x: number, y: number, threshold: number): boolean {
  const horizontal = Math.abs(luminance(image, x + 1, y) - luminance(image, x - 1, y));
  const vertical = Math.abs(luminance(image, x, y + 1) - luminance(image, x, y - 1));
  return horizontal + vertical >= threshold;
}

export function luminanceEdgeDrift(
  first: RawRgbImage,
  second: RawRgbImage,
  threshold = 32,
): EdgeDriftSignal {
  assertCompatible([first, second]);
  let edgePixelsA = 0;
  let edgePixelsB = 0;
  let changedEdgePixels = 0;
  for (let y = 1; y < first.height - 1; y++) {
    for (let x = 1; x < first.width - 1; x++) {
      const a = edgeAt(first, x, y, threshold);
      const b = edgeAt(second, x, y, threshold);
      if (a) edgePixelsA++;
      if (b) edgePixelsB++;
      if (a !== b) changedEdgePixels++;
    }
  }
  // XOR = |A| + |B| - 2|A∩B|, so |A∪B| = (|A| + |B| + XOR) / 2.
  const union = (edgePixelsA + edgePixelsB + changedEdgePixels) / 2;
  return {
    edgePixelsA,
    edgePixelsB,
    changedEdgePixels,
    changedEdgeRatio: union > 0 ? changedEdgePixels / union : 0,
  };
}

export function temporalSecondDifference(
  first: RawRgbImage,
  middle: RawRgbImage,
  last: RawRgbImage,
  pixelThreshold = 4,
): TemporalSecondDifferenceSignal {
  assertCompatible([first, middle, last]);
  let changedPixels = 0;
  let residualTotal = 0;
  let maxChannelResidual = 0;
  const pixels = first.width * first.height;
  for (let pixel = 0; pixel < pixels; pixel++) {
    let pixelMax = 0;
    for (let channel = 0; channel < 3; channel++) {
      const offset = pixel * first.channels + channel;
      const residual = Math.min(255, Math.abs(first.data[offset]! - 2 * middle.data[offset]! + last.data[offset]!));
      residualTotal += residual;
      pixelMax = Math.max(pixelMax, residual);
      maxChannelResidual = Math.max(maxChannelResidual, residual);
    }
    if (pixelMax > pixelThreshold) changedPixels++;
  }
  return {
    changedPixels,
    changedPixelRatio: pixels > 0 ? changedPixels / pixels : 0,
    meanAbsoluteChannelResidual: pixels > 0 ? residualTotal / (pixels * 3) : 0,
    maxChannelResidual,
  };
}
