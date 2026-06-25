import { load } from "js-yaml";

export const PHASE1_DEBUG_MODES = [
  "final",
  "lod",
  "height",
  "slope",
  "normal",
  "flow",
  "biome",
  "paint_weights",
  "page_source_sections",
] as const;

export type Phase1DebugMode = typeof PHASE1_DEBUG_MODES[number];

export interface Phase1TerrainConfig {
  world: {
    sizeM: number;
    heightScaleM: number;
    seaLevelM: number;
    baseGrid: number;
    highGrid: number;
    targetGrid: number;
  };
  macro: {
    massifCenter: [number, number];
    valleyAxisAngleDeg: number;
    karstWeight: number;
    ridgeWeight: number;
    lakeWeight: number;
  };
  erosion: {
    enabled: boolean;
    iterations: number;
    thermalIterations: number;
    flowParticles: number;
    seedStream: string;
  };
  material: {
    heightBands: { id: string; minM: number; maxM: number }[];
    slopeRockStart: number;
    slopeRockFull: number;
    snowSlopeFade: number;
  };
  clod: {
    leafSegments: number;
    maxParentLevel: number;
    simplifyTargetRatio: number;
    minParentSegments: number;
    borderLockEpsilonM: number;
    borderChainSearchBandM: number;
    errorScale: number;
  };
  selection: {
    errorThresholdPx: number;
    hysteresisMergeFactor: number;
    enforce21: boolean;
  };
  runtime: {
    defaultScene: string;
    maxWorldPagesForRealtimeBuild: number;
    screenshotWorldPages: number;
    farViewM: number;
  };
  debug: {
    defaultMode: Phase1DebugMode;
    modes: Phase1DebugMode[];
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function numberAt(raw: Record<string, unknown>, key: string, path: string, min = -Infinity): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`${path}.${key} must be a finite number >= ${min}`);
  }
  return value;
}

function boolAt(raw: Record<string, unknown>, key: string, path: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new Error(`${path}.${key} must be boolean`);
  return value;
}

