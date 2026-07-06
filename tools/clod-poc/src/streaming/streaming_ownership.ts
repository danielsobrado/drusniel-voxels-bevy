import type { Phase0StreamingConfig } from "../phase0/phase0_config.js";

export interface StreamingOwnershipInput {
  streaming: Phase0StreamingConfig;
  targetVisibleM: number;
  targetFutureVisibleM?: number;
  farShellOuterOverrideM?: number | null;
  pageSizeM?: number;
  streamingScene: boolean;
}

export interface StreamingOwnershipRadii {
  liveRadiusM: number;
  clodRadiusM: number;
  farShellInnerM: number;
  farShellOuterM: number;
  targetVisibleM: number;
  targetFutureVisibleM: number;
  streamingScene: boolean;
}

export interface FarShellRangeLike {
  startMeters: number;
  endMeters: number;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Streaming ownership: ${name} must be a positive finite number`);
  }
  return value;
}

function finitePositiveOptional(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  return finitePositive(value, name);
}

export function pageGridAlignedRadius(radiusM: number, pageSizeM?: number): number {
  if (pageSizeM === undefined) return radiusM;
  const pageSize = finitePositive(pageSizeM, "pageSizeM");
  return Math.ceil(radiusM / pageSize) * pageSize;
}

export function resolveStreamingOwnership(input: StreamingOwnershipInput): StreamingOwnershipRadii {
  const liveRadiusM = finitePositive(input.streaming.live_radius_m, "live_radius_m");
  const baseClodRadiusM = finitePositive(input.streaming.clod_radius_m, "clod_radius_m");
  const clodRadiusM = finitePositiveOptional(input.streaming.clod_refinement_radius_m, "clod_refinement_radius_m")
    ?? baseClodRadiusM;
  const farClipmapRadiusM = finitePositiveOptional(input.streaming.far_clipmap_radius_m, "far_clipmap_radius_m")
    ?? clodRadiusM;
  const targetVisibleM = finitePositive(input.targetVisibleM, "targetVisibleM");
  const targetFutureVisibleM = finitePositive(input.targetFutureVisibleM ?? targetVisibleM, "targetFutureVisibleM");
  const farShellOuterM = finitePositive(input.farShellOuterOverrideM ?? targetFutureVisibleM, "farShellOuterM");
  const farShellInnerM = pageGridAlignedRadius(farClipmapRadiusM, input.pageSizeM);

  if (liveRadiusM >= clodRadiusM) {
    throw new Error(`Streaming ownership: live radius ${liveRadiusM} must be smaller than CLOD radius ${clodRadiusM}`);
  }
  if (clodRadiusM > baseClodRadiusM) {
    throw new Error(`Streaming ownership: CLOD refinement radius ${clodRadiusM} must be <= configured CLOD safety radius ${baseClodRadiusM}`);
  }
  if (farShellInnerM < clodRadiusM) {
    throw new Error(`Streaming ownership: far shell inner radius ${farShellInnerM} must be >= CLOD radius ${clodRadiusM}`);
  }
  if (farShellInnerM >= farShellOuterM) {
    throw new Error(`Streaming ownership: far shell inner radius ${farShellInnerM} must be smaller than far shell outer radius ${farShellOuterM}`);
  }

  return {
    liveRadiusM,
    clodRadiusM,
    farShellInnerM,
    farShellOuterM,
    targetVisibleM,
    targetFutureVisibleM,
    streamingScene: input.streamingScene,
  };
}

export function farShellInnerRadiusForOwnership(ownership: StreamingOwnershipRadii): number | undefined {
  return ownership.streamingScene ? ownership.farShellInnerM : undefined;
}

export function farShellOuterRadiusForOwnership(ownership: StreamingOwnershipRadii): number | undefined {
  return ownership.streamingScene ? ownership.farShellOuterM : undefined;
}

export function applyOwnershipToFarShellRange(
  farShell: FarShellRangeLike,
  ownership: StreamingOwnershipRadii,
): FarShellRangeLike {
  if (!ownership.streamingScene) return farShell;
  farShell.startMeters = ownership.farShellInnerM;
  farShell.endMeters = Math.max(farShell.endMeters, ownership.farShellOuterM);
  return farShell;
}
