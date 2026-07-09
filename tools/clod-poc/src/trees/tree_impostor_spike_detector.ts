export interface TreeImpostorDarkSpikeThresholds {
  darkLumaThreshold: number;
  neighborLumaDelta: number;
  minRunPx: number;
  minRunRatio: number;
  maxSpikeWidthPx: number;
  maxSpikeRuns: number;
  maxSpikePixelRatio: number;
}

export interface TreeImpostorDarkSpikeInput {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
  thresholds?: Partial<TreeImpostorDarkSpikeThresholds>;
}

export interface TreeImpostorDarkSpikeRun {
  x: number;
  y0: number;
  y1: number;
  widthPx: number;
  midLuma: number;
  neighborLuma: number;
}

export interface TreeImpostorDarkSpikeReport {
  status: "pass" | "fail";
  spikeRuns: TreeImpostorDarkSpikeRun[];
  spikePixelRatio: number;
  thresholds: TreeImpostorDarkSpikeThresholds;
}

const DEFAULT_THRESHOLDS: TreeImpostorDarkSpikeThresholds = {
  darkLumaThreshold: 18,
  neighborLumaDelta: 24,
  minRunPx: 48,
  minRunRatio: 0.06,
  maxSpikeWidthPx: 3,
  maxSpikeRuns: 6,
  maxSpikePixelRatio: 0.0006,
};

export function defaultTreeImpostorDarkSpikeThresholds(): TreeImpostorDarkSpikeThresholds {
  return { ...DEFAULT_THRESHOLDS };
}

export function detectTreeImpostorDarkSpikes(input: TreeImpostorDarkSpikeInput): TreeImpostorDarkSpikeReport {
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  if (width <= 2 || height <= 2 || input.rgba.length < width * height * 4) {
    return { status: "pass", spikeRuns: [], spikePixelRatio: 0, thresholds };
  }

  const minRunPx = Math.max(thresholds.minRunPx, Math.floor(height * thresholds.minRunRatio));
  const spikeRuns: TreeImpostorDarkSpikeRun[] = [];
  let spikePixels = 0;
  for (let x = 1; x < width - 1; x++) {
    let y = 0;
    while (y < height) {
      while (y < height && !isDark(input.rgba, width, x, y, thresholds.darkLumaThreshold)) y++;
      const y0 = y;
      while (y < height && isDark(input.rgba, width, x, y, thresholds.darkLumaThreshold)) y++;
      const y1 = y - 1;
      if (y1 < y0 || y1 - y0 + 1 < minRunPx) continue;
      const midY = Math.floor((y0 + y1) * 0.5);
      const widthPx = darkRunWidth(input.rgba, width, height, x, midY, thresholds.darkLumaThreshold);
      if (widthPx > thresholds.maxSpikeWidthPx) continue;
      const midLuma = pixelLuma(input.rgba, width, x, midY);
      const neighborLuma = horizontalNeighborLuma(input.rgba, width, height, x, midY, thresholds.maxSpikeWidthPx + 1);
      if (neighborLuma - midLuma < thresholds.neighborLumaDelta) continue;
      const run = { x, y0, y1, widthPx, midLuma, neighborLuma };
      spikeRuns.push(run);
      spikePixels += y1 - y0 + 1;
    }
  }

  const spikePixelRatio = spikePixels / Math.max(1, width * height);
  return {
    status: spikeRuns.length <= thresholds.maxSpikeRuns && spikePixelRatio <= thresholds.maxSpikePixelRatio ? "pass" : "fail",
    spikeRuns,
    spikePixelRatio,
    thresholds,
  };
}

function isDark(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold: number,
): boolean {
  const offset = pixelOffset(width, x, y);
  if (rgba[offset + 3] <= 0) return false;
  return pixelLumaAtOffset(rgba, offset) <= threshold;
}

function pixelLuma(rgba: Uint8Array | Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixelLumaAtOffset(rgba, pixelOffset(width, x, y));
}

function pixelLumaAtOffset(rgba: Uint8Array | Uint8ClampedArray, offset: number): number {
  return rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function darkRunWidth(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  _height: number,
  x: number,
  y: number,
  threshold: number,
): number {
  let left = x;
  let right = x;
  while (left > 0 && isDark(rgba, width, left - 1, y, threshold)) left--;
  while (right < width - 1 && isDark(rgba, width, right + 1, y, threshold)) right++;
  return right - left + 1;
}

function horizontalNeighborLuma(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  distance: number,
): number {
  const dx = Math.max(1, Math.floor(distance));
  const leftX = Math.max(0, x - dx);
  const rightX = Math.min(width - 1, x + dx);
  const safeY = Math.min(height - 1, Math.max(0, y));
  return (pixelLuma(rgba, width, leftX, safeY) + pixelLuma(rgba, width, rightX, safeY)) * 0.5;
}
