import { sobelMagnitudes } from "./edge_metrics.js";
import { rec709Luminance, type LinearImage } from "./image_linear.js";
import type { QaRegionProbe } from "./schema.js";

export interface RegionProbeMetrics {
  luminanceMean: number;
  luminanceStddev: number;
  luminanceMin: number;
  luminanceMax: number;
  luminanceP05: number;
  luminanceP50: number;
  luminanceP95: number;
  chromaMean: number;
  blackPixelFraction: number;
  clippedPixelFraction: number;
  meanRgb: [number, number, number];
  edgeMagnitude: number;
}

export interface RegionProbeResult {
  id: string;
  status: "PASS" | "FAIL";
  metrics: RegionProbeMetrics;
  failures: string[];
}

export function evaluateRegionProbe(
  image: LinearImage,
  probe: QaRegionProbe,
): RegionProbeResult {
  const [rx, ry, rw, rh] = probe.rect_normalized;
  const x0 = Math.floor(rx * image.width);
  const y0 = Math.floor(ry * image.height);
  const x1 = Math.max(x0 + 1, Math.ceil((rx + rw) * image.width));
  const y1 = Math.max(y0 + 1, Math.ceil((ry + rh) * image.height));
  const edges = sobelMagnitudes(image);
  const luminance: number[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let chroma = 0;
  let black = 0;
  let clipped = 0;
  let edge = 0;
  for (let y = y0; y < Math.min(y1, image.height); y++) {
    for (let x = x0; x < Math.min(x1, image.width); x++) {
      const pixel = y * image.width + x;
      const offset = pixel * 3;
      const r = image.rgb[offset] ?? 0;
      const g = image.rgb[offset + 1] ?? 0;
      const b = image.rgb[offset + 2] ?? 0;
      const yValue = rec709Luminance(r, g, b);
      luminance.push(yValue);
      sumR += r;
      sumG += g;
      sumB += b;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      if (yValue < 0.01) black++;
      if (r > 0.99 || g > 0.99 || b > 0.99) clipped++;
      edge += edges[pixel] ?? 0;
    }
  }
  if (luminance.length === 0) {
    throw new Error(`region probe ${probe.id} selected no pixels`);
  }
  luminance.sort((a, b) => a - b);
  const count = luminance.length;
  const luminanceMean = luminance.reduce((sum, value) => sum + value, 0) / count;
  const metrics: RegionProbeMetrics = {
    luminanceMean,
    luminanceStddev: Math.sqrt(
      luminance.reduce((sum, value) => sum + (value - luminanceMean) ** 2, 0) / count,
    ),
    luminanceMin: luminance[0] ?? 0,
    luminanceMax: luminance[count - 1] ?? 0,
    luminanceP05: percentile(luminance, 0.05),
    luminanceP50: percentile(luminance, 0.50),
    luminanceP95: percentile(luminance, 0.95),
    chromaMean: chroma / count,
    blackPixelFraction: black / count,
    clippedPixelFraction: clipped / count,
    meanRgb: [sumR / count, sumG / count, sumB / count],
    edgeMagnitude: edge / count,
  };
  const failures: string[] = [];
  gate("luminance_mean", metrics.luminanceMean, probe.gates.luminance_mean, failures);
  gate(
    "luminance_stddev",
    metrics.luminanceStddev,
    probe.gates.luminance_stddev,
    failures,
  );
  gate("chroma_mean", metrics.chromaMean, probe.gates.chroma_mean, failures);
  gate(
    "black_pixel_fraction",
    metrics.blackPixelFraction,
    probe.gates.black_pixel_fraction,
    failures,
  );
  gate(
    "clipped_pixel_fraction",
    metrics.clippedPixelFraction,
    probe.gates.clipped_pixel_fraction,
    failures,
  );
  gate("edge_magnitude", metrics.edgeMagnitude, probe.gates.edge_magnitude, failures);
  return {
    id: probe.id,
    status: failures.length === 0 ? "PASS" : "FAIL",
    metrics,
    failures,
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

function gate(
  name: string,
  value: number,
  range: { min?: number; max?: number } | undefined,
  failures: string[],
): void {
  if (!range) return;
  if (range.min !== undefined && value < range.min) {
    failures.push(`${name} ${value} < ${range.min}`);
  }
  if (range.max !== undefined && value > range.max) {
    failures.push(`${name} ${value} > ${range.max}`);
  }
}
