export interface TerrainEditUnderstoryTarget {
  rebuildNodePatches(ids: string[]): void;
  markPatchesDirty?(): void;
  getStats?(): { gpuStatus: string };
}

export interface TerrainEditUnderstoryAdapter {
  rebuildNodePatches(ids: string[]): void;
}

function gpuRingIsLive(target: TerrainEditUnderstoryTarget): boolean {
  return target.getStats?.().gpuStatus === "ring" && target.markPatchesDirty !== undefined;
}

export function createTerrainEditUnderstoryAdapter(
  target: TerrainEditUnderstoryTarget | null,
): TerrainEditUnderstoryAdapter | null {
  if (!target) return null;
  return {
    rebuildNodePatches(ids) {
      if (gpuRingIsLive(target)) {
        // The GPU ring hot-syncs terrain edit revisions during dispatch; keep the active draw buffers alive.
        target.markPatchesDirty!();
        return;
      }
      target.rebuildNodePatches(ids);
    },
  };
}