function stringAt(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path}.${key} must be a non-empty string`);
  return value;
}

function gridAt(raw: Record<string, unknown>, key: string, path: string): number {
  const value = numberAt(raw, key, path, 2);
  if (!Number.isInteger(value) || value > 4096) throw new Error(`${path}.${key} must be an integer <= 4096`);
  return value;
}

function intAt(raw: Record<string, unknown>, key: string, path: string, min: number): number {
  const value = numberAt(raw, key, path, min);
  if (!Number.isInteger(value)) throw new Error(`${path}.${key} must be an integer`);
  return value;
}

function ratioAt(raw: Record<string, unknown>, key: string, path: string): number {
  const value = numberAt(raw, key, path, Number.MIN_VALUE);
  if (value > 1) throw new Error(`${path}.${key} must be <= 1`);
  return value;
}

function debugMode(value: unknown, path: string): Phase1DebugMode {
  if (typeof value === "string" && PHASE1_DEBUG_MODES.includes(value as Phase1DebugMode)) return value as Phase1DebugMode;
  throw new Error(`${path} must be one of ${PHASE1_DEBUG_MODES.join(", ")}`);
}

export function parsePhase1Config(text: string): Phase1TerrainConfig {
  const doc = asRecord(load(text), "root");
  const phase1 = asRecord(doc["phase1"], "phase1");
  const world = asRecord(phase1["world"], "phase1.world");
  const macro = asRecord(phase1["macro"], "phase1.macro");
  const erosion = asRecord(phase1["erosion"], "phase1.erosion");
  const material = asRecord(phase1["material"], "phase1.material");
  const clod = asRecord(phase1["clod"], "phase1.clod");
  const selection = asRecord(phase1["selection"], "phase1.selection");
  const runtime = asRecord(phase1["runtime"], "phase1.runtime");
  const debug = asRecord(phase1["debug"], "phase1.debug");

  const massifRaw = macro["massif_center"];
  if (!Array.isArray(massifRaw) || massifRaw.length !== 2 || massifRaw.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("phase1.macro.massif_center must be [x, z]");
  }
  const bandsRaw = material["height_bands"];
  if (!Array.isArray(bandsRaw) || bandsRaw.length === 0) throw new Error("phase1.material.height_bands must be non-empty");
  const heightBands = bandsRaw.map((entry, index) => {
    const band = asRecord(entry, `phase1.material.height_bands[${index}]`);
    const minM = numberAt(band, "min_m", `phase1.material.height_bands[${index}]`);
    const maxM = numberAt(band, "max_m", `phase1.material.height_bands[${index}]`, minM);
    return { id: stringAt(band, "id", `phase1.material.height_bands[${index}]`), minM, maxM };
  });
  const modesRaw = debug["modes"];
  if (!Array.isArray(modesRaw) || modesRaw.length === 0) throw new Error("phase1.debug.modes must be non-empty");
  const modes = modesRaw.map((mode, index) => debugMode(mode, `phase1.debug.modes[${index}]`));
  const defaultMode = debugMode(debug["default_mode"], "phase1.debug.default_mode");
  if (!modes.includes(defaultMode)) throw new Error("phase1.debug.default_mode must be listed in phase1.debug.modes");

  const borderLockEpsilonM = numberAt(clod, "border_lock_epsilon_m", "phase1.clod", Number.MIN_VALUE);
  const borderChainSearchBandM = numberAt(clod, "border_chain_search_band_m", "phase1.clod", Number.MIN_VALUE);
  if (borderChainSearchBandM < borderLockEpsilonM) {
    throw new Error("phase1.clod.border_chain_search_band_m must be >= phase1.clod.border_lock_epsilon_m");
  }

  return {
    world: {
      sizeM: numberAt(world, "size_m", "phase1.world", 1),
      heightScaleM: numberAt(world, "height_scale_m", "phase1.world", 1),
      seaLevelM: numberAt(world, "sea_level_m", "phase1.world", 0),
      baseGrid: gridAt(world, "base_grid", "phase1.world"),
      highGrid: gridAt(world, "high_grid", "phase1.world"),
      targetGrid: gridAt(world, "target_grid", "phase1.world"),
    },
    macro: {
      massifCenter: [massifRaw[0] as number, massifRaw[1] as number],
      valleyAxisAngleDeg: numberAt(macro, "valley_axis_angle_deg", "phase1.macro"),
      karstWeight: numberAt(macro, "karst_weight", "phase1.macro", 0),
      ridgeWeight: numberAt(macro, "ridge_weight", "phase1.macro", 0),
      lakeWeight: numberAt(macro, "lake_weight", "phase1.macro", 0),
    },
    erosion: {
      enabled: boolAt(erosion, "enabled", "phase1.erosion"),
      iterations: numberAt(erosion, "iterations", "phase1.erosion", 0),
      thermalIterations: numberAt(erosion, "thermal_iterations", "phase1.erosion", 0),
      flowParticles: numberAt(erosion, "flow_particles", "phase1.erosion", 0),
      seedStream: stringAt(erosion, "seed_stream", "phase1.erosion"),
    },
    material: {
      heightBands,
      slopeRockStart: numberAt(material, "slope_rock_start", "phase1.material", 0),
      slopeRockFull: numberAt(material, "slope_rock_full", "phase1.material", 0),
      snowSlopeFade: numberAt(material, "snow_slope_fade", "phase1.material", 0),
    },
    clod: {
      leafSegments: intAt(clod, "leaf_segments", "phase1.clod", 4),
      maxParentLevel: intAt(clod, "max_parent_level", "phase1.clod", 1),
      simplifyTargetRatio: ratioAt(clod, "simplify_target_ratio", "phase1.clod"),
      minParentSegments: intAt(clod, "min_parent_segments", "phase1.clod", 2),
      borderLockEpsilonM,
      borderChainSearchBandM,
      errorScale: numberAt(clod, "error_scale", "phase1.clod", 0),
    },
    selection: {
      errorThresholdPx: numberAt(selection, "error_threshold_px", "phase1.selection", Number.MIN_VALUE),
      hysteresisMergeFactor: numberAt(selection, "hysteresis_merge_factor", "phase1.selection", 1),
      enforce21: boolAt(selection, "enforce_21", "phase1.selection"),
    },
    runtime: {
      defaultScene: stringAt(runtime, "default_scene", "phase1.runtime"),
      maxWorldPagesForRealtimeBuild: numberAt(runtime, "max_world_pages_for_realtime_build", "phase1.runtime", 1),
      screenshotWorldPages: numberAt(runtime, "screenshot_world_pages", "phase1.runtime", 1),
      farViewM: numberAt(runtime, "far_view_m", "phase1.runtime", 1),
    },
    debug: {
      defaultMode,
      modes,
    },
  };
}

export function normalizePhase1DebugMode(value: string | null, config: Phase1TerrainConfig): Phase1DebugMode {
  if (value && config.debug.modes.includes(value as Phase1DebugMode)) return value as Phase1DebugMode;
  if (value) console.warn(`[phase1] invalid terrainDebug=${value}; using ${config.debug.defaultMode}`);
  return config.debug.defaultMode;
}
