import {
  VEGETATION_CATEGORY_BY_NAME,
  VEGETATION_CATEGORY_NAMES,
  type VegetationCategoryName,
} from "./constants.js";
import type { VegetationGpuAuthorityConfig, VegetationQualityPreset } from "./config.js";
import { candidateCountForCluster, clusterCoordinatesForWorld } from "./cluster_grid.js";
import type { VegetationClusterDescriptor } from "./types.js";

export interface VegetationClusterPlanInput {
  readonly config: VegetationGpuAuthorityConfig;
  readonly quality: VegetationQualityPreset;
  readonly cameraWorldX: number;
  readonly cameraWorldZ: number;
  readonly terrainRevision: number;
  readonly providerRevision: number;
}

function u32(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${path} must be a u32`);
  return value >>> 0;
}

function snappedCameraCluster(input: VegetationClusterPlanInput): { clusterX: number; clusterZ: number } {
  const camera = clusterCoordinatesForWorld(
    input.cameraWorldX,
    input.cameraWorldZ,
    input.config.clusterSizeM,
  );
  const snap = input.config.invalidation.cameraClusterSnap;
  return {
    clusterX: Math.floor(camera.clusterX / snap) * snap,
    clusterZ: Math.floor(camera.clusterZ / snap) * snap,
  };
}

function categoryRadiusClusters(
  config: VegetationGpuAuthorityConfig,
  quality: VegetationQualityPreset,
  category: VegetationCategoryName,
): number {
  return Math.ceil(config.maximumClusterDistanceM[quality][category] / config.clusterSizeM);
}

export function vegetationClusterDescriptorCapacity(
  config: VegetationGpuAuthorityConfig,
  quality: VegetationQualityPreset,
): number {
  return VEGETATION_CATEGORY_NAMES.reduce((total, category) => {
    const radius = categoryRadiusClusters(config, quality, category);
    const diameter = radius * 2 + 1;
    return total + diameter * diameter;
  }, 0);
}

export function planVegetationClusterDescriptors(
  input: VegetationClusterPlanInput,
): readonly VegetationClusterDescriptor[] {
  const center = snappedCameraCluster(input);
  const terrainRevision = u32(input.terrainRevision, "terrainRevision");
  const providerRevision = u32(input.providerRevision, "providerRevision");
  const descriptors: VegetationClusterDescriptor[] = [];

  for (const categoryName of VEGETATION_CATEGORY_NAMES) {
    const category = VEGETATION_CATEGORY_BY_NAME[categoryName];
    const radius = categoryRadiusClusters(input.config, input.quality, categoryName);
    const spacingM = input.config.candidateSpacingM[categoryName];
    for (let clusterZ = center.clusterZ - radius; clusterZ <= center.clusterZ + radius; clusterZ++) {
      for (let clusterX = center.clusterX - radius; clusterX <= center.clusterX + radius; clusterX++) {
        descriptors.push(Object.freeze({
          clusterX,
          clusterZ,
          category,
          candidateCount: candidateCountForCluster(
            clusterX,
            clusterZ,
            input.config.clusterSizeM,
            spacingM,
          ),
          terrainRevision,
          providerRevision,
          flags: 0,
          reserved: 0,
        }));
      }
    }
  }

  const expectedCapacity = vegetationClusterDescriptorCapacity(input.config, input.quality);
  if (descriptors.length !== expectedCapacity) {
    throw new Error(`vegetation cluster planner produced ${descriptors.length} descriptors; expected ${expectedCapacity}`);
  }
  return Object.freeze(descriptors);
}
