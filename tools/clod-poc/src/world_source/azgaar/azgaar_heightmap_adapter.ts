import type { HeightmapSource } from "../../terrain/heightmap_source.js";
import { decodeMacroAtlas, type AzgaarMacroWorldSource } from "./azgaar_macro_world_source.js";

export interface AzgaarHeightmapAdaptOptions {
  worldCells: number;
  /** Engine height at Azgaar raw 0. Defaults to 0. */
  baseM?: number;
  /** Engine height span across Azgaar raw 0–100. Defaults to 90. */
  spanM?: number;
  flipZ?: boolean;
  /** Micro-relief amplitude. Defaults to 0 so macro sampling can stay authoritative. */
  detailM?: number;
  seed?: number;
}

/**
 * Convert an Azgaar macro height atlas (raw 0–100) into the finite-world HeightmapSource
 * raster used by clod-poc CPU fields. Luminance = raw/100 so FMG sea level 20 ≈ 0.2.
 */
export function azgaarMacroToHeightmapSource(
  source: AzgaarMacroWorldSource,
  opts: AzgaarHeightmapAdaptOptions,
): HeightmapSource {
  const { heights } = decodeMacroAtlas(source);
  const data = new Float32Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) {
    data[i] = heights[i]! / 100;
  }
  return {
    width: source.atlas.width,
    height: source.atlas.height,
    data,
    worldCells: opts.worldCells,
    baseM: opts.baseM ?? 0,
    spanM: opts.spanM ?? 90,
    flipZ: opts.flipZ ?? false,
    detailM: opts.detailM ?? 0,
    seed: opts.seed ?? 0,
  };
}
