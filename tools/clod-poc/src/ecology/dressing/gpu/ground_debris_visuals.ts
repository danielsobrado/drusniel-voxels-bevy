import type { DressingClassId } from "../class_registry.js";

export type GroundDebrisGeometryKind =
  | "leaf_cluster"
  | "needle_cluster"
  | "twig_cluster"
  | "bark_cluster"
  | "talus"
  | "river_cobble"
  | "wet_stone";

export interface GroundDebrisVisualProfile {
  readonly geometry: GroundDebrisGeometryKind;
  readonly baseColor: number;
  readonly wetColor: number;
  readonly dryRoughness: number;
  readonly wetRoughness: number;
  readonly fadeStartM: number;
  readonly fadeEndM: number;
}

const ACTIVE_RADIUS_M = 110;

const GROUND_DEBRIS_VISUALS = Object.freeze({
  leaf_litter: profile("leaf_cluster", 0x5f432b, 0x38291f, 0.94, 0.82, 70, 102),
  needle_litter: profile("needle_cluster", 0x51452c, 0x312d20, 0.96, 0.84, 70, 102),
  twig_cluster: profile("twig_cluster", 0x6b4a31, 0x3f3025, 0.91, 0.77, 74, 104),
  bark_chip_cluster: profile("bark_cluster", 0x68422c, 0x3d2c21, 0.92, 0.78, 72, 103),
  small_talus: profile("talus", 0x77776e, 0x4b514f, 0.88, 0.48, 84, ACTIVE_RADIUS_M),
  river_cobbles: profile("river_cobble", 0x787f7d, 0x3f5456, 0.82, 0.34, 86, ACTIVE_RADIUS_M),
  wet_stone_cluster: profile("wet_stone", 0x566061, 0x283b3f, 0.76, 0.28, 86, ACTIVE_RADIUS_M),
} satisfies Partial<Record<DressingClassId, GroundDebrisVisualProfile>>);

export const GROUND_DEBRIS_CLASSES = Object.freeze(
  Object.keys(GROUND_DEBRIS_VISUALS) as DressingClassId[],
);

export function groundDebrisVisualProfile(
  classId: DressingClassId,
): GroundDebrisVisualProfile | null {
  return GROUND_DEBRIS_VISUALS[classId as keyof typeof GROUND_DEBRIS_VISUALS] ?? null;
}

export function isGroundDebrisClass(classId: DressingClassId): boolean {
  return groundDebrisVisualProfile(classId) !== null;
}

export function groundDebrisVisibility(
  distanceM: number,
  profileValue: GroundDebrisVisualProfile,
): number {
  const distance = Number.isFinite(distanceM) ? distanceM : profileValue.fadeEndM;
  const span = Math.max(0.001, profileValue.fadeEndM - profileValue.fadeStartM);
  return 1 - clamp01((distance - profileValue.fadeStartM) / span);
}

export function groundDebrisWetMix(
  wetness: number,
  profileValue: GroundDebrisVisualProfile,
): number {
  return clamp01(Number.isFinite(wetness) ? wetness : 0);
}

function profile(
  geometry: GroundDebrisGeometryKind,
  baseColor: number,
  wetColor: number,
  dryRoughness: number,
  wetRoughness: number,
  fadeStartM: number,
  fadeEndM: number,
): GroundDebrisVisualProfile {
  if (fadeEndM > ACTIVE_RADIUS_M || fadeEndM <= fadeStartM) {
    throw new Error("ground debris fade must finish inside the GPU dressing radius");
  }
  return Object.freeze({
    geometry,
    baseColor,
    wetColor,
    dryRoughness: clamp01(dryRoughness),
    wetRoughness: clamp01(wetRoughness),
    fadeStartM,
    fadeEndM,
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
