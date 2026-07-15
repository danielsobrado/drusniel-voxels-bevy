import { load } from "js-yaml";
import { sha256Hex } from "../../cache/checksum.js";
import { EROSION_SCHEMA_VERSION, HEIGHT_UNITS_PER_METER } from "./constants.js";
import type { TerrainErosionConfig } from "./types.js";

const encoder = new TextEncoder();

export const DEFAULT_TERRAIN_EROSION_CONFIG: TerrainErosionConfig = Object.freeze({
  erosion: Object.freeze({
    schemaVersion: EROSION_SCHEMA_VERSION,
    enabled: true,
    cellSizeM: 16,
    borderCells: 2,
    hydraulicIterations: 192,
    thermalIterations: 48,
    checkpointEveryIterations: 8,
    rain: Object.freeze({ amountPerIterationM: 0.0025, spatialVariation: 0.20 }),
    water: Object.freeze({
      gravityMS2: 9.81,
      timeStepS: 0.04,
      evaporationFraction: 0.012,
      maxVelocityCellsPerStep: 2.0,
    }),
    sediment: Object.freeze({
      capacityFactor: 0.55,
      erosionRate: 0.24,
      depositionRate: 0.45,
      minimumSlope: 0.008,
      maximumErosionPerIterationM: 0.04,
      maximumDepositionPerIterationM: 0.06,
    }),
    thermal: Object.freeze({ rate: 0.12, softTalusDegrees: 30, hardTalusDegrees: 72 }),
    persistence: Object.freeze({
      compression: "zstd" as const,
      quantizedHeightStepM: 1 / HEIGHT_UNITS_PER_METER,
      keepWaterField: false,
      keepSedimentField: true,
      keepDepositionField: true,
    }),
  }),
});

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be a mapping`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function numberValue(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  if (value < min || value > max) throw new Error(`${path} must be in [${min}, ${max}]`);
  if (integer && !Number.isSafeInteger(value)) throw new Error(`${path} must be an integer`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

export function parseTerrainErosionConfig(source: string): TerrainErosionConfig {
  const root = record(load(source), "config");
  rejectUnknown(root, ["erosion"], "config");
  const erosion = record(root.erosion, "erosion");
  rejectUnknown(erosion, [
    "schema_version", "enabled", "cell_size_m", "border_cells", "hydraulic_iterations",
    "thermal_iterations", "checkpoint_every_iterations", "rain", "water", "sediment", "thermal", "persistence",
  ], "erosion");

  const rain = record(erosion.rain, "erosion.rain");
  rejectUnknown(rain, ["amount_per_iteration_m", "spatial_variation"], "erosion.rain");
  const water = record(erosion.water, "erosion.water");
  rejectUnknown(water, ["gravity_m_s2", "time_step_s", "evaporation_fraction", "max_velocity_cells_per_step"], "erosion.water");
  const sediment = record(erosion.sediment, "erosion.sediment");
  rejectUnknown(sediment, [
    "capacity_factor", "erosion_rate", "deposition_rate", "minimum_slope",
    "maximum_erosion_per_iteration_m", "maximum_deposition_per_iteration_m",
  ], "erosion.sediment");
  const thermal = record(erosion.thermal, "erosion.thermal");
  rejectUnknown(thermal, ["rate", "soft_talus_degrees", "hard_talus_degrees"], "erosion.thermal");
  const persistence = record(erosion.persistence, "erosion.persistence");
  rejectUnknown(persistence, [
    "compression", "quantized_height_step_m", "keep_water_field", "keep_sediment_field", "keep_deposition_field",
  ], "erosion.persistence");

  const schemaVersion = numberValue(
    erosion.schema_version,
    "erosion.schema_version",
    EROSION_SCHEMA_VERSION,
    EROSION_SCHEMA_VERSION,
    true,
  );
  const compression = persistence.compression;
  if (compression !== "zstd") throw new Error("erosion.persistence.compression must be zstd");
  const quantizedHeightStepM = numberValue(
    persistence.quantized_height_step_m,
    "erosion.persistence.quantized_height_step_m",
    1 / HEIGHT_UNITS_PER_METER,
    1 / HEIGHT_UNITS_PER_METER,
  );
  const softTalusDegrees = numberValue(thermal.soft_talus_degrees, "erosion.thermal.soft_talus_degrees", 1, 89);
  const hardTalusDegrees = numberValue(thermal.hard_talus_degrees, "erosion.thermal.hard_talus_degrees", softTalusDegrees, 89);

  return Object.freeze({
    erosion: Object.freeze({
      schemaVersion: schemaVersion as typeof EROSION_SCHEMA_VERSION,
      enabled: booleanValue(erosion.enabled, "erosion.enabled"),
      cellSizeM: numberValue(erosion.cell_size_m, "erosion.cell_size_m", 1, 1024),
      borderCells: numberValue(erosion.border_cells, "erosion.border_cells", 1, 16, true),
      hydraulicIterations: numberValue(erosion.hydraulic_iterations, "erosion.hydraulic_iterations", 0, 4096, true),
      thermalIterations: numberValue(erosion.thermal_iterations, "erosion.thermal_iterations", 0, 4096, true),
      checkpointEveryIterations: numberValue(
        erosion.checkpoint_every_iterations,
        "erosion.checkpoint_every_iterations",
        1,
        1024,
        true,
      ),
      rain: Object.freeze({
        amountPerIterationM: numberValue(rain.amount_per_iteration_m, "erosion.rain.amount_per_iteration_m", 0, 1),
        spatialVariation: numberValue(rain.spatial_variation, "erosion.rain.spatial_variation", 0, 1),
      }),
      water: Object.freeze({
        gravityMS2: numberValue(water.gravity_m_s2, "erosion.water.gravity_m_s2", 0.01, 100),
        timeStepS: numberValue(water.time_step_s, "erosion.water.time_step_s", 0.0001, 1),
        evaporationFraction: numberValue(water.evaporation_fraction, "erosion.water.evaporation_fraction", 0, 1),
        maxVelocityCellsPerStep: numberValue(
          water.max_velocity_cells_per_step,
          "erosion.water.max_velocity_cells_per_step",
          0.01,
          16,
        ),
      }),
      sediment: Object.freeze({
        capacityFactor: numberValue(sediment.capacity_factor, "erosion.sediment.capacity_factor", 0, 16),
        erosionRate: numberValue(sediment.erosion_rate, "erosion.sediment.erosion_rate", 0, 1),
        depositionRate: numberValue(sediment.deposition_rate, "erosion.sediment.deposition_rate", 0, 1),
        minimumSlope: numberValue(sediment.minimum_slope, "erosion.sediment.minimum_slope", 0, 1),
        maximumErosionPerIterationM: numberValue(
          sediment.maximum_erosion_per_iteration_m,
          "erosion.sediment.maximum_erosion_per_iteration_m",
          0,
          10,
        ),
        maximumDepositionPerIterationM: numberValue(
          sediment.maximum_deposition_per_iteration_m,
          "erosion.sediment.maximum_deposition_per_iteration_m",
          0,
          10,
        ),
      }),
      thermal: Object.freeze({
        rate: numberValue(thermal.rate, "erosion.thermal.rate", 0, 1),
        softTalusDegrees,
        hardTalusDegrees,
      }),
      persistence: Object.freeze({
        compression,
        quantizedHeightStepM,
        keepWaterField: booleanValue(persistence.keep_water_field, "erosion.persistence.keep_water_field"),
        keepSedimentField: booleanValue(persistence.keep_sediment_field, "erosion.persistence.keep_sediment_field"),
        keepDepositionField: booleanValue(persistence.keep_deposition_field, "erosion.persistence.keep_deposition_field"),
      }),
    }),
  });
}

export async function computeTerrainErosionConfigHash(config: TerrainErosionConfig): Promise<string> {
  return sha256Hex(encoder.encode(JSON.stringify(config)).buffer);
}

export function terrainErosionEnabled(config: TerrainErosionConfig, searchParams?: URLSearchParams): boolean {
  const override = searchParams?.get("terrainErosion") ?? searchParams?.get("terrain_erosion");
  if (override === "0" || override === "false") return false;
  if (override === "1" || override === "true") return true;
  return config.erosion.enabled;
}

export function withTerrainErosionEnabled(config: TerrainErosionConfig, enabled: boolean): TerrainErosionConfig {
  if (config.erosion.enabled === enabled) return config;
  return Object.freeze({
    erosion: Object.freeze({ ...config.erosion, enabled }),
  });
}

export function resolveRuntimeTerrainErosionConfig(
  config: TerrainErosionConfig,
  searchParams?: URLSearchParams,
): TerrainErosionConfig {
  return withTerrainErosionEnabled(config, terrainErosionEnabled(config, searchParams));
}
