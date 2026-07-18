export interface TerrainEditUnderstoryTarget {
  rebuildNodePatches(ids: string[]): void;
}

export interface TerrainEditUnderstoryAdapter {
  rebuildNodePatches(ids: string[]): void;
}

export function createTerrainEditUnderstoryAdapter(
  target: TerrainEditUnderstoryTarget | null,
): TerrainEditUnderstoryAdapter | null {
  if (!target) return null;
  return {
    rebuildNodePatches(ids) {
      target.rebuildNodePatches(ids);
    },
  };
}
