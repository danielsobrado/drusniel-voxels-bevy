export interface RgbaImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

export interface PixelMask {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface FoamImageMetrics {
  readonly waterPixelCount: number;
  readonly activePixelCount: number;
  readonly meanCoverage: number;
  readonly activeFraction: number;
  readonly isolatedActiveFraction: number;
  readonly componentDensityPerK: number;
  readonly largestComponentFraction: number;
  readonly stripeAnisotropy: number;
}

export interface FoamTemporalMetrics {
  readonly comparedPixelCount: number;
  readonly meanAbsoluteDelta: number;
  readonly binaryIou: number;
}

export interface FoamLightingMetrics {
  readonly sampleCount: number;
  readonly meanLuminance: number;
  readonly p95Luminance: number;
  readonly standardDeviation: number;
}

const ACTIVE_FOAM_THRESHOLD = 0.16;
const LIGHTING_FOAM_THRESHOLD = 0.12;
const WATER_DEBUG_DELTA_THRESHOLD = 0.045;
const WATER_DEBUG_STRONG_DELTA = 0.14;
const WATER_DEBUG_GRAY_SPREAD_MAX = 0.04;

export function deriveWaterPixelMask(
  bodyMask: RgbaImage,
  depth: RgbaImage,
  foam: RgbaImage,
): PixelMask {
  assertCompatible(bodyMask, depth);
  assertCompatible(bodyMask, foam);
  const pixelCount = bodyMask.width * bodyMask.height;
  const candidate = new Uint8Array(pixelCount);
  const strength = new Float32Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const spread = channelSpreadAt(bodyMask, pixel);
    if (spread > WATER_DEBUG_GRAY_SPREAD_MAX || luminanceAt(bodyMask, pixel) <= 0.015) continue;
    const delta = Math.max(
      colorDeltaAt(bodyMask, depth, pixel),
      colorDeltaAt(bodyMask, foam, pixel),
    );
    if (delta < WATER_DEBUG_DELTA_THRESHOLD) continue;
    candidate[pixel] = 1;
    strength[pixel] = delta;
  }

  const data = new Uint8Array(pixelCount);
  for (let y = 0; y < bodyMask.height; y += 1) {
    for (let x = 0; x < bodyMask.width; x += 1) {
      const pixel = y * bodyMask.width + x;
      if (candidate[pixel] === 0) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= bodyMask.width || ny < 0 || ny >= bodyMask.height) continue;
          neighbours += candidate[ny * bodyMask.width + nx] ?? 0;
        }
      }
      if ((strength[pixel] ?? 0) >= WATER_DEBUG_STRONG_DELTA || neighbours >= 2) data[pixel] = 1;
    }
  }

  return { data, width: bodyMask.width, height: bodyMask.height };
}

export function measureFoamImage(foam: RgbaImage, waterMask: PixelMask): FoamImageMetrics {
  assertMaskCompatible(foam, waterMask);
  const pixelCount = foam.width * foam.height;
  const active = new Uint8Array(pixelCount);
  let waterPixelCount = 0;
  let activePixelCount = 0;
  let coverageSum = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (waterMask.data[pixel] === 0) continue;
    waterPixelCount += 1;
    const coverage = luminanceAt(foam, pixel);
    coverageSum += coverage;
    if (coverage <= ACTIVE_FOAM_THRESHOLD) continue;
    active[pixel] = 1;
    activePixelCount += 1;
  }

  if (waterPixelCount === 0 || activePixelCount === 0) {
    return {
      waterPixelCount,
      activePixelCount,
      meanCoverage: waterPixelCount === 0 ? 0 : coverageSum / waterPixelCount,
      activeFraction: 0,
      isolatedActiveFraction: 0,
      componentDensityPerK: 0,
      largestComponentFraction: 0,
      stripeAnisotropy: 0,
    };
  }

  const topology = measureActiveTopology(active, foam.width, foam.height, activePixelCount);
  return {
    waterPixelCount,
    activePixelCount,
    meanCoverage: coverageSum / waterPixelCount,
    activeFraction: activePixelCount / waterPixelCount,
    isolatedActiveFraction: topology.isolated / activePixelCount,
    componentDensityPerK: topology.componentCount / waterPixelCount * 1000,
    largestComponentFraction: topology.largestComponent / activePixelCount,
    stripeAnisotropy: topology.stripeAnisotropy,
  };
}

