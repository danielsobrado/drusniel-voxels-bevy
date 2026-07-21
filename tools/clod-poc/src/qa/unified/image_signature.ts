import { rec709Luminance, type LinearImage } from "./image_linear.js";

const DEFAULT_GRID_SIZE = 8;
const HISTOGRAM_BINS = 16;
const QUANTIZATION = 10_000;

export interface QaImageSignature {
  schemaVersion: 1;
  width: number;
  height: number;
  gridSize: number;
  linearRgbGrid: number[];
  luminanceHistogram: number[];
  edgeHistogram: number[];
  averageHash: string;
}

export function buildImageSignature(
  image: LinearImage,
  gridSize = DEFAULT_GRID_SIZE,
): QaImageSignature {
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 32) {
    throw new Error("image signature gridSize must be an integer from 2 to 32");
  }
  return {
    schemaVersion: 1,
    width: image.width,
    height: image.height,
    gridSize,
    linearRgbGrid: buildRgbGrid(image, gridSize),
    luminanceHistogram: buildLuminanceHistogram(image),
    edgeHistogram: buildEdgeHistogram(image),
    averageHash: buildAverageHash(image, gridSize),
  };
}

function buildRgbGrid(image: LinearImage, gridSize: number): number[] {
  const output: number[] = [];
  for (let gy = 0; gy < gridSize; gy++) {
    const y0 = Math.floor((gy * image.height) / gridSize);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * image.height) / gridSize));
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = Math.floor((gx * image.width) / gridSize);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * image.width) / gridSize));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < Math.min(y1, image.height); y++) {
        for (let x = x0; x < Math.min(x1, image.width); x++) {
          const index = (y * image.width + x) * 3;
          r += image.rgb[index] ?? 0;
          g += image.rgb[index + 1] ?? 0;
          b += image.rgb[index + 2] ?? 0;
          count++;
        }
      }
      output.push(quantize(r / count), quantize(g / count), quantize(b / count));
    }
  }
  return output;
}

function buildLuminanceHistogram(image: LinearImage): number[] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  const pixels = image.width * image.height;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const index = pixel * 3;
    const luminance = rec709Luminance(
      image.rgb[index] ?? 0,
      image.rgb[index + 1] ?? 0,
      image.rgb[index + 2] ?? 0,
    );
    bins[Math.min(HISTOGRAM_BINS - 1, Math.floor(luminance * HISTOGRAM_BINS))]!++;
  }
  return bins.map((count) => quantize(count / Math.max(1, pixels)));
}

function buildEdgeHistogram(image: LinearImage): number[] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  let samples = 0;
  for (let y = 0; y < image.height - 1; y++) {
    for (let x = 0; x < image.width - 1; x++) {
      const center = luminanceAt(image, x, y);
      const dx = Math.abs(luminanceAt(image, x + 1, y) - center);
      const dy = Math.abs(luminanceAt(image, x, y + 1) - center);
      const magnitude = Math.min(1, Math.hypot(dx, dy));
      bins[Math.min(HISTOGRAM_BINS - 1, Math.floor(magnitude * HISTOGRAM_BINS))]!++;
      samples++;
    }
  }
  return bins.map((count) => quantize(count / Math.max(1, samples)));
}

function buildAverageHash(image: LinearImage, gridSize: number): string {
  const values: number[] = [];
  for (let gy = 0; gy < gridSize; gy++) {
    const y = Math.min(image.height - 1, Math.floor(((gy + 0.5) * image.height) / gridSize));
    for (let gx = 0; gx < gridSize; gx++) {
      const x = Math.min(image.width - 1, Math.floor(((gx + 0.5) * image.width) / gridSize));
      values.push(luminanceAt(image, x, y));
    }
  }
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  let result = "";
  for (let offset = 0; offset < values.length; offset += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      if ((values[offset + bit] ?? 0) >= average) nibble |= 1 << (3 - bit);
    }
    result += nibble.toString(16);
  }
  return result;
}

function luminanceAt(image: LinearImage, x: number, y: number): number {
  const index = (y * image.width + x) * 3;
  return rec709Luminance(
    image.rgb[index] ?? 0,
    image.rgb[index + 1] ?? 0,
    image.rgb[index + 2] ?? 0,
  );
}

function quantize(value: number): number {
  return Math.round(value * QUANTIZATION) / QUANTIZATION;
}
