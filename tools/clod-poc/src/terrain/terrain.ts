export { WATER_LEVEL, type WorldBounds, type TerrainSurfaceOverride, setTerrainSurfaceOverride, baseSurfaceHeight, surfaceHeight } from "./terrain_surface.js";
export { density, surfaceNormal } from "./terrain_density.js";
export { type DigEdit, type BrushShape, type BrushOp, DIG_INFLUENCE_MARGIN, addDigEdit, getDigEditsSnapshot, replaceDigEdits, clearDigEdits, digEditCount, getDigEditRevision } from "./terrain_edits.js";
export { terrainWeights, paintMaterialAt, paintWeightsAt, type VertexPaint, PAINT_BLEND_CHANNELS, MATERIAL_PAINT_BAND, PAINT_FADE } from "./terrain_paint.js";
export { meshChunk } from "./terrain_chunk_mesher.js";
