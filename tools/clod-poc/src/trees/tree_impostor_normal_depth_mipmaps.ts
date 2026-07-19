import { TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS } from "./tree_impostor_mipmap_constants.js";
import {
  createTreeImpostorMipLevel,
  createTreeImpostorMipPlans,
  decodeTreeImpostorNormalByte,
  encodeTreeImpostorNormalByte,
  treeImpostorMipLevel,
  treeImpostorMipOperations,
  treeImpostorMipPixelOffset,
  validateTreeImpostorCoverageMipmaps,
  validateTreeImpostorMipInput,
  validateTreeImpostorMipPixels,
  type TreeImpostorMipChannelJob,
  type TreeImpostorMipLevel,
  type TreeImpostorMipPlan,
  type TreeImpostorNormalDepthMipInput,
} from "./tree_impostor_mipmap_common.js";
import { buildTreeImpostorAlbedoMipmaps } from "./tree_impostor_albedo_mipmaps.js";

export function createTreeImpostorNormalDepthMipJob(
  input: TreeImpostorNormalDepthMipInput,
  plans = createTreeImpostorMipPlans(input.width, input.height, input.tileSize),
): TreeImpostorMipChannelJob {
  validateTreeImpostorMipInput(
    input.pixels,
    input.width,
    input.height,
    input.tileSize,
    "tree impostor normal-depth mipmaps",
  );
  validateTreeImpostorMipPixels(
    input.coveragePixels,
    input.width,
    input.height,
    "tree impostor mip coverage",
  );
  const coverageMipmaps = input.coverageMipmaps ?? [];
  validateTreeImpostorCoverageMipmaps(coverageMipmaps, plans);

  const mipmaps: TreeImpostorMipLevel[] = [];
  let source = treeImpostorMipLevel(input.pixels, input.width, input.height);
  let target: TreeImpostorMipLevel | null = null;
  let coverageSource: TreeImpostorMipLevel | null = null;
  let planIndex = 0;
  let pixelIndex = 0;
  let completed = 0;
  const total = plans.reduce(
    (sum, plan) => sum + plan.targetWidth * plan.targetHeight,
    0,
  );

  const beginLevel = (): void => {
    const plan = plans[planIndex];
    target = plan
      ? createTreeImpostorMipLevel(plan.targetWidth, plan.targetHeight)
      : null;
    coverageSource = plan
      ? planIndex === 0
        ? treeImpostorMipLevel(input.coveragePixels, input.width, input.height)
        : coverageMipmaps[planIndex - 1] as TreeImpostorMipLevel
      : null;
    pixelIndex = 0;
  };
  if (plans.length > 0) beginLevel();

  return {
    step(maxOperations = TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS): boolean {
      const limit = treeImpostorMipOperations(maxOperations);
      let operations = 0;
      while (planIndex < plans.length && operations < limit) {
        const plan = plans[planIndex] as TreeImpostorMipPlan;
        const currentTarget = target as TreeImpostorMipLevel;
        const targetX = pixelIndex % plan.targetWidth;
        const targetY = Math.floor(pixelIndex / plan.targetWidth);
        downsampleNormalDepthBox(
          source,
          coverageSource as TreeImpostorMipLevel,
          currentTarget.data,
          treeImpostorMipPixelOffset(currentTarget.width, targetX, targetY),
          targetX * 2,
          targetY * 2,
        );
        pixelIndex++;
        completed++;
        operations++;
        if (pixelIndex >= plan.targetWidth * plan.targetHeight) {
          mipmaps.push(currentTarget);
          source = currentTarget;
          planIndex++;
          if (planIndex < plans.length) beginLevel();
        }
      }
      return planIndex >= plans.length;
    },
    completed: () => completed,
    total: () => total,
    result(): readonly TreeImpostorMipLevel[] {
      if (planIndex < plans.length) {
        throw new Error(
          "tree impostor normal-depth mipmaps requested before generation completed",
        );
      }
      return mipmaps;
    },
  };
}

export function buildTreeImpostorNormalDepthMipmaps(
  input: TreeImpostorNormalDepthMipInput,
): TreeImpostorMipLevel[] {
  const coverageMipmaps = input.coverageMipmaps ?? buildTreeImpostorAlbedoMipmaps({
    pixels: input.coveragePixels,
    width: input.width,
    height: input.height,
    tileSize: input.tileSize,
    alphaTest: input.alphaTest,
  });
  const job = createTreeImpostorNormalDepthMipJob({
    ...input,
    coverageMipmaps,
  });
  while (!job.step(Number.MAX_SAFE_INTEGER)) {
    // Synchronous test and compatibility path.
  }
  return [...job.result()];
}

function downsampleNormalDepthBox(
  source: TreeImpostorMipLevel,
  coverageSource: TreeImpostorMipLevel,
  targetPixels: Uint8Array,
  targetOffset: number,
  sourceX: number,
  sourceY: number,
): void {
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let depth = 0;
  let weightSum = 0;
  let fallbackX = 0;
  let fallbackY = 0;
  let fallbackZ = 0;
  let fallbackDepth = 0;

  for (let y = sourceY; y < sourceY + 2; y++) {
    for (let x = sourceX; x < sourceX + 2; x++) {
      const offset = treeImpostorMipPixelOffset(source.width, x, y);
      const coverageOffset = treeImpostorMipPixelOffset(
        coverageSource.width,
        x,
        y,
      );
      const xNormal = decodeTreeImpostorNormalByte(source.data[offset] as number);
      const yNormal = decodeTreeImpostorNormalByte(
        source.data[offset + 1] as number,
      );
      const zNormal = decodeTreeImpostorNormalByte(
        source.data[offset + 2] as number,
      );
      const sampleDepth = source.data[offset + 3] as number;
      const weight = (coverageSource.data[coverageOffset + 3] as number) / 255;
      normalX += xNormal * weight;
      normalY += yNormal * weight;
      normalZ += zNormal * weight;
      depth += sampleDepth * weight;
      weightSum += weight;
      fallbackX += xNormal;
      fallbackY += yNormal;
      fallbackZ += zNormal;
      fallbackDepth += sampleDepth;
    }
  }

  if (weightSum > 1e-6) {
    normalX /= weightSum;
    normalY /= weightSum;
    normalZ /= weightSum;
    depth /= weightSum;
  } else {
    normalX = fallbackX / 4;
    normalY = fallbackY / 4;
    normalZ = fallbackZ / 4;
    depth = fallbackDepth / 4;
  }

  const length = Math.hypot(normalX, normalY, normalZ);
  if (length > 1e-6) {
    normalX /= length;
    normalY /= length;
    normalZ /= length;
  } else {
    normalX = 0;
    normalY = 1;
    normalZ = 0;
  }

  targetPixels[targetOffset] = encodeTreeImpostorNormalByte(normalX);
  targetPixels[targetOffset + 1] = encodeTreeImpostorNormalByte(normalY);
  targetPixels[targetOffset + 2] = encodeTreeImpostorNormalByte(normalZ);
  targetPixels[targetOffset + 3] = Math.min(
    255,
    Math.max(0, Math.round(depth)),
  );
}
