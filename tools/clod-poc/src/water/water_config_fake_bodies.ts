import type { LakeBodyConfig, RiverBodyConfig } from "./waterConfig.js";
import { readNumber, readNumberTuple } from "./water_config_readers.js";

export function readLakeBody(value: unknown, fallback: LakeBodyConfig): LakeBodyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const centerNorm = record.center_norm ?? record.centerNorm;
  return {
    center: readNumberTuple(record.center, fallback.center),
    centerNorm: centerNorm ? readNumberTuple(centerNorm, fallback.centerNorm ?? [0.5, 0.5]) : fallback.centerNorm,
    radius: readNumberTuple(record.radius, fallback.radius),
    levelOffset: readNumber(record.level_offset ?? record.levelOffset, fallback.levelOffset),
  };
}

export function readRiverBody(value: unknown, fallback: RiverBodyConfig): RiverBodyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
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
