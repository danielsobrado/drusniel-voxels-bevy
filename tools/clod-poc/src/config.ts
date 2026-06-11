// Shared config contract for the repo-root config/clod_pages.yaml — the same file the
// Rust builder will consume. Node-side loading lives in config_node.ts so this module
// (and the browser viewer) never pulls in node:fs.
import { load } from "js-yaml";

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
  selection: {
    error_threshold_px: number;
    hysteresis_merge_factor: number;
    neighbor_level_delta_max: number;
    crossfade_frames: number;
  };
  near_field: { radius_chunks: number };
  meshopt_package_version: string;
}

/** Parse YAML text into the config. Shared by the node loader and the browser viewer. */
export function parseConfig(text: string): ClodPagesConfig {
  return load(text) as ClodPagesConfig;
}
