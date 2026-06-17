// Shared config contract. Node-side loading lives in config_node.ts so this module
// and the browser viewer never pull in node:fs.
import { load } from "js-yaml";

export interface DiagonalFlipConfig {
  enabled: boolean;
  min_triangle_area: number;
  min_normal_dot: number;
  min_angle_improvement_degrees: number;
  normal_error_weight: number;
  angle_quality_weight: number;
  material_error_weight: number;
}

export const DEFAULT_DIAGONAL_FLIP_CONFIG: DiagonalFlipConfig = {
  enabled: true,
  min_triangle_area: 0.000001,
  min_normal_dot: 0.05,
  min_angle_improvement_degrees: 2.0,
  normal_error_weight: 1.0,
  angle_quality_weight: 1.0,
  material_error_weight: 0.25,
};

export interface ClodPagesConfig {
  page: {
    chunks_per_page: number;
    chunk_size: number;
    halo_chunks: number;
    quadtree_levels: number;
  };
  simplify: {
    target_ratio_per_level: number;
    abandon_ratio: number;
    target_error: number;
    weld_epsilon_cells: number;
    attribute_weights: { normal: number; material: number };
  };
  polish: {
    diagonal_flip: DiagonalFlipConfig;
  };
  selection: {
    error_threshold_px: number;
    hysteresis_merge_factor: number;
    neighbor_level_delta_max: number;
    transition_mode: "instant" | "dither";
    crossfade_frames: number;
  };
  near_field: { radius_chunks: number };
  meshopt_package_version: string;
}

/** Parse YAML text into the config. Shared by the node loader and the browser viewer. */
export function parseConfig(text: string): ClodPagesConfig {
  const raw = load(text) as Partial<ClodPagesConfig>;
  return {
    ...raw,
    polish: {
      ...raw.polish,
      diagonal_flip: {
        ...DEFAULT_DIAGONAL_FLIP_CONFIG,
        ...raw.polish?.diagonal_flip,
      },
    },
  } as ClodPagesConfig;
}
