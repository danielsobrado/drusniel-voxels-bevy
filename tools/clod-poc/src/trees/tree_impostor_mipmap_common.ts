import {
  TREE_IMPOSTOR_MIP_BYTES_PER_PIXEL,
  TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS,
  TREE_IMPOSTOR_MIP_NORMAL_BYTE_CENTER,
} from "./tree_impostor_mipmap_constants.js";

export interface TreeImpostorMipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface TreeImpostorAlbedoMipInput {
  pixels: Uint8Array;
  width: number;
  height: number;
  tileSize: number;
  alphaTest?: number;
}

export interface TreeImpostorNormalDepthMipInput extends TreeImpostorAlbedoMipInput {
  coveragePixels: Uint8Array;
  coverageMipmaps?: readonly TreeImpostorMipLevel[];
}

export interface TreeImpostorMipChains {
  albedo: readonly TreeImpostorMipLevel[];
  normalDepth: readonly TreeImpostorMipLevel[];
}

export interface TreeImpostorMipJob {
  step(maxOperations?: number): boolean;
  completed(): number;
  total(): number;
  result(): TreeImpostorMipChains;
}

export interface TreeImpostorMipChannelJob {
  step(maxOperations?: number): boolean;
  completed(): number;
  total(): number;
  result(): readonly TreeImpostorMipLevel[];
}

export interface TreeImpostorMipPlan {
  sourceWidth: number;
  sourceHeight: number;
  sourceTileSize: number;
  targetWidth: number;
  targetHeight: number;
  targetTileSize: number;
  tilesX: number;
  tilesY: number;
}

export function createTreeImpostorMipPlans(
  width: number,
  height: number,
  tileSize: number,
): TreeImpostorMipPlan[] {
  const plans: TreeImpostorMipPlan[] = [];
  let sourceWidth = width;
  let sourceHeight = height;
  let sourceTileSize = tileSize;
  while (
    sourceTileSize > 1
    && sourceTileSize % 2 === 0
    && sourceWidth % sourceTileSize === 0
    && sourceHeight % sourceTileSize === 0
  ) {
    const targetWidth = sourceWidth / 2;
    const targetHeight = sourceHeight / 2;
    const targetTileSize = sourceTileSize / 2;
    plans.push({
      sourceWidth,
      sourceHeight,
      sourceTileSize,
      targetWidth,
      targetHeight,
      targetTileSize,
      tilesX: sourceWidth / sourceTileSize,
      tilesY: sourceHeight / sourceTileSize,
    });
    sourceWidth = targetWidth;
    sourceHeight = targetHeight;
    sourceTileSize = targetTileSize;
  }
  return plans;
}

export function createTreeImpostorMipLevel(width: number, height: number): TreeImpostorMipLevel {
  return {
    data: new Uint8Array(width * height * TREE_IMPOSTOR_MIP_BYTES_PER_PIXEL),
    width,
    height,
  };
}

export function treeImpostorMipLevel(
  data: Uint8Array,
  width: number,
  height: number,
): TreeImpostorMipLevel {
  return { data, width, height };
}

export function validateTreeImpostorMipInput(
  pixels: Uint8Array,
  width: number,
  height: number,
  tileSize: number,
  operation: string,
): void {
  validateTreeImpostorMipPixels(pixels, width, height, operation);
  if (!Number.isInteger(tileSize) || tileSize <= 0 || width % tileSize !== 0 || height % tileSize !== 0) {
    throw new Error(`${operation} tile size ${tileSize} does not divide ${width}x${height}`);
  }
}

export function validateTreeImpostorMipPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  operation: string,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${operation} received invalid dimensions ${width}x${height}`);
  }
  const expectedLength = width * height * TREE_IMPOSTOR_MIP_BYTES_PER_PIXEL;
  if (pixels.length !== expectedLength) {
    throw new Error(`${operation} received ${pixels.length} bytes; expected ${expectedLength}`);
  }
}

export function validateTreeImpostorCoverageMipmaps(
  mipmaps: readonly TreeImpostorMipLevel[],
  plans: readonly TreeImpostorMipPlan[],
): void {
  if (mipmaps.length !== plans.length) {
    throw new Error(`tree impostor coverage mip count ${mipmaps.length} does not match ${plans.length}`);
  }
  for (let index = 0; index < plans.length; index++) {
    const mipmap = mipmaps[index] as TreeImpostorMipLevel;
    const plan = plans[index] as TreeImpostorMipPlan;
    validateTreeImpostorMipPixels(
      mipmap.data,
      plan.targetWidth,
      plan.targetHeight,
      `tree impostor coverage mip ${index}`,
    );
  }
}

export function treeImpostorMipPixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * TREE_IMPOSTOR_MIP_BYTES_PER_PIXEL;
}

export function treeImpostorMipOperations(value: number): number {
  return Math.max(
    1,
    Math.floor(Number.isFinite(value) ? value : TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS),
  );
}

export function treeImpostorMipAlphaByte(alphaTest: number): number {
  if (!Number.isFinite(alphaTest) || alphaTest < 0 || alphaTest > 1) {
    throw new Error(`tree impostor mip alpha test must be within 0..1; received ${alphaTest}`);
  }
  return Math.round(alphaTest * 255);
}

export function decodeTreeImpostorNormalByte(value: number): number {
  return (value - TREE_IMPOSTOR_MIP_NORMAL_BYTE_CENTER) / TREE_IMPOSTOR_MIP_NORMAL_BYTE_CENTER;
}

export function encodeTreeImpostorNormalByte(value: number): number {
  return Math.min(
    255,
    Math.max(
      0,
      Math.round(
        value * TREE_IMPOSTOR_MIP_NORMAL_BYTE_CENTER + TREE_IMPOSTOR_MIP_NORMAL_BYTE_CENTER,
      ),
    ),
  );
}
