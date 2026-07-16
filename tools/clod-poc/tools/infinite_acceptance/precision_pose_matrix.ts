import type { PrecisionLandmark } from "../../src/core/hooks.js";

export type PrecisionPoseName =
  | "center"
  | "west-rim"
  | "east-rim"
  | "north-rim"
  | "south-rim"
  | "northwest-rim"
  | "northeast-rim"
  | "southwest-rim"
  | "southeast-rim";

export type PrecisionPoseVariant = "near-ground" | "high-altitude" | "water-specular";

export interface PrecisionPoseCase {
  readonly name: PrecisionPoseName;
  readonly variant: PrecisionPoseVariant;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly fov: number;
  readonly sunElevationDeg: number;
}

const RIM_M = 8_000;
const LOCATIONS: readonly [PrecisionPoseName, number, number][] = [
  ["center", 0, 0],
  ["west-rim", -RIM_M, 0],
  ["east-rim", RIM_M, 0],
  ["north-rim", 0, -RIM_M],
  ["south-rim", 0, RIM_M],
  ["northwest-rim", -RIM_M, -RIM_M],
  ["northeast-rim", RIM_M, -RIM_M],
  ["southwest-rim", -RIM_M, RIM_M],
  ["southeast-rim", RIM_M, RIM_M],
];

const VARIANTS: Readonly<Record<PrecisionPoseVariant, Pick<PrecisionPoseCase, "y" | "pitch" | "sunElevationDeg">>> = {
  "near-ground": { y: 96, pitch: -0.16, sunElevationDeg: 22 },
  "high-altitude": { y: 420, pitch: -0.48, sunElevationDeg: 18 },
  "water-specular": { y: 42, pitch: -0.04, sunElevationDeg: 4 },
};

function yawTowardCenter(x: number, z: number): number {
  if (x === 0 && z === 0) return -Math.PI * 0.75;
  const dx = -x;
  const dz = -z;
  return Math.atan2(-dx, -dz);
}

export function precisionPoseMatrix(): readonly PrecisionPoseCase[] {
  return LOCATIONS.flatMap(([name, x, z]) =>
    (Object.keys(VARIANTS) as PrecisionPoseVariant[]).map((variant) => ({
      name,
      variant,
      x,
      y: VARIANTS[variant].y,
      z,
      yaw: yawTowardCenter(x, z),
      pitch: VARIANTS[variant].pitch,
      fov: 55,
      sunElevationDeg: VARIANTS[variant].sunElevationDeg,
    })));
}

export function precisionPoseSmokeMatrix(): readonly PrecisionPoseCase[] {
  const wanted = new Set(["center:near-ground", "west-rim:near-ground", "northwest-rim:near-ground"]);
  return precisionPoseMatrix().filter((pose) => wanted.has(`${pose.name}:${pose.variant}`));
}

export function precisionPoseLandmarks(pose: PrecisionPoseCase): readonly PrecisionLandmark[] {
  const cosPitch = Math.cos(pose.pitch);
  const forward = {
    x: -Math.sin(pose.yaw) * cosPitch,
    y: Math.sin(pose.pitch),
    z: -Math.cos(pose.yaw) * cosPitch,
  };
  const right = { x: Math.cos(pose.yaw), z: -Math.sin(pose.yaw) };
  const distanceM = 160;
  const center: readonly [number, number, number] = [
    pose.x + forward.x * distanceM,
    pose.y + forward.y * distanceM,
    pose.z + forward.z * distanceM,
  ];
  return [
    { id: "landmark-primary", p: center, color: "#ff00ff", radiusM: 3 },
    {
      id: "landmark-relative",
      p: [center[0] + right.x * 12, center[1] + 6, center[2] + right.z * 12],
      color: "#00ffff",
      radiusM: 2,
    },
  ];
}
