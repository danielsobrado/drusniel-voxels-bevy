import { load } from "js-yaml";
import type {
  CanopyClipmapRingConfig,
  CanopyShellConfig,
} from "./canopy_types_internal.js";

export type {
  CanopyShellConfig,
  CanopySourceConfig,
  CanopyDistanceConfig,
  CanopyClipmapConfig,
  CanopyClipmapRingConfig,
  CanopyTreeDistributionConfig,
  CanopyMaterialConfig,
  CanopyDebugConfig,
  CanopyBudgetConfig,
} from "./canopy_types_internal.js";

export { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";

import { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";
import type { CanopyShellConfig as Config } from "./canopy_types_internal.js";

interface CanopyShellYaml {
  canopy_shell?: Record<string, unknown>;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readRgb(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const r = readNumber(value[0], fallback[0]);
  const g = readNumber(value[1], fallback[1]);
  const b = readNumber(value[2], fallback[2]);
  return [r, g, b];
}

function parseRings(raw: unknown, fallback: CanopyClipmapRingConfig[]): CanopyClipmapRingConfig[] {
  if (!Array.isArray(raw)) return fallback.map((r) => ({ ...r }));
  const rings: CanopyClipmapRingConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    rings.push({
      startM: readNumber(o.start_m, 0),
      endM: readNumber(o.end_m, 1),
      cellSizeM: readNumber(o.cell_size_m, 8),
    });
  }
  return rings.length > 0 ? rings : fallback.map((r) => ({ ...r }));
}

function parseConfig(raw: Record<string, unknown> | undefined, fallback: Config): Config {
  if (!raw) return structuredClone(fallback);
  const source = (raw.source ?? {}) as Record<string, unknown>;
  const distances = (raw.distances ?? {}) as Record<string, unknown>;
  const clipmap = (raw.clipmap ?? {}) as Record<string, unknown>;
  const tree = (raw.tree_distribution ?? {}) as Record<string, unknown>;
  const material = (raw.material ?? {}) as Record<string, unknown>;
  const debug = (raw.debug ?? {}) as Record<string, unknown>;
  const budgets = (raw.budgets ?? {}) as Record<string, unknown>;
  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    source: {
      mode: typeof source.mode === "string" ? source.mode : fallback.source.mode,
      allowSyntheticDebugFallback: readBoolean(source.allow_synthetic_debug_fallback, fallback.source.allowSyntheticDebugFallback),
      debugFallbackWarning: readBoolean(source.debug_fallback_warning, fallback.source.debugFallbackWarning),
    },
    distances: {
      realTreeEndM: readNumber(distances.real_tree_end_m, fallback.distances.realTreeEndM),
      impostorEndM: readNumber(distances.impostor_end_m, fallback.distances.impostorEndM),
      shellStartM: readNumber(distances.shell_start_m, fallback.distances.shellStartM),
      shellFullM: readNumber(distances.shell_full_m, fallback.distances.shellFullM),
      shellEndM: readNumber(distances.shell_end_m, fallback.distances.shellEndM),
      fadeBandM: readNumber(distances.fade_band_m, fallback.distances.fadeBandM),
    },
    clipmap: {
      enabled: readBoolean(clipmap.enabled, fallback.clipmap.enabled),
      tileSizeM: readNumber(clipmap.tile_size_m, fallback.clipmap.tileSizeM),
      cellSizeM: readNumber(clipmap.cell_size_m, fallback.clipmap.cellSizeM),
      evictionGraceSeconds: readNumber(clipmap.eviction_grace_seconds, fallback.clipmap.evictionGraceSeconds),
      evictionGraceTiles: Math.floor(readNumber(clipmap.eviction_grace_tiles, fallback.clipmap.evictionGraceTiles)),
      rings: parseRings(clipmap.rings, fallback.clipmap.rings),
    },
    treeDistribution: {
      densityScale: readNumber(tree.density_scale, fallback.treeDistribution.densityScale),
      forestThreshold: readNumber(tree.forest_threshold, fallback.treeDistribution.forestThreshold),
      slopeRejectStart: readNumber(tree.slope_reject_start, fallback.treeDistribution.slopeRejectStart),
      slopeRejectEnd: readNumber(tree.slope_reject_end, fallback.treeDistribution.slopeRejectEnd),
      waterReject: readBoolean(tree.water_reject, fallback.treeDistribution.waterReject),
      minCanopyHeightM: readNumber(tree.min_canopy_height_m, fallback.treeDistribution.minCanopyHeightM),
      maxCanopyHeightM: readNumber(tree.max_canopy_height_m, fallback.treeDistribution.maxCanopyHeightM),
      crownRadiusMinM: readNumber(tree.crown_radius_min_m, fallback.treeDistribution.crownRadiusMinM),
      crownRadiusMaxM: readNumber(tree.crown_radius_max_m, fallback.treeDistribution.crownRadiusMaxM),
    },
    material: {
      baseTint: readRgb(material.base_tint, fallback.material.baseTint),
      pineTint: readRgb(material.pine_tint, fallback.material.pineTint),
      broadleafTint: readRgb(material.broadleaf_tint, fallback.material.broadleafTint),
      deadwoodTint: readRgb(material.deadwood_tint, fallback.material.deadwoodTint),
      coverageAlphaPower: readNumber(material.coverage_alpha_power, fallback.material.coverageAlphaPower),
      crownBumpStrengthM: readNumber(material.crown_bump_strength_m, fallback.material.crownBumpStrengthM),
      horizonHazeStrength: readNumber(material.horizon_haze_strength, fallback.material.horizonHazeStrength),
      normalStrength: readNumber(material.normal_strength, fallback.material.normalStrength),
      ditherStrength: readNumber(material.dither_strength, fallback.material.ditherStrength),
    },
    debug: {
      showTileBounds: readBoolean(debug.show_tile_bounds, fallback.debug.showTileBounds),
      showCoverageHeatmap: readBoolean(debug.show_coverage_heatmap, fallback.debug.showCoverageHeatmap),
      showShellWireframe: readBoolean(debug.show_shell_wireframe, fallback.debug.showShellWireframe),
      showFadeZone: readBoolean(debug.show_fade_zone, fallback.debug.showFadeZone),
      freezeClipCenter: readBoolean(debug.freeze_clip_center, fallback.debug.freezeClipCenter),
      forceSyntheticSource: readBoolean(debug.force_synthetic_source, fallback.debug.forceSyntheticSource),
    },
    budgets: {
      maxTilesBuiltPerFrame: Math.floor(readNumber(budgets.max_tiles_built_per_frame, fallback.budgets.maxTilesBuiltPerFrame)),
      maxTextureUploadsPerFrame: Math.floor(readNumber(budgets.max_texture_uploads_per_frame, fallback.budgets.maxTextureUploadsPerFrame)),
      maxShellTris: Math.floor(readNumber(budgets.max_shell_tris, fallback.budgets.maxShellTris)),
    },
  };
}

export function validateCanopyShellConfig(config: CanopyShellConfig): void {
  const d = config.distances;
  if (d.realTreeEndM > d.impostorEndM) {
    throw new Error(`canopy_shell: real_tree_end_m (${d.realTreeEndM}) must be <= impostor_end_m (${d.impostorEndM})`);
  }
  if (d.impostorEndM > d.shellFullM) {
    throw new Error(`canopy_shell: impostor_end_m (${d.impostorEndM}) must be <= shell_full_m (${d.shellFullM})`);
  }
  if (d.shellStartM > d.shellFullM) {
    throw new Error(`canopy_shell: shell_start_m (${d.shellStartM}) must be <= shell_full_m (${d.shellFullM})`);
  }
  if (d.shellFullM > d.shellEndM) {
    throw new Error(`canopy_shell: shell_full_m (${d.shellFullM}) must be <= shell_end_m (${d.shellEndM})`);
  }
  if (d.shellEndM <= 0) {
    throw new Error("canopy_shell: shell_end_m must be > 0");
  }
  if (d.fadeBandM <= 0) {
    throw new Error("canopy_shell: fade_band_m must be > 0");
  }
  if (config.clipmap.cellSizeM <= 0) {
    throw new Error("canopy_shell: clipmap.cell_size_m must be > 0");
  }
  if (config.clipmap.tileSizeM <= 0) {
    throw new Error("canopy_shell: clipmap.tile_size_m must be > 0");
  }
  if (config.clipmap.evictionGraceSeconds < 0) {
    throw new Error("canopy_shell: clipmap.eviction_grace_seconds must be >= 0");
  }
  if (config.clipmap.evictionGraceTiles < 0) {
    throw new Error("canopy_shell: clipmap.eviction_grace_tiles must be >= 0");
  }
  let prevEnd = 0;
  for (let i = 0; i < config.clipmap.rings.length; i++) {
    const ring = config.clipmap.rings[i];
    if (ring.cellSizeM <= 0) {
      throw new Error(`canopy_shell: clipmap ring ${i} cell_size_m must be > 0`);
    }
    if (ring.startM < prevEnd) {
      throw new Error(`canopy_shell: clipmap ring ${i} start_m must be >= previous ring end_m`);
    }
    if (ring.startM >= ring.endM) {
      throw new Error(`canopy_shell: clipmap ring ${i} start_m must be < end_m`);
    }
    prevEnd = ring.endM;
  }
  if (config.budgets.maxTilesBuiltPerFrame < 0) {
    throw new Error("canopy_shell: budgets.max_tiles_built_per_frame must be >= 0");
  }
  if (config.budgets.maxTextureUploadsPerFrame < 0) {
    throw new Error("canopy_shell: budgets.max_texture_uploads_per_frame must be >= 0");
  }
  if (config.budgets.maxShellTris <= 0) {
    throw new Error("canopy_shell: budgets.max_shell_tris must be > 0");
  }
  for (const key of ["baseTint", "pineTint", "broadleafTint", "deadwoodTint"] as const) {
    const c = config.material[key];
    if (c.length !== 3) throw new Error(`canopy_shell: material.${key} must have 3 values`);
  }
}

export function parseCanopyShellConfig(
  yamlText: string,
  fallback: CanopyShellConfig = DEFAULT_CANOPY_SHELL_CONFIG,
): CanopyShellConfig {
  if (!yamlText.trim()) {
    const cfg = structuredClone(fallback);
    validateCanopyShellConfig(cfg);
    return cfg;
  }
  try {
    const parsed = load(yamlText) as CanopyShellYaml | null;
    const cfg = parseConfig(parsed?.canopy_shell as Record<string, unknown> | undefined, fallback);
    validateCanopyShellConfig(cfg);
    return cfg;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("canopy_shell:")) throw error;
    console.warn("[canopy-shell] invalid canopy_shell.yaml; using defaults", error);
    const cfg = structuredClone(fallback);
    validateCanopyShellConfig(cfg);
    return cfg;
  }
}

