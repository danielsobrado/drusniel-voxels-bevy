import type { LakeBodyConfig, RiverBodyConfig, WaterConfig } from "./waterConfig.js";
import { readBoolean, readNumber, readNumberTuple, recordFrom } from "./water_config_readers.js";

export function readFakeBodiesConfig(value: unknown, defaults: WaterConfig["fakeBodies"]): WaterConfig["fakeBodies"] {
  const fakeBodies = recordFrom(value);
  const defaultLakes = defaults.lakes;
  const defaultRivers = defaults.rivers;
  const lakes = Array.isArray(fakeBodies.lakes)
    ? fakeBodies.lakes.map((lake, index) => readLakeBody(lake, defaultLakes[index] ?? defaultLakes[0]))
    : defaultLakes.map((lake) => readLakeBody(lake, lake));
  const rivers = Array.isArray(fakeBodies.rivers)
    ? fakeBodies.rivers.map((river, index) => readRiverBody(river, defaultRivers[index] ?? defaultRivers[0]))
    : defaultRivers.map((river) => readRiverBody(river, river));

  return {
    carveTerrain: readBoolean(fakeBodies.carve_terrain ?? fakeBodies.carveTerrain, defaults.carveTerrain),
    lakes,
    rivers,
  };
}

export function readLakeBody(value: unknown, fallback: LakeBodyConfig): LakeBodyConfig {
  const record = recordFrom(value);
  const centerNorm = record.center_norm ?? record.centerNorm;
  return {
    center: readNumberTuple(record.center, fallback.center),
    centerNorm: centerNorm ? readNumberTuple(centerNorm, fallback.centerNorm ?? [0.5, 0.5]) : fallback.centerNorm,
    radius: readNumberTuple(record.radius, fallback.radius),
    levelOffset: readNumber(record.level_offset ?? record.levelOffset, fallback.levelOffset),
  };
}

export function readRiverBody(value: unknown, fallback: RiverBodyConfig): RiverBodyConfig {
  const record = recordFrom(value);
  const pointsExplicit = Array.isArray(record.points);
  const points = pointsExplicit
    ? (record.points as unknown[]).map((point: unknown, index: number) => readNumberTuple(point, fallback.points[index] ?? [0, 0]))
    : fallback.points.map((point) => [...point] as [number, number]);
  const rawPointsNorm = record.points_norm ?? record.pointsNorm;
  const pointsNormExplicit = Array.isArray(rawPointsNorm);
  const pointsNorm = pointsNormExplicit
    ? rawPointsNorm.map((point, index) => readNumberTuple(point, fallback.pointsNorm?.[index] ?? [0, 0]))
    : pointsExplicit ? undefined : fallback.pointsNorm?.map((point) => [...point] as [number, number]);
  return {
    points,
    pointsNorm,
    width: readNumber(record.width, fallback.width),
    levelOffset: readNumber(record.level_offset ?? record.levelOffset, fallback.levelOffset),
    downstreamDrop: readNumber(record.downstream_drop ?? record.downstreamDrop, fallback.downstreamDrop),
  };
}
