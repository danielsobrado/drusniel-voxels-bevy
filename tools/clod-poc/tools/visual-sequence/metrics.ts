export interface ImagePlane {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
  channels?: 3 | 4;
}

export interface ResidualMetrics {
  meanLuma: number;
  p95Luma: number;
  maxLuma: number;
  meanChroma: number;
  changedRatio: number;
  edgeMean: number;
}

export interface TemporalMetrics {
  adjacent: ResidualMetrics[];
  meanLuma: number;
  maxP95Luma: number;
  maxChangedRatio: number;
  multiScaleMean: Record<string, number>;
}

export interface PopComponent {
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  peakDelta: number;
}

export function residualMetrics(a: ImagePlane, b: ImagePlane, mask?: Uint8Array): ResidualMetrics {
  assertCompatible(a, b);
  const channels = a.channels ?? 4;
  const luma: number[] = [];
  let chromaTotal = 0;
  let changed = 0;
  let edgeTotal = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    if (mask && mask[p] === 0) continue;
    const offset = p * channels;
    const ar = a.data[offset] ?? 0;
    const ag = a.data[offset + 1] ?? ar;
    const ab = a.data[offset + 2] ?? ar;
    const br = b.data[offset] ?? 0;
    const bg = b.data[offset + 1] ?? br;
    const bb = b.data[offset + 2] ?? br;
    const ay = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;
    const by = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
    const delta = Math.abs(ay - by) / 255;
    luma.push(delta);
    chromaTotal += (Math.abs((ar - ag) - (br - bg)) + Math.abs((ab - ag) - (bb - bg))) / (2 * 255);
    if (delta > 1 / 255) changed += 1;
    edgeTotal += Math.abs(edgeMagnitude(a, p) - edgeMagnitude(b, p)) / 255;
  }
  luma.sort((x, y) => x - y);
  const count = Math.max(1, luma.length);
  return {
    meanLuma: sum(luma) / count,
    p95Luma: luma[Math.min(luma.length - 1, Math.floor(luma.length * 0.95))] ?? 0,
    maxLuma: luma[luma.length - 1] ?? 0,
    meanChroma: chromaTotal / count,
    changedRatio: changed / count,
    edgeMean: edgeTotal / count,
  };
}

export function temporalMetrics(frames: readonly ImagePlane[], mask?: Uint8Array): TemporalMetrics {
  if (frames.length < 2) throw new Error("temporal metrics require at least two frames");
  const adjacent = frames.slice(1).map((frame, index) => residualMetrics(frames[index]!, frame, mask));
  return {
    adjacent,
    meanLuma: sum(adjacent.map((item) => item.meanLuma)) / adjacent.length,
    maxP95Luma: Math.max(...adjacent.map((item) => item.p95Luma)),
    maxChangedRatio: Math.max(...adjacent.map((item) => item.changedRatio)),
    multiScaleMean: Object.fromEntries([1, 2, 4].map((scale) => [String(scale), multiScaleMean(frames, scale, mask)])),
  };
}