export function applyCanopyShellQueryOverrides(
  config: CanopyShellConfig,
  searchParams: URLSearchParams,
): CanopyShellConfig {
  const next = structuredClone(config);
  const canopy = searchParams.get("canopy");
  if (canopy === "0") next.enabled = false;
  if (canopy === "1") next.enabled = true;
  if (searchParams.get("canopySynthetic") === "1") next.debug.forceSyntheticSource = true;
  if (searchParams.get("freezeCanopy") === "1") next.debug.freezeClipCenter = true;
  const debug = searchParams.get("canopyDebug");
  if (debug === "coverage") next.debug.showCoverageHeatmap = true;
  if (debug === "tiles") next.debug.showTileBounds = true;
  if (debug === "wireframe") next.debug.showShellWireframe = true;
  if (debug === "fade") next.debug.showFadeZone = true;
  return next;
}

export function shouldUseDeterministicCanopy(
  scene: string | null,
  config: CanopyShellConfig,
  queryCanopy: boolean,
): boolean {
  if (!config.enabled) return false;
  if (scene === "long-view-forest-4km") return true;
  if (queryCanopy) return true;
  if (scene === "long-view-edit-stress") return true;
  if (scene?.startsWith("infinite-")) return true;
  if (scene?.startsWith("long-view-shadow-proxy-forest")) return true;
  return false;
}
