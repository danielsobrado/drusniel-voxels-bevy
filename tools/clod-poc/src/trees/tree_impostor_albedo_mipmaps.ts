import {
  TREE_IMPOSTOR_MIP_ALPHA_TEST,
  TREE_IMPOSTOR_MIP_COVERAGE_SEARCH_STEPS,
  TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS,
  TREE_IMPOSTOR_MIP_MAX_COVERAGE_SCALE,
} from "./tree_impostor_mipmap_constants.js";
import {
  createTreeImpostorMipLevel,
  createTreeImpostorMipPlans,
  treeImpostorMipAlphaByte,
  treeImpostorMipLevel,
  treeImpostorMipOperations,
  treeImpostorMipPixelOffset,
  validateTreeImpostorMipInput,
  type TreeImpostorAlbedoMipInput,
  type TreeImpostorMipChannelJob,
  type TreeImpostorMipLevel,
  type TreeImpostorMipPlan,
} from "./tree_impostor_mipmap_common.js";

export function createTreeImpostorAlbedoMipJob(
  input: TreeImpostorAlbedoMipInput,
  plans = createTreeImpostorMipPlans(input.width, input.height, input.tileSize),
): TreeImpostorMipChannelJob {
  validateTreeImpostorMipInput(
    input.pixels,
    input.width,
    input.height,
    input.tileSize,
    "tree impostor albedo mipmaps",
  );
  const alphaThreshold = treeImpostorMipAlphaByte(
    input.alphaTest ?? TREE_IMPOSTOR_MIP_ALPHA_TEST,
  );
  const mipmaps: TreeImpostorMipLevel[] = [];
  const histogram = new Uint32Array(256);
  let source = treeImpostorMipLevel(input.pixels, input.width, input.height);
  let target: TreeImpostorMipLevel | null = null;
  let planIndex = 0;
  let tileIndex = 0;
  let pixelIndex = 0;
  let sourceCovered = 0;
  let coverageScaleValue = 1;
  let phase: "downsample" | "scale" = "downsample";
  let completed = 0;
  const total = plans.reduce(
    (sum, plan) => sum + plan.targetWidth * plan.targetHeight * 2,
    0,
  );

  const beginLevel = (): void => {
    const plan = plans[planIndex];
    target = plan
      ? createTreeImpostorMipLevel(plan.targetWidth, plan.targetHeight)
      : null;
    tileIndex = 0;
    pixelIndex = 0;
    sourceCovered = 0;
    phase = "downsample";
  };
  if (plans.length > 0) beginLevel();

  return {
    step(maxOperations = TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS): boolean {
      const limit = treeImpostorMipOperations(maxOperations);
      let operations = 0;
      while (planIndex < plans.length && operations < limit) {
        const plan = plans[planIndex] as TreeImpostorMipPlan;
        const currentTarget = target as TreeImpostorMipLevel;
        const tilePixelCount = plan.targetTileSize * plan.targetTileSize;
        const tileX = tileIndex % plan.tilesX;
        const tileY = Math.floor(tileIndex / plan.tilesX);
        const localX = pixelIndex % plan.targetTileSize;
        const localY = Math.floor(pixelIndex / plan.targetTileSize);
        const targetX = tileX * plan.targetTileSize + localX;
        const targetY = tileY * plan.targetTileSize + localY;
        const targetOffset = treeImpostorMipPixelOffset(
          currentTarget.width,
          targetX,
          targetY,
        );

        if (phase === "downsample") {
          if (pixelIndex === 0) {
            histogram.fill(0);
            sourceCovered = 0;
          }
          const sourceX = tileX * plan.sourceTileSize + localX * 2;
          const sourceY = tileY * plan.sourceTileSize + localY * 2;
          sourceCovered += downsampleAlbedoBox(
            source,
            currentTarget.data,
            targetOffset,
            sourceX,
            sourceY,
            alphaThreshold,
          );
          histogram[currentTarget.data[targetOffset + 3] as number]++;
          pixelIndex++;
          if (pixelIndex >= tilePixelCount) {
            const expectedCovered = expectedTargetCoverage(
              sourceCovered,
              plan.sourceTileSize * plan.sourceTileSize,
              tilePixelCount,
            );
            coverageScaleValue = expectedCovered > 0
              ? coverageScale(histogram, expectedCovered, alphaThreshold)
              : 0;
            pixelIndex = 0;
            phase = "scale";
          }
        } else {
          scalePremultipliedPixel(
            currentTarget.data,
            targetOffset,
            coverageScaleValue,
          );
          pixelIndex++;
          if (pixelIndex >= tilePixelCount) {
            pixelIndex = 0;
            tileIndex++;
            phase = "downsample";
            if (tileIndex >= plan.tilesX * plan.tilesY) {
              mipmaps.push(currentTarget);
              source = currentTarget;
              planIndex++;
              if (planIndex < plans.length) beginLevel();
            }
          }
        }
        completed++;
        operations++;
      }
      return planIndex >= plans.length;
    },
    completed: () => completed,
    total: () => total,
    result(): readonly TreeImpostorMipLevel[] {
      if (planIndex < plans.length) {
        throw new Error(
          "tree impostor albedo mipmaps requested before generation completed",
        );
      }
      return mipmaps;
    },
  };
}

