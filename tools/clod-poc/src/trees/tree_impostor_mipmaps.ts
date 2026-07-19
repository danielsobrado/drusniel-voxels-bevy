import { createTreeImpostorAlbedoMipJob } from "./tree_impostor_albedo_mipmaps.js";
import { TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS } from "./tree_impostor_mipmap_constants.js";
import {
  createTreeImpostorMipPlans,
  treeImpostorMipOperations,
  validateTreeImpostorMipInput,
  type TreeImpostorMipChannelJob,
  type TreeImpostorMipChains,
  type TreeImpostorMipJob,
} from "./tree_impostor_mipmap_common.js";
import { createTreeImpostorNormalDepthMipJob } from "./tree_impostor_normal_depth_mipmaps.js";

export { buildTreeImpostorAlbedoMipmaps } from "./tree_impostor_albedo_mipmaps.js";
export { TREE_IMPOSTOR_MIP_ALPHA_TEST } from "./tree_impostor_mipmap_constants.js";
export type {
  TreeImpostorAlbedoMipInput,
  TreeImpostorMipChains,
  TreeImpostorMipJob,
  TreeImpostorMipLevel,
  TreeImpostorNormalDepthMipInput,
} from "./tree_impostor_mipmap_common.js";
export { buildTreeImpostorNormalDepthMipmaps } from "./tree_impostor_normal_depth_mipmaps.js";

export function createTreeImpostorMipJob(input: {
  albedo: Uint8Array;
  normalDepth: Uint8Array;
  width: number;
  height: number;
  tileSize: number;
  alphaTest?: number;
}): TreeImpostorMipJob {
  validateTreeImpostorMipInput(
    input.albedo,
    input.width,
    input.height,
    input.tileSize,
    "tree impostor albedo mipmaps",
  );
  validateTreeImpostorMipInput(
    input.normalDepth,
    input.width,
    input.height,
    input.tileSize,
    "tree impostor normal-depth mipmaps",
  );
  const plans = createTreeImpostorMipPlans(
    input.width,
    input.height,
    input.tileSize,
  );
  const albedoJob = createTreeImpostorAlbedoMipJob({
    pixels: input.albedo,
    width: input.width,
    height: input.height,
    tileSize: input.tileSize,
    alphaTest: input.alphaTest,
  }, plans);
  let normalDepthJob: TreeImpostorMipChannelJob | null = null;
  let phase: "albedo" | "normal-depth" | "done" = plans.length > 0
    ? "albedo"
    : "done";

  return {
    step(maxOperations = TREE_IMPOSTOR_MIP_DEFAULT_OPERATIONS): boolean {
      let remaining = treeImpostorMipOperations(maxOperations);
      while (remaining > 0 && phase !== "done") {
        const active = phase === "albedo"
          ? albedoJob
          : normalDepthJob ??= createTreeImpostorNormalDepthMipJob({
              pixels: input.normalDepth,
              coveragePixels: input.albedo,
              width: input.width,
              height: input.height,
              tileSize: input.tileSize,
              alphaTest: input.alphaTest,
              coverageMipmaps: albedoJob.result(),
            }, plans);
        const before = active.completed();
        const done = active.step(remaining);
        remaining -= Math.max(1, active.completed() - before);
        if (!done) break;
        phase = phase === "albedo" ? "normal-depth" : "done";
      }
      return phase === "done";
    },
    completed: () => albedoJob.completed() + (normalDepthJob?.completed() ?? 0),
    total: () => albedoJob.total() + plans.reduce(
      (total, plan) => total + plan.targetWidth * plan.targetHeight,
      0,
    ),
    result(): TreeImpostorMipChains {
      if (phase !== "done") {
        throw new Error(
          "tree impostor mipmaps requested before generation completed",
        );
      }
      return {
        albedo: albedoJob.result(),
        normalDepth: normalDepthJob?.result() ?? [],
      };
    },
  };
}
