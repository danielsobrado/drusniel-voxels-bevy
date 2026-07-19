import type { CameraPoseArgs } from "./water-harness.js";
import type { WaterShotDebugMode, WaterShotScene } from "./water-shot-scenes.js";

export type GlacialWaterCaptureProfile = "baseline" | "glacial" | "glacial-low-sun";

export interface GlacialWaterCaptureProfileConfig {
  readonly name: GlacialWaterCaptureProfile;
  readonly query: Readonly<Record<string, string>>;
  readonly scenes: readonly WaterShotScene[];
}

const COMMON_QUERY = Object.freeze({
  waterQuality: "high",
  waterHq: "1",
  waterRefraction: "1",
  waterCaustics: "1",
  biomeSeasonT: "0",
});

const NORMAL_SCENES = Object.freeze([
  "shallow-glacial-river",
  "rapid-bed-step",
  "deep-glacial-lake",
] as const satisfies readonly WaterShotScene[]);

export const GLACIAL_WATER_CAPTURE_PROFILES: Readonly<Record<GlacialWaterCaptureProfile, GlacialWaterCaptureProfileConfig>> = Object.freeze({
  baseline: Object.freeze({
    name: "baseline",
    scenes: NORMAL_SCENES,
    query: Object.freeze({
      ...COMMON_QUERY,
      waterGlacialMurkiness: "0",
      waterRockFlour: "0",
    }),
  }),
  glacial: Object.freeze({
    name: "glacial",
    scenes: NORMAL_SCENES,
    query: Object.freeze({
      ...COMMON_QUERY,
      waterGlacialMurkiness: "1",
      waterRockFlour: "1",
    }),
  }),
  "glacial-low-sun": Object.freeze({
    name: "glacial-low-sun",
    scenes: Object.freeze(["low-sun-glitter"] as const),
    query: Object.freeze({
      ...COMMON_QUERY,
      waterGlacialMurkiness: "1",
      waterRockFlour: "1",
      sunElevationDeg: "7",
      sunAzimuthDeg: "235",
    }),
  }),
});

export const GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES: readonly WaterShotDebugMode[] = Object.freeze([
  "final",
  "depth",
  "foam",
  "refraction",
  "reflection",
  "ssrHit",
  "suspendedScatter",
]);

export function glacialWaterProfileUrl(baseUrl: string, profile: GlacialWaterCaptureProfileConfig): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(profile.query)) url.searchParams.set(key, value);
  return url.toString();
}

export function captureFileName(mode: WaterShotDebugMode): string {
  if (mode === "clipmapLevel") return "clipmap-level.png";
  if (mode === "ssrHit") return "ssr-hit.png";
  if (mode === "suspendedScatter") return "suspended-scatter.png";
  return `${mode}.png`;
}

export function cameraPoseMatches(left: CameraPoseArgs, right: CameraPoseArgs): boolean {
  return scalarMatches(left.x, right.x)
    && scalarMatches(left.z, right.z)
    && optionalScalarMatches(left.y, right.y)
    && optionalScalarMatches(left.yaw, right.yaw)
    && optionalScalarMatches(left.distance, right.distance)
    && optionalScalarMatches(left.pitch, right.pitch);
}

function optionalScalarMatches(left: number | undefined, right: number | undefined): boolean {
  return left === undefined || right === undefined ? left === right : scalarMatches(left, right);
}

function scalarMatches(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
}
