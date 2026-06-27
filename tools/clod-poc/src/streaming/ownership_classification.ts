import type { StreamingOwnershipRadii } from "./streaming_ownership.js";

export type StreamingOwnershipLayer = "live" | "clod" | "far-shell";

export function classifyOwnershipDistance(
  distanceM: number,
  ownership: StreamingOwnershipRadii,
): StreamingOwnershipLayer {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error("Ownership distance must be finite and non-negative");
  if (distanceM <= ownership.liveRadiusM) return "live";
  if (distanceM <= ownership.clodRadiusM) return "clod";
  return "far-shell";
}

export function assertFarShellOutsidePlayable(
  ownership: StreamingOwnershipRadii,
): void {
  if (ownership.farShellInnerM < ownership.clodRadiusM) {
    throw new Error("Far shell starts inside CLOD ownership");
  }
  if (ownership.clodRadiusM <= ownership.liveRadiusM) {
    throw new Error("CLOD ownership must start outside live ownership");
  }
}
