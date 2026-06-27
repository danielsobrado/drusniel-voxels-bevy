import { load } from "js-yaml";
import type { FarClipmapRingConfig } from "./types.js";

export type NaadfTraversalMode = "dense" | "hdda" | "compare";
export type NaadfFarShellHeightSamplingMode = "gpu" | "cpu";

export interface NaadfWorldConfig {
  seed: number;
  chunkSizeCells: number;
  voxelSizeM: number;
  coordinateMode: string;
}

export interface NaadfStreamingConfig {
  preloadSeconds: number;
  maxJobsPerFrame: number;
  maxCommitsPerFrame: number;
  evictionGraceSeconds: number;
  keepStaleUntilReplacement: boolean;
}

export interface NaadfNearPageTableConfig {
  enabled: boolean;
  radiusChunksXz: number;
  heightLayers: number;
}

export interface NaadfHashFallbackConfig {
  enabled: boolean;
  capacity: number;
}

export interface NaadfChunkBricksConfig {
  brickSize: number;
  storeMode: string;
  buildMips: boolean;
  maxDirtyBricksPerFrame: number;
}

export interface NaadfMipSummaryConfig {
  levels: number[];
  conservativeEmptySkip: boolean;
  mixedNodesRefine: boolean;
  store: string[];
}

export interface NaadfQueryConfig {
  maxStepsPrimary: number;
  maxStepsSun: number;
  epsilonM: number;
  primaryLodBias: number;
  sunLodBias: number;
  farSummaryLodBias: number;
  unknownCountsAsBlockedForSun: boolean;
}

export interface NaadfTraversalConfig {
  mode: NaadfTraversalMode;
  hddaUseDirectionalBounds: boolean;
  hddaMaxChunkSteps: number;
  hddaMaxBlockSteps: number;
  hddaMaxVoxelSteps: number;
  compareDistanceEpsilonM: number;
}

export interface NaadfFarShellConfig {
  mode: string;
  startM: number;
  endM: number;
  gridRes: number;
  useNaadfSummary: boolean;
  heightSamplingMode: NaadfFarShellHeightSamplingMode;
}

export interface NaadfDebugConfig {
  enabled: boolean;
  showNearPageTable: boolean;
  showHashFallbackTiles: boolean;
  showFarClipmapRings: boolean;
  showRaySteps: boolean;
  showMissingSamples: boolean;
  showSummaryMips: boolean;
  showAadfSkips: boolean;
  showSunVisibility: boolean;
  splitScreenPrimaryDebug: boolean;
  freezeStreamCenter: boolean;
  showStreamCenter: boolean;
  showPredictedStreamCenter: boolean;
  showStaleSummaries: boolean;
  showEviction: boolean;
}

export interface NaadfAcceptanceConfig {
  maxVisibleHoles: number;
  maxMissingSamplesPerFrame: number;
  maxP95PrimarySteps: number;
  maxP95SunSteps: number;
}

export interface NaadfFarClipmapConfig {
  enabled: boolean;
  rings: FarClipmapRingConfig[];
  tileCells: number;
}

export interface NaadfPocConfig {
  enabled: boolean;
  world: NaadfWorldConfig;
  streaming: NaadfStreamingConfig;
  nearPageTable: NaadfNearPageTableConfig;
  hashFallback: NaadfHashFallbackConfig;
  chunkBricks: NaadfChunkBricksConfig;
  mipSummary: NaadfMipSummaryConfig;
  farClipmap: NaadfFarClipmapConfig;
  query: NaadfQueryConfig;
  traversal: NaadfTraversalConfig;
  farShell: NaadfFarShellConfig;
  debug: NaadfDebugConfig;
  acceptance: NaadfAcceptanceConfig;
}

const TRAVERSAL_MODES: ReadonlySet<NaadfTraversalMode> = new Set(["dense", "hdda", "compare"]);
const FAR_SHELL_HEIGHT_MODES: ReadonlySet<NaadfFarShellHeightSamplingMode> = new Set(["gpu", "cpu"]);

