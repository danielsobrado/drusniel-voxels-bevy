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

export function assertGameplayOwnershipDistance(
  distanceM: number,
  ownership: StreamingOwnershipRadii,
): void {
  const layer = classifyOwnershipDistance(distanceM, ownership);
  if (layer === "far-shell") {
    throw new Error(`Gameplay ownership cannot target far shell at ${distanceM.toFixed(2)}m`);
  }
}

export function ownsGameplayAtDistance(
  distanceM: number,
  ownership: StreamingOwnershipRadii,
): boolean {
  return classifyOwnershipDistance(distanceM, ownership) !== "far-shell";
}
