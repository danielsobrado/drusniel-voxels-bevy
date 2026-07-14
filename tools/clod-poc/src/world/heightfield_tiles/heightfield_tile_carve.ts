import type { GraphHydrologySampler, GraphTerrainCarveConfig } from "../../water/graph_hydrology.js";
import { buildHeightfieldTile, type HeightfieldTile, type HeightfieldTileField } from "./heightfield_tile.js";
import type { WorldTileKey } from "../tile_key.js";
import type { FeatureStampField } from "../feature_stamps.js";

export interface HeightfieldTileCarveConfig extends GraphTerrainCarveConfig {}

export function buildCarvedHeightfieldTile(
  key: WorldTileKey,
  field: HeightfieldTileField,
  hydrology: GraphHydrologySampler,
  carve: HeightfieldTileCarveConfig,
  sourceRevision = field.sourceRevision ?? 0,
  features?: FeatureStampField,
): HeightfieldTile {
  return buildHeightfieldTile(key, {
    sourceRevision,
    complexity: field.complexity,
    sampleHeight(x, z) {
      const baseHeight = field.sampleHeight(x, z);
      const carvedHeight = hydrology.carveHeight(x, z, baseHeight, carve);
      // Fixed composition contract: macro field -> hydrology carve -> authored stamps -> voxel overlay.
      return features?.sampleHeight(x, z, carvedHeight) ?? carvedHeight;
    },
  }, sourceRevision);
}
