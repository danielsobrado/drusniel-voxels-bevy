import { load } from "js-yaml";
import {
  VEGETATION_CATEGORY_NAMES,
  VEGETATION_CLUSTER_PROBE_GRID,
  VEGETATION_CLUSTER_SIZE_M,
  VEGETATION_SCHEMA_VERSION,
  type VegetationCategoryName,
} from "./constants.js";

export const VEGETATION_QUALITY_PRESETS = ["ultra", "balanced", "perf", "potato"] as const;
export type VegetationQualityPreset = typeof VEGETATION_QUALITY_PRESETS[number];
export type VegetationCategoryValues = Readonly<Record<VegetationCategoryName, number>>;
export type VegetationPresetCategoryValues = Readonly<Record<VegetationQualityPreset, VegetationCategoryValues>>;

export interface VegetationGpuAuthorityConfig {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly clusterSizeM: number;
  readonly clusterProbeGrid: number;
  readonly nearForceVisibleRadiusM: number;
  readonly maximumClusterDistanceM: VegetationPresetCategoryValues;
  readonly candidateSpacingM: VegetationCategoryValues;
  readonly acceptedInstanceCapacity: VegetationPresetCategoryValues;
  readonly authorityBufferVramMibMax: Readonly<Record<VegetationQualityPreset, number>>;
  readonly portableStorageBindingMibMax: number;
  readonly rejection: {
    readonly maximumTreeSlopeDegrees: number;
    readonly maximumGrassSlopeDegrees: number;
    readonly maximumUnderstorySlopeDegrees: number;
    readonly supportRayDepthM: number;
    readonly deepWaterM: number;
  };
  readonly invalidation: {
    readonly cameraClusterSnap: number;
    readonly terrainRevisionRequired: boolean;
    readonly providerRevisionRequired: boolean;
  };
  readonly debug: {
    readonly readbackCounts: boolean;
    readonly validateAgainstCpu: boolean;
    readonly showClusterReasons: boolean;
  };
}

const ROOT_KEYS = ["vegetation_gpu_authority"] as const;
const AUTHORITY_KEYS = [
  "schema_version",
  "enabled",
  "cluster_size_m",
  "cluster_probe_grid",
  "near_force_visible_radius_m",
  "maximum_cluster_distance_m",
  "candidate_spacing_m",
  "accepted_instance_capacity",
  "authority_buffer_vram_mib_max",
  "portable_storage_binding_mib_max",
  "rejection",
  "invalidation",
  "debug",
] as const;
const REJECTION_KEYS = [
  "maximum_tree_slope_degrees",
  "maximum_grass_slope_degrees",
  "maximum_understory_slope_degrees",
  "support_ray_depth_m",
  "deep_water_m",
] as const;
const INVALIDATION_KEYS = [
  "camera_cluster_snap",
  "terrain_revision_required",
  "provider_revision_required",
] as const;
const DEBUG_KEYS = ["readback_counts", "validate_against_cpu", "show_cluster_reasons"] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be a mapping`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function finiteNumber(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  if (value < minimum || value > maximum) throw new Error(`${path} must be in [${minimum}, ${maximum}]`);
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum = 0xffff_ffff): number {
  const parsed = finiteNumber(value, path, minimum, maximum);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} must be an integer`);
  return parsed;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function fixedNumber(value: unknown, expected: number, path: string): number {
  const parsed = finiteNumber(value, path, expected, expected);
  if (parsed !== expected) throw new Error(`${path} must be ${expected}`);
  return parsed;
}

function categoryValues(value: unknown, path: string, integerOnly: boolean): VegetationCategoryValues {
  const source = record(value, path);
  rejectUnknown(source, VEGETATION_CATEGORY_NAMES, path);
  const parse = integerOnly
    ? (entry: unknown, entryPath: string) => integer(entry, entryPath, 1)
    : (entry: unknown, entryPath: string) => finiteNumber(entry, entryPath, Number.EPSILON);
  return Object.freeze({
    trees: parse(source.trees, `${path}.trees`),
    grass: parse(source.grass, `${path}.grass`),
    understory: parse(source.understory, `${path}.understory`),
    stones: parse(source.stones, `${path}.stones`),
    dressing: parse(source.dressing, `${path}.dressing`),
  });
}

function presetCategoryValues(value: unknown, path: string, integerOnly: boolean): VegetationPresetCategoryValues {
  const source = record(value, path);
  rejectUnknown(source, VEGETATION_QUALITY_PRESETS, path);
  return Object.freeze({
    ultra: categoryValues(source.ultra, `${path}.ultra`, integerOnly),
    balanced: categoryValues(source.balanced, `${path}.balanced`, integerOnly),
    perf: categoryValues(source.perf, `${path}.perf`, integerOnly),
    potato: categoryValues(source.potato, `${path}.potato`, integerOnly),
  });
}

function presetValues(value: unknown, path: string): Readonly<Record<VegetationQualityPreset, number>> {
  const source = record(value, path);
  rejectUnknown(source, VEGETATION_QUALITY_PRESETS, path);
  return Object.freeze({
    ultra: integer(source.ultra, `${path}.ultra`, 1),
    balanced: integer(source.balanced, `${path}.balanced`, 1),
    perf: integer(source.perf, `${path}.perf`, 1),
    potato: integer(source.potato, `${path}.potato`, 1),
  });
}

