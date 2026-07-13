import type { GraphHydrologySampler, GraphTerrainCarveConfig } from "../../water/graph_hydrology.js";
import { buildHeightfieldTile, type HeightfieldTile, type HeightfieldTileField } from "./heightfield_tile.js";
import type { WorldTileKey } from "../tile_key.js";

export interface HeightfieldTileCarveConfig extends GraphTerrainCarveConfig {}

export function buildCarvedHeightfieldTile(
  key: WorldTileKey,
  field: HeightfieldTileField,
  hydrology: GraphHydrologySampler,
  carve: HeightfieldTileCarveConfig,
  sourceRevision = field.sourceRevision ?? 0,
): HeightfieldTile {
  return buildHeightfieldTile(key, {
    sourceRevision,
    sampleHeight(x, z) {
      const baseHeight = field.sampleHeight(x, z);
      return hydrology.carveHeight(x, z, baseHeight, carve);
    },
  }, sourceRevision);
}

