import type { TerrainMaterialCache } from "./terrainMaterialCache.js";
import type { TerrainMaterialCacheEntry, TerrainMaterialCacheKey } from "./terrainMaterialCacheTypes.js";

export function invalidateTerrainMaterialSources(
  cache: TerrainMaterialCache,
  sources: readonly Pick<TerrainMaterialCacheKey, "sourceKind" | "sourceId">[],
): number {
  let invalidated = 0;
  for (const source of sources) {
    invalidated += cache.invalidateSource(source.sourceKind, source.sourceId);
  }
  return invalidated;
}

export function invalidateTerrainMaterialDependents(
  cache: TerrainMaterialCache,
  revisions: {
    materialRevision?: number;
    waterRevision?: number;
    vegetationCoverageRevision?: number;
  },
): number {
  return cache.invalidateWhere((entry: TerrainMaterialCacheEntry) => {
    if (revisions.materialRevision !== undefined && entry.key.materialRevision < revisions.materialRevision) return true;
    if (revisions.waterRevision !== undefined && entry.key.waterRevision < revisions.waterRevision) return true;
    if (revisions.vegetationCoverageRevision !== undefined && entry.key.vegetationCoverageRevision < revisions.vegetationCoverageRevision) return true;
    return false;
  }, "dependent_revision");
}
