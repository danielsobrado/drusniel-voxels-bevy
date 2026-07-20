import { rasterizeAnnulusRoi, rasterizePolylineRoi, type ScreenPoint } from "./roi.js";
import type { VisualSequenceRoi } from "./schema.js";

export function skyExcludeMask(depth: Float32Array, skyDepthMin = 0.999): Uint8Array {
  const mask = new Uint8Array(depth.length);
  for (let p = 0; p < depth.length; p++) {
    const value = depth[p]!;
    mask[p] = value >= 0 && value < skyDepthMin ? 1 : 0;
  }
  return mask;
}

export function coverageMaskFromDepth(depth: Float32Array, skyDepthMin = 0.999): Uint8Array {
  return skyExcludeMask(depth, skyDepthMin);
}

export function ownershipMaskFromImage(data: Uint8Array, width: number, height: number, channels = 4, lumaMin = 8): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) {
    const offset = p * channels;
    const luma = 0.2126 * (data[offset] ?? 0) + 0.7152 * (data[offset + 1] ?? 0) + 0.0722 * (data[offset + 2] ?? 0);
    mask[p] = luma >= lumaMin ? 1 : 0;
  }
  return mask;
}

export function projectWorldPoint(
  viewProjection: readonly number[],
  world: readonly [number, number, number],
  width: number,
  height: number,
): ScreenPoint | null {
  const clip = transform(viewProjection, [world[0], world[1], world[2], 1]);
  if (Math.abs(clip[3]) < 1e-8) return null;
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  const ndcZ = clip[2] / clip[3];
  if (ndcZ < 0 || ndcZ > 1) return null;
  if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) return null;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
  };
}

export function rasterizeWorldRoi(
  width: number,
  height: number,
  viewProjection: readonly number[],
  roi: VisualSequenceRoi,
): Uint8Array {
  if (roi.type === "polyline") {
    const points = roi.points
      .map((point) => projectWorldPoint(viewProjection, point, width, height))
      .filter((point): point is ScreenPoint => point !== null);
    return rasterizePolylineRoi(width, height, points, roi.radiusPx);
  }
  const center = projectWorldPoint(viewProjection, roi.center, width, height);
  if (!center) return new Uint8Array(width * height);
  return rasterizeAnnulusRoi(width, height, center, roi.innerRadiusPx, roi.outerRadiusPx);
}

export function combineMasks(width: number, height: number, masks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(width * height).fill(1);
  for (const mask of masks) {
    if (mask.length !== result.length) throw new Error("mask sizes differ");
    for (let p = 0; p < result.length; p++) result[p] = result[p]! && mask[p]! ? 1 : 0;
  }
  return result;
}

export function orMasks(width: number, height: number, masks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(width * height);
  for (const mask of masks) {
    if (mask.length !== result.length) throw new Error("mask sizes differ");
    for (let p = 0; p < result.length; p++) if (mask[p]) result[p] = 1;
  }
  return result;
}

export function maskCoverage(mask: Uint8Array): number {
  if (mask.length === 0) return 0;
  let active = 0;
  for (const value of mask) if (value) active += 1;
  return active / mask.length;
}

export function buildEvaluationMask(input: {
  width: number;
  height: number;
  depth?: Float32Array;
  viewProjection?: readonly number[];
  rois?: readonly VisualSequenceRoi[];
  ownership?: Uint8Array;
  maskSources?: readonly string[];
  skyDepthMin?: number;
}): { mask: Uint8Array; coverage: number } {
  const sources = new Set(input.maskSources ?? defaultMaskSources(input));
  const parts: Uint8Array[] = [];
  if (sources.has("sky-exclude") && input.depth) {
    parts.push(skyExcludeMask(input.depth, input.skyDepthMin));
  }
  if (sources.has("coverage") && input.depth) {
    parts.push(coverageMaskFromDepth(input.depth, input.skyDepthMin));
  }
  if (sources.has("roi") && input.rois && input.rois.length > 0 && input.viewProjection) {
    const roiMasks = input.rois.map((roi) => rasterizeWorldRoi(input.width, input.height, input.viewProjection!, roi));
    parts.push(orMasks(input.width, input.height, roiMasks));
  }
  if (sources.has("ownership") && input.ownership) {
    parts.push(input.ownership);
  }
  const mask = parts.length === 0
    ? new Uint8Array(input.width * input.height).fill(1)
    : combineMasks(input.width, input.height, parts);
  return { mask, coverage: maskCoverage(mask) };
}

function defaultMaskSources(input: {
  depth?: Float32Array;
  rois?: readonly VisualSequenceRoi[];
}): string[] {
  const sources: string[] = [];
  if (input.depth) sources.push("sky-exclude");
  if (input.rois && input.rois.length > 0) sources.push("roi");
  return sources;
}

function transform(matrix: readonly number[], vector: readonly [number, number, number, number]): [number, number, number, number] {
  if (matrix.length !== 16) throw new Error("matrix must contain 16 values");
  return [
    matrix[0]! * vector[0] + matrix[4]! * vector[1] + matrix[8]! * vector[2] + matrix[12]! * vector[3],
    matrix[1]! * vector[0] + matrix[5]! * vector[1] + matrix[9]! * vector[2] + matrix[13]! * vector[3],
    matrix[2]! * vector[0] + matrix[6]! * vector[1] + matrix[10]! * vector[2] + matrix[14]! * vector[3],
    matrix[3]! * vector[0] + matrix[7]! * vector[1] + matrix[11]! * vector[2] + matrix[15]! * vector[3],
  ];
}
