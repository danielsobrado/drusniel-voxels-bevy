import type { LoadedSavedWorld } from "./save_service.js";
import { loadSavedWorldFromQuery } from "./save_service.js";

const NOOP_VOXEL_REPLACEMENT = (): void => {};

/** Reads and validates a saved world without mutating the active voxel authority. */
export async function readSavedWorldForStartup(
  searchParams: URLSearchParams,
): Promise<LoadedSavedWorld | null> {
  return loadSavedWorldFromQuery(searchParams, {
    replaceVoxelSnapshot: NOOP_VOXEL_REPLACEMENT,
  });
}