export function parseVegetationGpuAuthorityConfig(source: string): VegetationGpuAuthorityConfig {
  const document = record(load(source), "config");
  rejectUnknown(document, ROOT_KEYS, "config");
  const authority = record(document.vegetation_gpu_authority, "vegetation_gpu_authority");
  rejectUnknown(authority, AUTHORITY_KEYS, "vegetation_gpu_authority");

  const rejection = record(authority.rejection, "vegetation_gpu_authority.rejection");
  rejectUnknown(rejection, REJECTION_KEYS, "vegetation_gpu_authority.rejection");
  const invalidation = record(authority.invalidation, "vegetation_gpu_authority.invalidation");
  rejectUnknown(invalidation, INVALIDATION_KEYS, "vegetation_gpu_authority.invalidation");
  const debug = record(authority.debug, "vegetation_gpu_authority.debug");
  rejectUnknown(debug, DEBUG_KEYS, "vegetation_gpu_authority.debug");

  const schemaVersion = fixedNumber(
    authority.schema_version,
    VEGETATION_SCHEMA_VERSION,
    "vegetation_gpu_authority.schema_version",
  );
  const clusterSizeM = fixedNumber(
    authority.cluster_size_m,
    VEGETATION_CLUSTER_SIZE_M,
    "vegetation_gpu_authority.cluster_size_m",
  );
  const clusterProbeGrid = fixedNumber(
    authority.cluster_probe_grid,
    VEGETATION_CLUSTER_PROBE_GRID,
    "vegetation_gpu_authority.cluster_probe_grid",
  );

  const config: VegetationGpuAuthorityConfig = {
    schemaVersion,
    enabled: booleanValue(authority.enabled, "vegetation_gpu_authority.enabled"),
    clusterSizeM,
    clusterProbeGrid,
    nearForceVisibleRadiusM: finiteNumber(
      authority.near_force_visible_radius_m,
      "vegetation_gpu_authority.near_force_visible_radius_m",
      0,
    ),
    maximumClusterDistanceM: presetCategoryValues(
      authority.maximum_cluster_distance_m,
      "vegetation_gpu_authority.maximum_cluster_distance_m",
      false,
    ),
    candidateSpacingM: categoryValues(
      authority.candidate_spacing_m,
      "vegetation_gpu_authority.candidate_spacing_m",
      false,
    ),
    acceptedInstanceCapacity: presetCategoryValues(
      authority.accepted_instance_capacity,
      "vegetation_gpu_authority.accepted_instance_capacity",
      true,
    ),
    authorityBufferVramMibMax: presetValues(
      authority.authority_buffer_vram_mib_max,
      "vegetation_gpu_authority.authority_buffer_vram_mib_max",
    ),
    portableStorageBindingMibMax: integer(
      authority.portable_storage_binding_mib_max,
      "vegetation_gpu_authority.portable_storage_binding_mib_max",
      1,
      128,
    ),
    rejection: Object.freeze({
      maximumTreeSlopeDegrees: finiteNumber(rejection.maximum_tree_slope_degrees, "vegetation_gpu_authority.rejection.maximum_tree_slope_degrees", 0, 90),
      maximumGrassSlopeDegrees: finiteNumber(rejection.maximum_grass_slope_degrees, "vegetation_gpu_authority.rejection.maximum_grass_slope_degrees", 0, 90),
      maximumUnderstorySlopeDegrees: finiteNumber(rejection.maximum_understory_slope_degrees, "vegetation_gpu_authority.rejection.maximum_understory_slope_degrees", 0, 90),
      supportRayDepthM: finiteNumber(rejection.support_ray_depth_m, "vegetation_gpu_authority.rejection.support_ray_depth_m", 0),
      deepWaterM: finiteNumber(rejection.deep_water_m, "vegetation_gpu_authority.rejection.deep_water_m", 0),
    }),
    invalidation: Object.freeze({
      cameraClusterSnap: integer(invalidation.camera_cluster_snap, "vegetation_gpu_authority.invalidation.camera_cluster_snap", 1),
      terrainRevisionRequired: booleanValue(invalidation.terrain_revision_required, "vegetation_gpu_authority.invalidation.terrain_revision_required"),
      providerRevisionRequired: booleanValue(invalidation.provider_revision_required, "vegetation_gpu_authority.invalidation.provider_revision_required"),
    }),
    debug: Object.freeze({
      readbackCounts: booleanValue(debug.readback_counts, "vegetation_gpu_authority.debug.readback_counts"),
      validateAgainstCpu: booleanValue(debug.validate_against_cpu, "vegetation_gpu_authority.debug.validate_against_cpu"),
      showClusterReasons: booleanValue(debug.show_cluster_reasons, "vegetation_gpu_authority.debug.show_cluster_reasons"),
    }),
  };

  if (!config.invalidation.terrainRevisionRequired || !config.invalidation.providerRevisionRequired) {
    throw new Error("vegetation GPU authority requires terrain and provider revisions");
  }
  return Object.freeze(config);
}