export function detectPopComponents(
  previous: ImagePlane,
  current: ImagePlane,
  frame: number,
  deltaThreshold = 0.12,
  minArea = 2,
): PopComponent[] {
  assertCompatible(previous, current);
  const width = current.width;
  const height = current.height;
  const channels = current.channels ?? 4;
  const hot = new Uint8Array(width * height);
  const delta = new Float32Array(width * height);
  for (let p = 0; p < hot.length; p++) {
    const offset = p * channels;
    const d = Math.max(
      Math.abs((current.data[offset] ?? 0) - (previous.data[offset] ?? 0)),
      Math.abs((current.data[offset + 1] ?? 0) - (previous.data[offset + 1] ?? 0)),
      Math.abs((current.data[offset + 2] ?? 0) - (previous.data[offset + 2] ?? 0)),
    ) / 255;
    delta[p] = d;
    hot[p] = d >= deltaThreshold ? 1 : 0;
  }
  const visited = new Uint8Array(hot.length);
  const result: PopComponent[] = [];
  for (let seed = 0; seed < hot.length; seed++) {
    if (!hot[seed] || visited[seed]) continue;
    const queue = [seed];
    visited[seed] = 1;
    let head = 0;
    let area = 0;
    let peak = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (head < queue.length) {
      const p = queue[head++]!;
      const x = p % width;
      const y = Math.floor(p / width);
      area += 1;
      peak = Math.max(peak, delta[p]!);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const next of [p - 1, p + 1, p - width, p + width]) {
        if (next < 0 || next >= hot.length || visited[next] || !hot[next]) continue;
        if ((next === p - 1 || next === p + 1) && Math.floor(next / width) !== y) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (area >= minArea) result.push({ frame, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area, peakDelta: peak });
  }
  return result.sort((a, b) => b.area - a.area);
}

export function maskInstability(masks: readonly Uint8Array[]): number {
  if (masks.length < 2) return 0;
  const length = masks[0]!.length;
  if (masks.some((mask) => mask.length !== length)) throw new Error("mask sizes differ");
  let changed = 0;
  let samples = 0;
  for (let frame = 1; frame < masks.length; frame++) {
    for (let p = 0; p < length; p++) {
      if (masks[frame]![p] !== masks[frame - 1]![p]) changed += 1;
      samples += 1;
    }
  }
  return changed / Math.max(1, samples);
}

function multiScaleMean(frames: readonly ImagePlane[], scale: number, mask?: Uint8Array): number {
  const downsized = frames.map((frame) => downsample(frame, scale));
  const downsizedMask = mask ? downsampleMask(mask, frames[0]!.width, frames[0]!.height, scale) : undefined;
  const adjacent = downsized.slice(1).map((frame, index) => residualMetrics(downsized[index]!, frame, downsizedMask));
  return sum(adjacent.map((item) => item.meanLuma)) / adjacent.length;
}

function downsample(frame: ImagePlane, scale: number): ImagePlane {
  if (scale === 1) return frame;
  const channels = frame.channels ?? 4;
  const width = Math.max(1, Math.floor(frame.width / scale));
  const height = Math.max(1, Math.floor(frame.height / scale));
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let total = 0;
        let count = 0;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const sx = Math.min(frame.width - 1, x * scale + dx);
          const sy = Math.min(frame.height - 1, y * scale + dy);
          total += frame.data[(sy * frame.width + sx) * channels + c] ?? 0;
          count += 1;
        }
        data[(y * width + x) * channels + c] = Math.round(total / count);
      }
    }
  }
  return { width, height, data, channels };
}

function downsampleMask(mask: Uint8Array, sourceWidth: number, sourceHeight: number, scale: number): Uint8Array {
  const width = Math.max(1, Math.floor(sourceWidth / scale));
  const height = Math.max(1, Math.floor(sourceHeight / scale));
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let active = false;
    for (let dy = 0; dy < scale && !active; dy++) for (let dx = 0; dx < scale; dx++) {
      active ||= Boolean(mask[Math.min(sourceHeight - 1, y * scale + dy) * sourceWidth + Math.min(sourceWidth - 1, x * scale + dx)]);
    }
    result[y * width + x] = active ? 1 : 0;
  }
  return result;
}

function edgeMagnitude(frame: ImagePlane, p: number): number {
  const x = p % frame.width;
  const y = Math.floor(p / frame.width);
  const left = lumaAt(frame, Math.max(0, x - 1), y);
  const right = lumaAt(frame, Math.min(frame.width - 1, x + 1), y);
  const top = lumaAt(frame, x, Math.max(0, y - 1));
  const bottom = lumaAt(frame, x, Math.min(frame.height - 1, y + 1));
  return Math.min(255, Math.hypot(right - left, bottom - top));
}

function lumaAt(frame: ImagePlane, x: number, y: number): number {
  const channels = frame.channels ?? 4;
  const offset = (y * frame.width + x) * channels;
  return 0.2126 * (frame.data[offset] ?? 0) + 0.7152 * (frame.data[offset + 1] ?? 0) + 0.0722 * (frame.data[offset + 2] ?? 0);
}

function assertCompatible(a: ImagePlane, b: ImagePlane): void {
  if (a.width !== b.width || a.height !== b.height || (a.channels ?? 4) !== (b.channels ?? 4)) throw new Error("image planes differ");
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
