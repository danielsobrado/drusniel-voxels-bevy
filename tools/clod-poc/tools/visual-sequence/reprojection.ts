import { residualMetrics, type ImagePlane, type ResidualMetrics } from "./metrics.js";

export interface ReprojectionInput {
  previousColor: ImagePlane;
  currentColor: ImagePlane;
  previousDepth: Float32Array;
  currentDepth: Float32Array;
  previousViewProjection: readonly number[];
  currentViewProjectionInverse: readonly number[];
  depthTolerance?: number;
  evaluationMask?: Uint8Array;
}

export interface ReprojectionResult {
  residual: ResidualMetrics;
  validRatio: number;
  disoccludedRatio: number;
  mask: Uint8Array;
}

export function reprojectedResidual(input: ReprojectionInput): ReprojectionResult {
  const { previousColor, currentColor } = input;
  if (previousColor.width !== currentColor.width || previousColor.height !== currentColor.height) throw new Error("reprojection image sizes differ");
  const pixels = currentColor.width * currentColor.height;
  if (input.previousDepth.length !== pixels || input.currentDepth.length !== pixels) throw new Error("reprojection depth sizes differ");
  const channels = currentColor.channels ?? 4;
  const reprojected = new Uint8Array(pixels * channels);
  const mask = new Uint8Array(pixels);
  const tolerance = input.depthTolerance ?? 0.01;
  let valid = 0;
  for (let y = 0; y < currentColor.height; y++) for (let x = 0; x < currentColor.width; x++) {
    const p = y * currentColor.width + x;
    if (input.evaluationMask && input.evaluationMask[p] === 0) continue;
    const depth = input.currentDepth[p]!;
    if (!(depth >= 0 && depth <= 1)) continue;
    // The sequence harness is WebGPU-only, whose camera projection uses zero-to-one clip depth.
    const ndc = [((x + 0.5) / currentColor.width) * 2 - 1, 1 - ((y + 0.5) / currentColor.height) * 2, depth, 1] as const;
    const world = transform(input.currentViewProjectionInverse, ndc);
    const previousClip = transform(input.previousViewProjection, world);
    if (Math.abs(previousClip[3]) < 1e-8) continue;
    const previousNdcX = previousClip[0] / previousClip[3];
    const previousNdcY = previousClip[1] / previousClip[3];
    const previousNdcZ = previousClip[2] / previousClip[3];
    const px = (previousNdcX * 0.5 + 0.5) * currentColor.width - 0.5;
    const py = (0.5 - previousNdcY * 0.5) * currentColor.height - 0.5;
    if (px < 0 || py < 0 || px > currentColor.width - 1 || py > currentColor.height - 1) continue;
    const projectedDepth = previousNdcZ;
    if (Math.abs(sampleScalar(input.previousDepth, currentColor.width, currentColor.height, px, py) - projectedDepth) > tolerance) continue;
    for (let c = 0; c < channels; c++) {
      reprojected[p * channels + c] = Math.round(sampleChannel(previousColor, px, py, c));
    }
    mask[p] = 1;
    valid += 1;
  }
  return {
    residual: residualMetrics({ ...currentColor, data: reprojected }, currentColor, mask),
    validRatio: valid / pixels,
    disoccludedRatio: 1 - valid / pixels,
    mask,
  };
}

function sampleScalar(data: Float32Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return bilerp(data[y0 * width + x0]!, data[y0 * width + x1]!, data[y1 * width + x0]!, data[y1 * width + x1]!, tx, ty);
}

function sampleChannel(image: ImagePlane, x: number, y: number, channel: number): number {
  const channels = image.channels ?? 4;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return bilerp(
    image.data[(y0 * image.width + x0) * channels + channel] ?? 0,
    image.data[(y0 * image.width + x1) * channels + channel] ?? 0,
    image.data[(y1 * image.width + x0) * channels + channel] ?? 0,
    image.data[(y1 * image.width + x1) * channels + channel] ?? 0,
    tx,
    ty,
  );
}

function bilerp(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
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
