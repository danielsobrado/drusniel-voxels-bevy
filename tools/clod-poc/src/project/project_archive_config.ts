import { dump } from "js-yaml";
import { parseConfig, type ClodPagesConfig } from "../config.js";

const MAX_CHUNKS_PER_PAGE = 16;
const MAX_CHUNK_SIZE = 64;
const MAX_PAGE_CELLS = 512;
const MAX_HALO_CHUNKS = 8;
const MAX_QUADTREE_LEVELS = 16;
const MAX_NEAR_RADIUS_CHUNKS = 1024;
const MAX_POC_PAGES_PER_AXIS = 64;
const MAX_CROSSFADE_FRAMES = 10_000;
const MAX_NEIGHBOR_LEVEL_DELTA = 8;

function assertAtMost(value: number, max: number, label: string): void {
  if (value > max) throw new Error(`project.json config.${label} exceeds the supported limit ${max}`);
}

export function validateProjectArchiveConfig(value: unknown): ClodPagesConfig {
  let config: ClodPagesConfig;
  try {
    config = parseConfig(dump(value, { noRefs: true, sortKeys: true }));
  } catch (error) {
    throw new Error(
      `project.json has an invalid CLOD config snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assertAtMost(config.page.chunks_per_page, MAX_CHUNKS_PER_PAGE, "page.chunks_per_page");
  assertAtMost(config.page.chunk_size, MAX_CHUNK_SIZE, "page.chunk_size");
  assertAtMost(config.page.chunks_per_page * config.page.chunk_size, MAX_PAGE_CELLS, "page cells");
  assertAtMost(config.page.halo_chunks, MAX_HALO_CHUNKS, "page.halo_chunks");
  assertAtMost(config.page.quadtree_levels, MAX_QUADTREE_LEVELS, "page.quadtree_levels");
  assertAtMost(config.near_field.radius_chunks, MAX_NEAR_RADIUS_CHUNKS, "near_field.radius_chunks");
  assertAtMost(config.poc.lod0_pages_x, MAX_POC_PAGES_PER_AXIS, "poc.lod0_pages_x");
  assertAtMost(config.poc.lod0_pages_z, MAX_POC_PAGES_PER_AXIS, "poc.lod0_pages_z");
  assertAtMost(config.poc.smoke_lod0_pages_x, MAX_POC_PAGES_PER_AXIS, "poc.smoke_lod0_pages_x");
  assertAtMost(config.poc.smoke_lod0_pages_z, MAX_POC_PAGES_PER_AXIS, "poc.smoke_lod0_pages_z");
  assertAtMost(config.selection.crossfade_frames, MAX_CROSSFADE_FRAMES, "selection.crossfade_frames");
  assertAtMost(config.selection.neighbor_level_delta_max, MAX_NEIGHBOR_LEVEL_DELTA, "selection.neighbor_level_delta_max");
  return config;
}
