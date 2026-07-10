import { load } from "js-yaml";

export interface PlayerEditAuthorityConfig {
  terrainEditRadiusM: number;
  buildCommitRadiusM: number;
  buildPreviewRadiusM: number;
  allowFarPreview: boolean;
  allowFarCommit: boolean;
}

export type PlayerEditAuthorityAction = "terrain_commit" | "build_commit" | "build_preview";

export interface PlayerEditAuthorityDecision {
  action: PlayerEditAuthorityAction;
  allowed: boolean;
  distanceM: number;
  limitM: number;
  reason: string | null;
}

export interface PlayerEditAuthorityPoint {
  x: number;
  z: number;
}

type PlayerEditAuthorityTuple = readonly [number, number, number];

export const DEFAULT_PLAYER_EDIT_AUTHORITY: PlayerEditAuthorityConfig = {
  terrainEditRadiusM: 8,
  buildCommitRadiusM: 80,
  buildPreviewRadiusM: 160,
  allowFarPreview: true,
  allowFarCommit: false,
};

function finitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return fallback;
}

function overrideNumber(params: URLSearchParams | undefined, key: string, fallback: number): number {
  if (!params?.has(key)) return fallback;
  return finitePositive(params.get(key), fallback);
}

function overrideBool(params: URLSearchParams | undefined, key: string, fallback: boolean): boolean {
  if (!params?.has(key)) return fallback;
  return boolValue(params.get(key), fallback);
}

function parsedRoot(yamlText: string): Record<string, unknown> {
  try {
    const parsed = load(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const root = parsed as Record<string, unknown>;
    const nested = root["player_editing"];
    return nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : root;
  } catch (error) {
    console.warn("[player-edit] failed to parse player editing config; using defaults", error);
    return {};
  }
}

export function resolvePlayerEditAuthorityConfig(
  yamlText: string,
  params?: URLSearchParams,
): PlayerEditAuthorityConfig {
  const root = parsedRoot(yamlText);
  const fromYaml: PlayerEditAuthorityConfig = {
    terrainEditRadiusM: finitePositive(root["terrain_edit_radius_m"], DEFAULT_PLAYER_EDIT_AUTHORITY.terrainEditRadiusM),
    buildCommitRadiusM: finitePositive(root["build_commit_radius_m"], DEFAULT_PLAYER_EDIT_AUTHORITY.buildCommitRadiusM),
    buildPreviewRadiusM: finitePositive(root["build_preview_radius_m"], DEFAULT_PLAYER_EDIT_AUTHORITY.buildPreviewRadiusM),
    allowFarPreview: boolValue(root["allow_far_preview"], DEFAULT_PLAYER_EDIT_AUTHORITY.allowFarPreview),
    allowFarCommit: boolValue(root["allow_far_commit"], DEFAULT_PLAYER_EDIT_AUTHORITY.allowFarCommit),
  };
  return {
    terrainEditRadiusM: overrideNumber(params, "playerEditTerrainRadius", fromYaml.terrainEditRadiusM),
    buildCommitRadiusM: overrideNumber(params, "playerBuildCommitRadius", fromYaml.buildCommitRadiusM),
    buildPreviewRadiusM: overrideNumber(params, "playerBuildPreviewRadius", fromYaml.buildPreviewRadiusM),
    allowFarPreview: overrideBool(params, "playerAllowFarPreview", fromYaml.allowFarPreview),
    allowFarCommit: overrideBool(params, "playerAllowFarCommit", fromYaml.allowFarCommit),
  };
}

function isPointTuple(value: PlayerEditAuthorityPoint | PlayerEditAuthorityTuple): value is PlayerEditAuthorityTuple {
  return Array.isArray(value);
}

function pointFromTuple(value: PlayerEditAuthorityTuple): PlayerEditAuthorityPoint {
  return { x: value[0], z: value[2] };
}

function distanceXZ(origin: PlayerEditAuthorityPoint, target: PlayerEditAuthorityPoint): number {
  return Math.hypot(origin.x - target.x, origin.z - target.z);
}

function decide(
  action: PlayerEditAuthorityAction,
  origin: PlayerEditAuthorityPoint | null | undefined,
  target: PlayerEditAuthorityPoint,
  limitM: number,
  allowFar: boolean,
): PlayerEditAuthorityDecision {
  if (!origin || allowFar) {
    return { action, allowed: true, distanceM: 0, limitM, reason: null };
  }
  const distanceM = distanceXZ(origin, target);
  const allowed = distanceM <= limitM;
  return {
    action,
    allowed,
    distanceM,
    limitM,
    reason: allowed ? null : `target ${distanceM.toFixed(1)}m exceeds ${limitM.toFixed(1)}m ${action.replace("_", " ")} radius`,
  };
}

export function canCommitTerrainEdit(
  config: PlayerEditAuthorityConfig,
  origin: PlayerEditAuthorityPoint | null | undefined,
  target: PlayerEditAuthorityPoint,
): PlayerEditAuthorityDecision {
  return decide("terrain_commit", origin, target, config.terrainEditRadiusM, config.allowFarCommit);
}

export function canCommitBuild(
  config: PlayerEditAuthorityConfig,
  origin: PlayerEditAuthorityPoint | null | undefined,
  target: PlayerEditAuthorityPoint | PlayerEditAuthorityTuple,
): PlayerEditAuthorityDecision {
  const p = isPointTuple(target) ? pointFromTuple(target) : target;
  return decide("build_commit", origin, p, config.buildCommitRadiusM, config.allowFarCommit);
}

export function canPreviewBuild(
  config: PlayerEditAuthorityConfig,
  origin: PlayerEditAuthorityPoint | null | undefined,
  target: PlayerEditAuthorityPoint | PlayerEditAuthorityTuple,
): PlayerEditAuthorityDecision {
  const p = isPointTuple(target) ? pointFromTuple(target) : target;
  return decide("build_preview", origin, p, config.buildPreviewRadiusM, config.allowFarPreview);
}

export function publishPlayerEditAuthorityDecision(
  counters: Record<string, number> | null | undefined,
  decision: PlayerEditAuthorityDecision,
): void {
  if (!counters) return;
  const prefix = decision.action === "terrain_commit"
    ? "player_edit_commit"
    : decision.action === "build_commit"
      ? "player_build_commit"
      : "player_build_preview";
  counters[`${prefix}_allowed`] = decision.allowed ? 1 : 0;
  counters[`${prefix}_rejected_distance`] = decision.allowed ? 0 : 1;
  counters[`${prefix}_distance_m`] = decision.distanceM;
  counters[`${prefix}_limit_m`] = decision.limitM;
}