function requireNumber(value: unknown, path: string, min?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`NAADF config: expected number at ${path}, got ${String(value)}`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`NAADF config: ${path} must be >= ${min}, got ${value}`);
  }
  return value;
}

function optionalNumber(value: unknown, path: string, defaultValue: number, min?: number): number {
  return value === undefined ? defaultValue : requireNumber(value, path, min);
}

function requireBool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`NAADF config: expected boolean at ${path}, got ${String(value)}`);
  }
  return value;
}

function optionalBool(value: unknown, path: string, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : requireBool(value, path);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`NAADF config: expected string at ${path}, got ${String(value)}`);
  }
  return value;
}

function requireTraversalMode(value: unknown, path: string): NaadfTraversalMode {
  const mode = requireString(value, path);
  if (!TRAVERSAL_MODES.has(mode as NaadfTraversalMode)) {
    throw new Error(`NAADF config: ${path} must be dense, hdda, or compare, got ${mode}`);
  }
  return mode as NaadfTraversalMode;
}

function requireFarShellHeightMode(value: unknown, path: string): NaadfFarShellHeightSamplingMode {
  const mode = requireString(value, path);
  if (!FAR_SHELL_HEIGHT_MODES.has(mode as NaadfFarShellHeightSamplingMode)) {
    throw new Error(`NAADF config: ${path} must be gpu or cpu, got ${mode}`);
  }
  return mode as NaadfFarShellHeightSamplingMode;
}

function parseRing(raw: Record<string, unknown>, path: string): FarClipmapRingConfig {
  return {
    name: requireString(raw["name"], `${path}.name`),
    startM: requireNumber(raw["start_m"], `${path}.start_m`, 0),
    endM: requireNumber(raw["end_m"], `${path}.end_m`, 0),
    cellM: requireNumber(raw["cell_m"], `${path}.cell_m`, 1),
  };
}

function requireSection(raw: unknown, name: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error(`NAADF config: missing required section '${name}'`);
  }
  return raw as Record<string, unknown>;
}

function optionalSection(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object") {
    throw new Error("NAADF config: optional section must be an object when present");
  }
  return raw as Record<string, unknown>;
}