export function measureFoamTemporal(
  first: RgbaImage,
  second: RgbaImage,
  waterMask: PixelMask,
): FoamTemporalMetrics {
  assertCompatible(first, second);
  assertMaskCompatible(first, waterMask);
  const pixelCount = first.width * first.height;
  let comparedPixelCount = 0;
  let deltaSum = 0;
  let intersection = 0;
  let union = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (waterMask.data[pixel] === 0) continue;
    const a = luminanceAt(first, pixel);
    const b = luminanceAt(second, pixel);
    comparedPixelCount += 1;
    deltaSum += Math.abs(a - b);
    const activeA = a > ACTIVE_FOAM_THRESHOLD;
    const activeB = b > ACTIVE_FOAM_THRESHOLD;
    if (activeA && activeB) intersection += 1;
    if (activeA || activeB) union += 1;
  }

  return {
    comparedPixelCount,
    meanAbsoluteDelta: comparedPixelCount === 0 ? 0 : deltaSum / comparedPixelCount,
    binaryIou: union === 0 ? 1 : intersection / union,
  };
}

export function measureFoamLighting(
  finalImage: RgbaImage,
  foam: RgbaImage,
  waterMask: PixelMask,
): FoamLightingMetrics {
  assertCompatible(finalImage, foam);
  assertMaskCompatible(finalImage, waterMask);
  const values: number[] = [];
  const pixelCount = finalImage.width * finalImage.height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (waterMask.data[pixel] === 0) continue;
    if (luminanceAt(foam, pixel) <= LIGHTING_FOAM_THRESHOLD) continue;
    values.push(luminanceAt(finalImage, pixel));
  }

  if (values.length === 0) {
    return { sampleCount: 0, meanLuminance: 0, p95Luminance: 0, standardDeviation: 0 };
  }

  values.sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    sampleCount: values.length,
    meanLuminance: mean,
    p95Luminance: percentile(values, 0.95),
    standardDeviation: Math.sqrt(variance),
  };
}

function measureActiveTopology(
  active: Uint8Array,
  width: number,
  height: number,
  activePixelCount: number,
): {
  readonly isolated: number;
  readonly componentCount: number;
  readonly largestComponent: number;
  readonly stripeAnisotropy: number;
} {
  let isolated = 0;
  const adjacency = [0, 0, 0, 0];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (active[index] === 0) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          neighbours += active[ny * width + nx] ?? 0;
        }
      }
      if (neighbours <= 1) isolated += 1;
      if (x + 1 < width && active[index + 1] !== 0) adjacency[0] += 1;
      if (y + 1 < height && active[index + width] !== 0) adjacency[1] += 1;
      if (x + 1 < width && y + 1 < height && active[index + width + 1] !== 0) adjacency[2] += 1;
      if (x > 0 && y + 1 < height && active[index + width - 1] !== 0) adjacency[3] += 1;
    }
  }

  const visited = new Uint8Array(active.length);
  const queue = new Int32Array(activePixelCount);
  let componentCount = 0;
  let largestComponent = 0;

  for (let start = 0; start < active.length; start += 1) {
    if (active[start] === 0 || visited[start] !== 0) continue;
    componentCount += 1;
    let read = 0;
    let write = 0;
    queue[write++] = start;
    visited[start] = 1;

    while (read < write) {
      const current = queue[read++] ?? 0;
      const x = current % width;
      const y = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (active[next] === 0 || visited[next] !== 0) continue;
          visited[next] = 1;
          queue[write++] = next;
        }
      }
    }
    largestComponent = Math.max(largestComponent, write);
  }

  const adjacencyTotal = adjacency.reduce((sum, value) => sum + value, 0);
  const stripeAnisotropy = adjacencyTotal === 0 ? 0 : Math.max(...adjacency) / adjacencyTotal;
  return { isolated, componentCount, largestComponent, stripeAnisotropy };
}

function assertCompatible(a: RgbaImage, b: RgbaImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  if (a.channels < 3 || b.channels < 3) {
    throw new Error("foam visual metrics require RGB or RGBA images");
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

function channelSpreadAt(image: RgbaImage, pixel: number): number {
  const offset = pixel * image.channels;
  const r = image.data[offset] ?? 0;
  const g = image.data[offset + 1] ?? 0;
  const b = image.data[offset + 2] ?? 0;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function colorDeltaAt(a: RgbaImage, b: RgbaImage, pixel: number): number {
  const offsetA = pixel * a.channels;
  const offsetB = pixel * b.channels;
  return Math.max(
    Math.abs((a.data[offsetA] ?? 0) - (b.data[offsetB] ?? 0)),
    Math.abs((a.data[offsetA + 1] ?? 0) - (b.data[offsetB + 1] ?? 0)),
    Math.abs((a.data[offsetA + 2] ?? 0) - (b.data[offsetB + 2] ?? 0)),
  ) / 255;
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}
