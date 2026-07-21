import { readFileSync } from "node:fs";
import { load } from "js-yaml";

export type LookdevToneMap = "agx" | "aces";
export type LookdevDiagnostic = "final" | "ownership";

export interface LookdevPose {
  id: string;
  position: [number, number, number];
  yaw: number;
  pitch: number;
  fov: number;
  diagnostic: LookdevDiagnostic;
}

export interface LookdevSuite {
  toneMaps: LookdevToneMap[];
  poses: string[];
}

export interface LookdevConfig {
  schemaVersion: 1;
  scene: string;
  seed: number;
  world: number;
  viewport: [number, number];
  readyTimeoutMs: number;
  stablePolls: number;
  profile: Record<string, string>;
  suites: Record<"smoke" | "full", LookdevSuite>;
  poses: LookdevPose[];
}

export function loadLookdevConfig(path: string): LookdevConfig {
  const file = object(load(readFileSync(path, "utf8")), path, ["lookdev"]);
  const root = object(file.lookdev, `${path}.lookdev`, [
    "schema_version",
    "scene",
    "seed",
    "world",
    "viewport",
    "ready_timeout_ms",
    "stable_polls",
    "profile",
    "suites",
    "poses",
  ]);
  if (root.schema_version !== 1) throw new Error(`${path}.lookdev.schema_version must equal 1`);
  const suitesRaw = object(root.suites, `${path}.lookdev.suites`, ["smoke", "full"]);
  const poses = array(root.poses, `${path}.lookdev.poses`).map((entry, index) => parsePose(entry, `${path}.lookdev.poses[${index}]`));
  const poseIds = new Set<string>();
  for (const pose of poses) {
    if (poseIds.has(pose.id)) throw new Error(`${path} has duplicate lookdev pose ${pose.id}`);
    poseIds.add(pose.id);
  }
  const suites = {
    smoke: parseSuite(suitesRaw.smoke, `${path}.lookdev.suites.smoke`),
    full: parseSuite(suitesRaw.full, `${path}.lookdev.suites.full`),
  };
  for (const [suiteId, suite] of Object.entries(suites)) {
    for (const pose of suite.poses) if (!poseIds.has(pose)) throw new Error(`${path} suite ${suiteId} references unknown pose ${pose}`);
  }
  const profileRaw = object(root.profile, `${path}.lookdev.profile`);
  const profile: Record<string, string> = {};
  for (const [key, value] of Object.entries(profileRaw)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/u.test(key)) throw new Error(`${path}.lookdev.profile.${key} is not a safe query key`);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`${path}.lookdev.profile.${key} must be scalar`);
    }
    profile[key] = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  }
  return {
    schemaVersion: 1,
    scene: text(root.scene, `${path}.lookdev.scene`),
    seed: integer(root.seed, `${path}.lookdev.seed`),
    world: positiveInteger(root.world, `${path}.lookdev.world`),
    viewport: tuple(root.viewport, 2, `${path}.lookdev.viewport`) as [number, number],
    readyTimeoutMs: positiveInteger(root.ready_timeout_ms, `${path}.lookdev.ready_timeout_ms`),
    stablePolls: positiveInteger(root.stable_polls, `${path}.lookdev.stable_polls`),
    profile,
    suites,
    poses,
  };
}

function parseSuite(raw: unknown, path: string): LookdevSuite {
  const value = object(raw, path, ["tone_maps", "poses"]);
  const toneMaps = strings(value.tone_maps, `${path}.tone_maps`).map((toneMap) => {
    if (toneMap !== "agx" && toneMap !== "aces") throw new Error(`${path} has unsupported tone map ${toneMap}`);
    return toneMap;
  });
  if (toneMaps.length === 0) throw new Error(`${path}.tone_maps must not be empty`);
  const poses = strings(value.poses, `${path}.poses`);
  if (poses.length === 0) throw new Error(`${path}.poses must not be empty`);
  return { toneMaps, poses };
}

function parsePose(raw: unknown, path: string): LookdevPose {
  const value = object(raw, path, ["id", "position", "yaw", "pitch", "fov", "diagnostic"]);
  const diagnostic = text(value.diagnostic, `${path}.diagnostic`);
  if (diagnostic !== "final" && diagnostic !== "ownership") throw new Error(`${path}.diagnostic is invalid`);
  return {
    id: identifier(value.id, `${path}.id`),
    position: tuple(value.position, 3, `${path}.position`) as [number, number, number],
    yaw: finite(value.yaw, `${path}.yaw`),
    pitch: finite(value.pitch, `${path}.pitch`),
    fov: finite(value.fov, `${path}.fov`),
    diagnostic,
  };
}

function object(raw: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path} must be an object`);
  const value = raw as Record<string, unknown>;
  if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unknown`);
  return value;
}
function array(raw: unknown, path: string): unknown[] { if (!Array.isArray(raw)) throw new Error(`${path} must be an array`); return raw; }
function text(raw: unknown, path: string): string { if (typeof raw !== "string" || raw.trim().length === 0) throw new Error(`${path} must be text`); return raw; }
function identifier(raw: unknown, path: string): string { const value = text(raw, path); if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) throw new Error(`${path} is invalid`); return value; }
function strings(raw: unknown, path: string): string[] { return array(raw, path).map((entry, index) => text(entry, `${path}[${index}]`)); }
function finite(raw: unknown, path: string): number { if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${path} must be finite`); return raw; }
function integer(raw: unknown, path: string): number { const value = finite(raw, path); if (!Number.isSafeInteger(value)) throw new Error(`${path} must be an integer`); return value; }
function positiveInteger(raw: unknown, path: string): number { const value = integer(raw, path); if (value <= 0) throw new Error(`${path} must be positive`); return value; }
function tuple(raw: unknown, length: number, path: string): number[] {
  const values = array(raw, path).map((entry, index) => finite(entry, `${path}[${index}]`));
  if (values.length !== length) throw new Error(`${path} must have ${length} values`);
  return values;
}
