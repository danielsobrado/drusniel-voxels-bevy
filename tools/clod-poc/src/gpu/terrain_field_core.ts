// WGSL-shaped TypeScript port of the terrain SDF field (src/terrain.ts).
//
// This is the *spec* for the GPU compute mesher: every function here is written the way the
// WGSL is structured — explicit parameters, no module-global dig-edit array, resolved edit
// records instead of optional fields — so the shader in shaders/terrain_field_common.wgsl is a
// mechanical transliteration of this file. terrain_field_core.test.ts pins this core to the
// canonical f64 CPU field (terrain.ts) to the bit, so any GPU mismatch the user sees in-browser
// is a precision/pipeline issue (f32 vs f64, sqrt-of-dot vs Math.hypot), never a logic error.
//
// Keep the math here byte-identical to terrain.ts. The two are intentionally duplicated: the
// CPU mesher keeps its path, this is the GPU-shaped parallel reference guarded by the test.

import {
  DEFAULT_TERRAIN_FIELD_CONFIG,
  resolveTerrainFieldConfig,
  type TerrainFieldConfig,
  type TerrainFieldConfigInput,
} from "../terrain/terrain.js";
import { _fieldConfig } from "./terrain_field_core_math.js";

export type { ResolvedDigEdit } from "./terrain_field_core_types.js";
export {
  SHAPE_SPHERE,
  SHAPE_CUBE,
  SHAPE_CYLINDER,
  DIG_INFLUENCE_MARGIN,
  resolveDigEdits,
} from "./terrain_field_core_dig.js";
export {
  surfaceHeightCore,
  densityCore,
  densityGradientCore,
  paintMaterialAtCore,
  MATERIAL_PAINT_BAND,
} from "./terrain_field_core_math.js";

export function setTerrainFieldCoreConfig(config?: TerrainFieldConfigInput | null): void {
  _fieldConfig.value = config ? resolveTerrainFieldConfig(config) : DEFAULT_TERRAIN_FIELD_CONFIG;
}

export function getTerrainFieldCoreConfig(): TerrainFieldConfig {
  return _fieldConfig.value;
}
