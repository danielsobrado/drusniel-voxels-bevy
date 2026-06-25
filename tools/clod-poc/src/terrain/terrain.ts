export {
  WATER_LEVEL,
  type WorldBounds,
  type TerrainSurfaceOverride,
  setTerrainSurfaceOverride,
  setBorderCoastRuntime,
  getBorderCoastRuntime,
  baseSurfaceHeight,
  surfaceHeight,
} from "./terrain_surface.js";
export { parseBorderCoastOceanConfig, type BorderCoastOceanConfig } from "./border_coast_config.js";
export { coastMask, worldEdgeDistance, applyBorderCoastShape, sampleCoastType } from "./border_coast.js";
export { density, surfaceNormal } from "./terrain_density.js";
export { type DigEdit, type BrushShape, type BrushOp, DIG_INFLUENCE_MARGIN, addDigEdit, getDigEditsSnapshot, replaceDigEdits, clearDigEdits, digEditCount, getDigEditRevision } from "./terrain_edits.js";
export { terrainWeights, paintMaterialAt, paintWeightsAt, type VertexPaint, PAINT_BLEND_CHANNELS, MATERIAL_PAINT_BAND, PAINT_FADE } from "./terrain_paint.js";
export { meshChunk } from "./terrain_chunk_mesher.js";
