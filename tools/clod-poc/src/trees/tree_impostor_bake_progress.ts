import type { TreeSpeciesId } from "./tree_config.js";

export type TreeImpostorBakeStage =
  | "allocating"
  | "capturing"
  | "readback"
  | "row-flip"
  | "dilating"
  | "uploading"
  | "committing"
  | "complete"
  | "cancelled"
  | "failed";

export type TreeImpostorBakeChannel = "albedo" | "normal-depth" | null;

export interface TreeImpostorBakeProgress {
  stage: TreeImpostorBakeStage;
  species: TreeSpeciesId | null;
  speciesIndex: number;
  speciesCount: number;
  variant: number | null;
  variantCount: number;
  channel: TreeImpostorBakeChannel;
  tileIndex: number;
  tileCount: number;
  completedWork: number;
  totalWork: number;
  percent: number;
  frameMs: number;
}

declare global {
  interface Window {
    __drusnielTreeImpostorBake?: TreeImpostorBakeProgress;
  }
}

export function publishTreeImpostorBakeProgress(
  progress: TreeImpostorBakeProgress,
  listener?: (progress: TreeImpostorBakeProgress) => void,
): void {
  const snapshot = { ...progress };
  listener?.(snapshot);
  if (typeof window !== "undefined") window.__drusnielTreeImpostorBake = snapshot;
}