export function parseNaadfPocConfig(yamlText: string): NaadfPocConfig {
  const root = load(yamlText) as Record<string, unknown>;
  const raw = root["naadf_poc"];
  if (!raw || typeof raw !== "object") {
    throw new Error("NAADF config: missing naadf_poc root");
  }
  const cfg = raw as Record<string, unknown>;

  const worldRaw = requireSection(cfg["world"], "world");
  const streamRaw = requireSection(cfg["streaming"], "streaming");
  const nearRaw = requireSection(cfg["near_page_table"], "near_page_table");
  const hashRaw = requireSection(cfg["hash_fallback"], "hash_fallback");
  const brickRaw = requireSection(cfg["chunk_bricks"], "chunk_bricks");
  const mipRaw = requireSection(cfg["mip_summary"], "mip_summary");
  const farRaw = requireSection(cfg["far_clipmap"], "far_clipmap");
  const queryRaw = requireSection(cfg["query"], "query");
  const traversalRaw = optionalSection(cfg["traversal"]);
  const shellRaw = requireSection(cfg["far_shell"], "far_shell");
  const debugRaw = requireSection(cfg["debug"], "debug");
  const acceptRaw = requireSection(cfg["acceptance"], "acceptance");

  const ringsRaw = farRaw["rings"];
  if (!Array.isArray(ringsRaw) || ringsRaw.length === 0) {
    throw new Error("NAADF config: far_clipmap.rings must be a non-empty array");
  }

  const storeRaw = mipRaw["store"];
  if (!Array.isArray(storeRaw)) {
    throw new Error("NAADF config: mip_summary.store must be an array");
  }

  const levelsRaw = mipRaw["levels"];
  if (!Array.isArray(levelsRaw)) {
    throw new Error("NAADF config: mip_summary.levels must be an array");
  }

  const chunkSizeCells = requireNumber(worldRaw["chunk_size_cells"], "world.chunk_size_cells", 1);
  if ((chunkSizeCells & (chunkSizeCells - 1)) !== 0) {
    throw new Error(`NAADF config: world.chunk_size_cells must be a power of 2, got ${chunkSizeCells}`);
  }

  return {
    enabled: requireBool(cfg["enabled"], "naadf_poc.enabled"),
    world: {
      seed: requireNumber(worldRaw["seed"], "world.seed"),
      chunkSizeCells,
      voxelSizeM: requireNumber(worldRaw["voxel_size_m"], "world.voxel_size_m", 0),
      coordinateMode: requireString(worldRaw["coordinate_mode"], "world.coordinate_mode"),
    },
    streaming: {
      preloadSeconds: requireNumber(streamRaw["preload_seconds"], "streaming.preload_seconds", 0),
      maxJobsPerFrame: requireNumber(streamRaw["max_jobs_per_frame"], "streaming.max_jobs_per_frame", 1),
      maxCommitsPerFrame: requireNumber(streamRaw["max_commits_per_frame"], "streaming.max_commits_per_frame", 1),
      evictionGraceSeconds: requireNumber(streamRaw["eviction_grace_seconds"], "streaming.eviction_grace_seconds", 0),
      keepStaleUntilReplacement: requireBool(streamRaw["keep_stale_until_replacement"], "streaming.keep_stale_until_replacement"),
    },
    nearPageTable: {
      enabled: requireBool(nearRaw["enabled"], "near_page_table.enabled"),
      radiusChunksXz: requireNumber(nearRaw["radius_chunks_xz"], "near_page_table.radius_chunks_xz", 1),
      heightLayers: requireNumber(nearRaw["height_layers"], "near_page_table.height_layers", 1),
    },
    hashFallback: {
      enabled: requireBool(hashRaw["enabled"], "hash_fallback.enabled"),
      capacity: requireNumber(hashRaw["capacity"], "hash_fallback.capacity", 1),
    },
    chunkBricks: {
      brickSize: requireNumber(brickRaw["brick_size"], "chunk_bricks.brick_size", 1),
      storeMode: requireString(brickRaw["store_mode"], "chunk_bricks.store_mode"),
      buildMips: requireBool(brickRaw["build_mips"], "chunk_bricks.build_mips"),
      maxDirtyBricksPerFrame: requireNumber(brickRaw["max_dirty_bricks_per_frame"], "chunk_bricks.max_dirty_bricks_per_frame", 1),
    },
    mipSummary: {
      levels: levelsRaw.map((v, i) => requireNumber(v, `mip_summary.levels[${i}]`, 1)),
      conservativeEmptySkip: requireBool(mipRaw["conservative_empty_skip"], "mip_summary.conservative_empty_skip"),
      mixedNodesRefine: requireBool(mipRaw["mixed_nodes_refine"], "mip_summary.mixed_nodes_refine"),
      store: storeRaw.map((v, i) => requireString(v, `mip_summary.store[${i}]`)),
    },
    farClipmap: {
      enabled: requireBool(farRaw["enabled"], "far_clipmap.enabled"),
      rings: ringsRaw.map((r, i) => parseRing(r as Record<string, unknown>, `far_clipmap.rings[${i}]`)),
      tileCells: requireNumber(farRaw["tile_cells"] ?? 32, "far_clipmap.tile_cells", 1),
    },
    query: {
      maxStepsPrimary: requireNumber(queryRaw["max_steps_primary"], "query.max_steps_primary", 1),
      maxStepsSun: requireNumber(queryRaw["max_steps_sun"], "query.max_steps_sun", 1),
      epsilonM: requireNumber(queryRaw["epsilon_m"], "query.epsilon_m", 0),
      primaryLodBias: requireNumber(queryRaw["primary_lod_bias"], "query.primary_lod_bias"),
      sunLodBias: requireNumber(queryRaw["sun_lod_bias"], "query.sun_lod_bias"),
      farSummaryLodBias: requireNumber(queryRaw["far_summary_lod_bias"], "query.far_summary_lod_bias"),
      unknownCountsAsBlockedForSun: requireBool(queryRaw["unknown_counts_as_blocked_for_sun"], "query.unknown_counts_as_blocked_for_sun"),
    },
    traversal: {
      mode: requireTraversalMode(traversalRaw["mode"] ?? "dense", "traversal.mode"),
      hddaUseDirectionalBounds: optionalBool(traversalRaw["hdda_use_directional_bounds"], "traversal.hdda_use_directional_bounds", false),
      hddaMaxChunkSteps: optionalNumber(traversalRaw["hdda_max_chunk_steps"], "traversal.hdda_max_chunk_steps", 512, 1),
      hddaMaxBlockSteps: optionalNumber(traversalRaw["hdda_max_block_steps"], "traversal.hdda_max_block_steps", 2048, 1),
      hddaMaxVoxelSteps: optionalNumber(traversalRaw["hdda_max_voxel_steps"], "traversal.hdda_max_voxel_steps", 4096, 1),
      compareDistanceEpsilonM: optionalNumber(traversalRaw["compare_distance_epsilon_m"], "traversal.compare_distance_epsilon_m", 0.001, 0),
    },
    farShell: {
      mode: requireString(shellRaw["mode"], "far_shell.mode"),
      startM: requireNumber(shellRaw["start_m"], "far_shell.start_m", 0),
      endM: requireNumber(shellRaw["end_m"], "far_shell.end_m", 0),
      gridRes: requireNumber(shellRaw["grid_res"], "far_shell.grid_res", 1),
      useNaadfSummary: requireBool(shellRaw["use_naadf_summary"], "far_shell.use_naadf_summary"),
      heightSamplingMode: requireFarShellHeightMode(shellRaw["height_sampling_mode"] ?? "cpu", "far_shell.height_sampling_mode"),
    },
    debug: {
      enabled: requireBool(debugRaw["enabled"], "debug.enabled"),
      showNearPageTable: debugRaw["show_near_page_table"] === true,
      showHashFallbackTiles: debugRaw["show_hash_fallback_tiles"] === true,
      showFarClipmapRings: debugRaw["show_far_clipmap_rings"] !== false,
      showRaySteps: debugRaw["show_ray_steps"] === true,
      showMissingSamples: debugRaw["show_missing_samples"] !== false,
      showSummaryMips: debugRaw["show_summary_mips"] === true,
      showAadfSkips: debugRaw["show_aadf_skips"] === true,
      showSunVisibility: debugRaw["show_sun_visibility"] === true,
      splitScreenPrimaryDebug: debugRaw["split_screen_primary_debug"] === true,
      freezeStreamCenter: debugRaw["freeze_stream_center"] === true,
      showStreamCenter: debugRaw["show_stream_center"] === true,
      showPredictedStreamCenter: debugRaw["show_predicted_stream_center"] === true,
      showStaleSummaries: debugRaw["show_stale_summaries"] === true,
      showEviction: debugRaw["show_eviction"] === true,
    },
    acceptance: {
      maxVisibleHoles: requireNumber(acceptRaw["max_visible_holes"], "acceptance.max_visible_holes", 0),
      maxMissingSamplesPerFrame: requireNumber(acceptRaw["max_missing_samples_per_frame"], "acceptance.max_missing_samples_per_frame", 0),
      maxP95PrimarySteps: requireNumber(acceptRaw["max_p95_primary_steps"], "acceptance.max_p95_primary_steps", 1),
      maxP95SunSteps: requireNumber(acceptRaw["max_p95_sun_steps"], "acceptance.max_p95_sun_steps", 1),
    },
  };
}

export function ringForDistance(distanceM: number, config: NaadfPocConfig): FarClipmapRingConfig | null {
  for (const ring of config.farClipmap.rings) {
    if (distanceM >= ring.startM && distanceM < ring.endM) {
      return ring;
    }
  }
  return null;
}

export function coarserRingIndex(ringIndex: number, config: NaadfPocConfig): number | null {
  const next = ringIndex + 1;
  return next < config.farClipmap.rings.length ? next : null;
}