export function buildTreeImpostorAlbedoMipmaps(
  input: TreeImpostorAlbedoMipInput,
): TreeImpostorMipLevel[] {
  const job = createTreeImpostorAlbedoMipJob(input);
  while (!job.step(Number.MAX_SAFE_INTEGER)) {
    // Synchronous test and compatibility path.
  }
  return [...job.result()];
}

function downsampleAlbedoBox(
  source: TreeImpostorMipLevel,
  targetPixels: Uint8Array,
  targetOffset: number,
  sourceX: number,
  sourceY: number,
  alphaThreshold: number,
): number {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let covered = 0;

  for (let y = sourceY; y < sourceY + 2; y++) {
    for (let x = sourceX; x < sourceX + 2; x++) {
      const offset = treeImpostorMipPixelOffset(source.width, x, y);
      red += source.data[offset] as number;
      green += source.data[offset + 1] as number;
      blue += source.data[offset + 2] as number;
      const sampleAlpha = source.data[offset + 3] as number;
      alpha += sampleAlpha;
      if (sampleAlpha > alphaThreshold) covered++;
    }
  }

  targetPixels[targetOffset] = Math.round(red / 4);
  targetPixels[targetOffset + 1] = Math.round(green / 4);
  targetPixels[targetOffset + 2] = Math.round(blue / 4);
  targetPixels[targetOffset + 3] = Math.round(alpha / 4);
  return covered;
}

function expectedTargetCoverage(
  sourceCovered: number,
  sourcePixelCount: number,
  targetPixelCount: number,
): number {
  if (sourceCovered <= 0 || targetPixelCount <= 0) return 0;
  return Math.max(
    1,
    Math.min(
      targetPixelCount,
      Math.round((sourceCovered / sourcePixelCount) * targetPixelCount),
    ),
  );
}

function coverageScale(
  histogram: Uint32Array,
  expectedCovered: number,
  alphaThreshold: number,
): number {
  let low = 0;
  let high = TREE_IMPOSTOR_MIP_MAX_COVERAGE_SCALE;
  for (let step = 0; step < TREE_IMPOSTOR_MIP_COVERAGE_SEARCH_STEPS; step++) {
    const midpoint = (low + high) * 0.5;
    if (coveredAfterScale(histogram, midpoint, alphaThreshold) >= expectedCovered) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return high;
}

function coveredAfterScale(
  histogram: Uint32Array,
  scale: number,
  alphaThreshold: number,
): number {
  let covered = 0;
  for (let alpha = 1; alpha < histogram.length; alpha++) {
    if (Math.min(255, Math.round(alpha * scale)) > alphaThreshold) {
      covered += histogram[alpha] as number;
    }
  }
  return covered;
}

function scalePremultipliedPixel(
  pixels: Uint8Array,
  offset: number,
  scale: number,
): void {
  const alpha = pixels[offset + 3] as number;
  if (alpha <= 0 || scale <= 0) {
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 0;
    return;
  }
  const scaledAlpha = Math.min(255, Math.max(0, Math.round(alpha * scale)));
  const ratio = scaledAlpha / alpha;
  pixels[offset] = Math.min(255, Math.round((pixels[offset] as number) * ratio));
  pixels[offset + 1] = Math.min(
    255,
    Math.round((pixels[offset + 1] as number) * ratio),
  );
  pixels[offset + 2] = Math.min(
    255,
    Math.round((pixels[offset + 2] as number) * ratio),
  );
  pixels[offset + 3] = scaledAlpha;
}
