import { residualMetrics, type ImagePlane, type ResidualMetrics } from "./metrics.js";

export interface ReprojectionInput {
  previousColor: ImagePlane;
  currentColor: ImagePlane;
  previousDepth: Float32Array;
  currentDepth: Float32Array;
  previousViewProjection: readonly number[];
  currentViewProjectionInverse: readonly number[];
  depthTolerance?: number;
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
    const depth = input.currentDepth[p]!;
    if (!(depth >= 0 && depth <= 1)) continue;
    const ndc = [((x + 0.5) / currentColor.width) * 2 - 1, 1 - ((y + 0.5) / currentColor.height) * 2, depth * 2 - 1, 1] as const;
    const world = transform(input.currentViewProjectionInverse, ndc);
    const previousClip = transform(input.previousViewProjection, world);
    if (Math.abs(previousClip[3]) < 1e-8) continue;
    const previousNdcX = previousClip[0] / previousClip[3];
    const previousNdcY = previousClip[1] / previousClip[3];
    const previousNdcZ = previousClip[2] / previousClip[3];
    const px = Math.round((previousNdcX * 0.5 + 0.5) * currentColor.width - 0.5);
    const py = Math.round((0.5 - previousNdcY * 0.5) * currentColor.height - 0.5);
    if (px < 0 || py < 0 || px >= currentColor.width || py >= currentColor.height) continue;
    const previousP = py * currentColor.width + px;
    const projectedDepth = previousNdcZ * 0.5 + 0.5;
    if (Math.abs(input.previousDepth[previousP]! - projectedDepth) > tolerance) continue;
    for (let c = 0; c < channels; c++) reprojected[p * channels + c] = previousColor.data[previousP * channels + c] ?? 0;
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

function transform(matrix: readonly number[], vector: readonly [number, number, number, number]): [number, number, number, number] {
  if (matrix.length !== 16) throw new Error("matrix must contain 16 values");
  return [
    matrix[0]! * vector[0] + matrix[4]! * vector[1] + matrix[8]! * vector[2] + matrix[12]! * vector[3],
    matrix[1]! * vector[0] + matrix[5]! * vector[1] + matrix[9]! * vector[2] + matrix[13]! * vector[3],
    matrix[2]! * vector[0] + matrix[6]! * vector[1] + matrix[10]! * vector[2] + matrix[14]! * vector[3],
    matrix[3]! * vector[0] + matrix[7]! * vector[1] + matrix[11]! * vector[2] + matrix[15]! * vector[3],
  ];
}
