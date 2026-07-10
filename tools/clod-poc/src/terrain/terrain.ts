export {
  WATER_LEVEL,
  type WorldBounds,
  type TerrainSurfaceOverride,
  type TerrainFieldConfig,
  type TerrainFieldConfigInput,
  DEFAULT_TERRAIN_FIELD_CONFIG,
  DEFAULT_TERRAIN_SEED,
  resolveTerrainFieldConfig,
  setTerrainFieldConfig,
  getTerrainFieldConfig,
  setTerrainSurfaceOverride,
  setBorderCoastRuntime,
  getBorderCoastRuntime,
  baseSurfaceHeight,
  surfaceHeight,
} from "./terrain_surface.js";
export { parseBorderCoastOceanConfig, type BorderCoastOceanConfig } from "./border_coast_config.js";
export { coastMask, worldEdgeDistance, applyBorderCoastShape, sampleCoastType } from "./border_coast.js";
export { density, surfaceNormal } from "./terrain_density.js";
export {
  type DigEdit,
  type BrushShape,
  type BrushOp,
  DIG_INFLUENCE_MARGIN,
  addDigEdit,
  applyDigEditTransaction,
  rollbackDigEditTransaction,
  voxelTransactionFromDigEdit,
  getDigEditsSnapshot,
  replaceDigEdits,
  clearDigEdits,
  digEditCount,
  hasPaintedTerrainEdits,
  getDigEditRevision,
  getVoxelEditSnapshot,
  getVoxelEditSnapshotForBounds,
  voxelEditCount,
  voxelEditsRequireCpuDerivedMeshing,
  replaceVoxelEdits,
} from "./terrain_edits.js";
export { mergeVoxelSnapshots } from "./voxel_edits/voxel_snapshot_merge.js";
export {
  type VoxelEditSnapshot,
  type VoxelDelta,
  type VoxelDeltaBefore,
  type VoxelEditBounds,
  type VoxelEditTransaction,
} from "./voxel_edits/voxel_edit_types.js";
export { type SdfBrush, type SdfBrushOp, type SdfBrushShape, applyBrushSdfToDensity, sampleBrushSdf } from "./sdf/sdf_brush.js";
export { rasterizeSdfBrushToVoxelTransaction, type SdfBrushRasterizeInput, type SdfRasterBounds } from "./sdf/sdf_rasterizer.js";
export { terrainWeights, paintMaterialAt, paintWeightsAt, type VertexPaint, PAINT_BLEND_CHANNELS, MATERIAL_PAINT_BAND, PAINT_FADE } from "./terrain_paint.js";
export { meshChunk } from "./terrain_chunk_mesher.js";
