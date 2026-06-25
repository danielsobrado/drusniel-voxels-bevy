// Config contract for the fake water clipmap (config/water.yaml).
//
// Water is a POC visual layer only. It never feeds the CLOD page source mesh,
// meshoptimizer simplification, page borders, LOD selection, colliders, or
// validation. The dependency direction is scene -> water, never pages -> water.
import { load } from "js-yaml";
import {
  DEFAULT_HYDROLOGY_CONFIG,
  cloneHydrologyConfig,
  type HydrologyConfig,
} from "./hydrologyConfig.js";
import { DEFAULT_CAUSTICS_CONFIG, type CausticsConfig } from "./causticsConfig.js";

/** Debug render modes for the water material. */
export const WATER_DEBUG_MODES = {
  final: 0,
  depth: 1,
  foam: 2,
  fresnel: 3,
  bodyMask: 4,
  clipmapLevel: 5,
  flow: 6,
  hydrologyFill: 7,
  accumulation: 8,
  carvedBed: 9,
  waterY: 10,
  classification: 11,
  refraction: 12,
  reflection: 13,
  ssrHit: 14,
} as const;
export type WaterDebugMode = keyof typeof WATER_DEBUG_MODES;
export type WaterDebugModeId = typeof WATER_DEBUG_MODES[WaterDebugMode];

export interface LakeBodyConfig {
  center: [number, number];
  centerNorm?: [number, number];
  radius: [number, number];
  levelOffset: number;
}

export interface RiverBodyConfig {
  points: Array<[number, number]>;
  pointsNorm?: Array<[number, number]>;
  width: number;
  levelOffset: number;
  downstreamDrop: number;
}

export interface WaterVisualConfig {
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  foamColor: [number, number, number];
  alpha: number;
  rippleCycle: number;
  fresnelPower: number;
  rippleAmp: number;
  rippleSpeed: number;
  rippleScaleA: number;
  rippleScaleB: number;
  rippleStrengthA: number;
  rippleStrengthB: number;
  rippleLoopDistance: number;
  lakeBreeze: [number, number];
  shoreFoamStart: number;
  shoreFoamEnd: number;
  maxDepthForColor: number;
  foam: WaterFoamVisualConfig;
  fresnel: WaterFresnelVisualConfig;
  color: WaterColorVisualConfig;
  refraction: WaterRefractionConfig;
  reflection: WaterReflectionConfig;
  depthWrite: boolean;
}

export interface WaterDebugConfig {
  mode: WaterDebugModeId;
  clipmapTint: boolean;
  wireframe: boolean;
}

export interface WaterFoamVisualConfig {
  noiseScale: number;
  shoreStrength: number;
  riverStrength: number;
  speedStart: number;
  speedEnd: number;
  dropStart: number;
  dropEnd: number;
}

export interface WaterFresnelVisualConfig {
  base: number;
  power: number;
  normalFlatten: number;
}

export interface WaterColorVisualConfig {
  depthScale: number;
  turbidity: number;
}

export interface WaterRefractionConfig {
  enabled: boolean;
  strength: number;
  depthValidationBias: number;
  absorptionR: number;
  absorptionG: number;
  absorptionB: number;
  turbidityStrength: number;
  maxThickness: number;
}

export interface WaterReflectionConfig {
  mode: "fake" | "ssr";
  ssrEnabled: boolean;
  maxSteps: number;
  stepScale: number;
  edgeFadeStart: number;
  edgeFadeEnd: number;
  skyFallbackStrength: number;
  terrainFallbackStrength: number;
}

export interface WaterConfig {
  enabled: boolean;
  source: "hydrology" | "fake_bodies";
  cellsPerLevel: number;
  cellSizes: number[];
  snapCells: number;
  drySentinelDepth: number;
  fakeBodies: {
    carveTerrain: boolean;
    lakes: LakeBodyConfig[];
    rivers: RiverBodyConfig[];
  };
  hydrology: HydrologyConfig;
  visual: WaterVisualConfig;
  caustics: CausticsConfig;
  debug: WaterDebugConfig;
}

export const DEFAULT_WATER_VISUAL: WaterVisualConfig = {
  shallowColor: [0.16, 0.38, 0.36],
  deepColor: [0.02, 0.08, 0.12],
  foamColor: [0.82, 0.88, 0.84],
  alpha: 0.82,
  rippleCycle: 0.065,
  fresnelPower: 5.0,
  rippleAmp: 1.0,
  rippleSpeed: 0.45,
  rippleScaleA: 0.18,
  rippleScaleB: 0.115,
  rippleStrengthA: 0.20,
  rippleStrengthB: 0.13,
  rippleLoopDistance: 18.0,
  lakeBreeze: [0.18, 0.06],
  shoreFoamStart: 0.03,
  shoreFoamEnd: 0.16,
  maxDepthForColor: 4.0,
  foam: {
    noiseScale: 0.09,
    shoreStrength: 0.58,
    riverStrength: 0.42,
    speedStart: 0.25,
    speedEnd: 1.0,
    dropStart: 0.5,
    dropEnd: 2.0,
  },
  fresnel: {
    base: 0.08,
    power: 4.5,
    normalFlatten: 0.72,
  },
  color: {
    depthScale: 4.0,
    turbidity: 0.18,
  },
  refraction: {
    enabled: true,
    strength: 0.055,
    depthValidationBias: 0.02,
    absorptionR: 0.42,
    absorptionG: 0.135,
    absorptionB: 0.095,
    turbidityStrength: 0.032,
    maxThickness: 8.0,
  },
  reflection: {
    mode: "fake",
    ssrEnabled: false,
    maxSteps: 18,
    stepScale: 0.09,
    edgeFadeStart: 1.0,
    edgeFadeEnd: 0.82,
    skyFallbackStrength: 0.65,
    terrainFallbackStrength: 0.18,
  },
  depthWrite: false,
};

export const DEFAULT_WATER_CONFIG: WaterConfig = {
  enabled: true,
  source: "hydrology",
  cellsPerLevel: 128,
  cellSizes: [1.5, 3.0, 6.0, 12.0, 24.0, 48.0],
  snapCells: 2,
  drySentinelDepth: 2.0,
  fakeBodies: {
    carveTerrain: true,
    lakes: [
      { center: [0, 0], centerNorm: [0.50, 0.50], radius: [42, 30], levelOffset: 1.2 },
      { center: [0, 0], centerNorm: [0.25, 0.72], radius: [32, 24], levelOffset: 1.0 },
    ],
    rivers: [
      {
        points: [],
        pointsNorm: [[0.16, 0.34], [0.30, 0.42], [0.48, 0.48], [0.66, 0.57], [0.84, 0.66]],
        width: 9.0,
        levelOffset: 0.8,
        downstreamDrop: 3.0,
      },
    ],
  },
  hydrology: cloneHydrologyConfig(),
  visual: { ...DEFAULT_WATER_VISUAL },
  caustics: { ...DEFAULT_CAUSTICS_CONFIG },
  debug: { mode: WATER_DEBUG_MODES.final, clipmapTint: false, wireframe: false },
};

export function cloneWaterConfig(config: WaterConfig = DEFAULT_WATER_CONFIG): WaterConfig {
  return {
    ...config,
    hydrology: cloneHydrologyConfig(config.hydrology),
    cellSizes: [...config.cellSizes],
    caustics: { ...config.caustics },
    fakeBodies: {
      carveTerrain: config.fakeBodies.carveTerrain,
      lakes: config.fakeBodies.lakes.map((lake) => ({
        center: [...lake.center] as [number, number],
        centerNorm: lake.centerNorm ? [...lake.centerNorm] as [number, number] : undefined,
        radius: [...lake.radius] as [number, number],
        levelOffset: lake.levelOffset,
      })),
      rivers: config.fakeBodies.rivers.map((river) => ({
        points: river.points.map((p) => [...p] as [number, number]),
        pointsNorm: river.pointsNorm ? river.pointsNorm.map((p) => [...p] as [number, number]) : undefined,
        width: river.width,
        levelOffset: river.levelOffset,
        downstreamDrop: river.downstreamDrop,
      })),
    },
    visual: {
      ...config.visual,
      shallowColor: [...config.visual.shallowColor] as [number, number, number],
      deepColor: [...config.visual.deepColor] as [number, number, number],
      foamColor: [...config.visual.foamColor] as [number, number, number],
      lakeBreeze: [...config.visual.lakeBreeze] as [number, number],
      foam: { ...config.visual.foam },
      fresnel: { ...config.visual.fresnel },
      color: { ...config.visual.color },
      refraction: { ...config.visual.refraction },
      reflection: { ...config.visual.reflection },
    },
    debug: { ...config.debug },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(readNumber(value, fallback)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readVec2(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  const a = readNumber(value[0], Number.NaN);
  const b = readNumber(value[1], Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...fallback];
  return [a, b];
}

function readVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  const a = readNumber(value[0], Number.NaN);
  const b = readNumber(value[1], Number.NaN);
  const c = readNumber(value[2], Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return [...fallback];
  return [a, b, c];
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length === 0) return [...fallback];
  const out: number[] = [];
  for (const entry of value) {
    const n = readNumber(entry, Number.NaN);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push(n);
  }
  return out.length > 0 ? out : [...fallback];
}

function readPointArray(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const out: Array<[number, number]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const a = readNumber(entry[0], Number.NaN);
    const b = readNumber(entry[1], Number.NaN);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  }
  return out.length >= 2 ? out : undefined;
}

function readSource(value: unknown, fallback: WaterConfig["source"]): WaterConfig["source"] {
  return value === "hydrology" || value === "fake_bodies" ? value : fallback;
}

function warnWater(message: string, warn?: (message: string) => void): void {
  warn?.(`[water-config] ${message}`);
}

interface WaterYamlConfig {
  water?: {
    enabled?: unknown;
    source?: unknown;
    cells_per_level?: unknown;
    cell_sizes?: unknown;
    snap_cells?: unknown;
    dry_sentinel_depth?: unknown;
    fake_bodies?: {
      carve_terrain?: unknown;
      lakes?: Array<{
        center?: unknown;
        center_norm?: unknown;
        radius?: unknown;
        level_offset?: unknown;
      }>;
      rivers?: Array<{
        points?: unknown;
        points_norm?: unknown;
        width?: unknown;
        level_offset?: unknown;
        downstream_drop?: unknown;
      }>;
    };
    hydrology?: {
      enabled?: unknown;
      sim_res?: unknown;
      dry_sentinel_depth?: unknown;
      fill?: {
        enabled?: unknown;
        iterations?: unknown;
        epsilon_per_cell?: unknown;
        lake_delta?: unknown;
        marsh_delta?: unknown;
      };
      accumulation?: {
        particles?: unknown;
        max_steps?: unknown;
        flat_gradient_stop?: unknown;
        inertia?: unknown;
        jitter_seed?: unknown;
      };
      rivers?: {
        river_threshold_add?: unknown;
        visible_water_threshold_add?: unknown;
        widen_radius?: unknown;
        carve_depth_m?: unknown;
        carve_power?: unknown;
        visible_depth_m?: unknown;
        visible_depth_power?: unknown;
        slope_gate_start?: unknown;
        slope_gate_end?: unknown;
        min_visible_depth?: unknown;
        lake_surface_drop_m?: unknown;
      };
      water_surface?: {
        wet_smooth_iterations?: unknown;
        wet_to_wet_cliff_slope_max?: unknown;
        far_reduce_factor?: unknown;
        far_level_min_cell_size?: unknown;
        dry_sentinel_depth?: unknown;
        far_lake_dominance?: unknown;
        far_river_dominance?: unknown;
        far_wet_threshold?: unknown;
      };
      moisture?: {
        enabled?: unknown;
        blur_radius?: unknown;
        lake_source?: unknown;
        river_source?: unknown;
        marsh_source?: unknown;
        dry_decay?: unknown;
      };
      talus?: {
        enabled?: unknown;
        iterations?: unknown;
        strength?: unknown;
      };
      debug?: {
        show_fill?: unknown;
        show_accumulation?: unknown;
        show_carved_bed?: unknown;
        show_water_y?: unknown;
        dump_fields?: unknown;
        dump_dir?: unknown;
      };
    };
    visual?: {
      shallow_color?: unknown;
      deep_color?: unknown;
      foam_color?: unknown;
      alpha?: unknown;
      ripple_cycle?: unknown;
      fresnel_power?: unknown;
      ripple_amp?: unknown;
      ripple_speed?: unknown;
      ripple_scale_a?: unknown;
      ripple_scale_b?: unknown;
      ripple_strength_a?: unknown;
      ripple_strength_b?: unknown;
      ripple_loop_distance?: unknown;
      lake_breeze?: unknown;
      shore_foam_start?: unknown;
      shore_foam_end?: unknown;
      max_depth_for_color?: unknown;
      foam?: {
        noise_scale?: unknown;
        shore_strength?: unknown;
        river_strength?: unknown;
        speed_start?: unknown;
        speed_end?: unknown;
        drop_start?: unknown;
        drop_end?: unknown;
      };
      fresnel?: {
        base?: unknown;
        power?: unknown;
        normal_flatten?: unknown;
      };
      color?: {
        depth_scale?: unknown;
        turbidity?: unknown;
      };
      refraction?: {
        enabled?: unknown;
        strength?: unknown;
        depth_validation_bias?: unknown;
        absorption_r?: unknown;
        absorption_g?: unknown;
        absorption_b?: unknown;
        turbidity_strength?: unknown;
        max_thickness?: unknown;
      };
      reflection?: {
        mode?: unknown;
        ssr_enabled?: unknown;
        max_steps?: unknown;
        step_scale?: unknown;
        edge_fade_start?: unknown;
        edge_fade_end?: unknown;
        sky_fallback_strength?: unknown;
        terrain_fallback_strength?: unknown;
      };
      depth_write?: unknown;
    };
    debug?: {
      mode?: unknown;
      clipmap_tint?: unknown;
      wireframe?: unknown;
    };
    caustics?: {
      enabled?: unknown;
      gain?: unknown;
      depth_fade?: unknown;
      focal_depth?: unknown;
      sun_gate_start?: unknown;
      sun_gate_end?: unknown;
      flow_advection?: unknown;
      scale?: unknown;
      speed?: unknown;
    };
  };
}

function isWaterDebugModeId(value: unknown): value is WaterDebugModeId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 14;
}

export function parseWaterConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): WaterConfig {
  const fallback = cloneWaterConfig();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: WaterYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as WaterYamlConfig;
  } catch (error) {
    warnWater(
      `failed to parse config/water.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`,
      warn ?? undefined,
    );
    return fallback;
  }

  const raw = rawConfig.water ?? {};
  const fb = DEFAULT_WATER_CONFIG;

  const rawLakes = raw.fake_bodies?.lakes;
  const lakes: LakeBodyConfig[] = [];
  for (const rawLake of rawLakes ?? []) {
    const center = readVec2(rawLake.center, rawLake.center_norm ? [0, 0] : fb.fakeBodies.lakes[0].center);
    const centerNorm = rawLake.center_norm ? readVec2(rawLake.center_norm, [0.5, 0.5]) : undefined;
    lakes.push({
      center,
      centerNorm,
      radius: readVec2(rawLake.radius, fb.fakeBodies.lakes[0].radius),
      levelOffset: readNumber(rawLake.level_offset, fb.fakeBodies.lakes[0].levelOffset),
    });
  }
  if (lakes.length === 0 && (rawLakes ?? []).length > 0) {
    warnWater("all lake entries invalid; using default lakes", warn ?? undefined);
  }
  // Explicit empty array means "no lakes"; missing key or all-invalid falls back to defaults.
  const fallbackLakes = lakes.length > 0 ? lakes
    : (rawLakes !== undefined && rawLakes.length === 0) ? []
    : fb.fakeBodies.lakes;

  const rawRivers = raw.fake_bodies?.rivers;
  const rivers: RiverBodyConfig[] = [];
  for (const [idx, rawRiver] of (rawRivers ?? []).entries()) {
    const points = readPointArray(rawRiver.points);
    const pointsNorm = readPointArray(rawRiver.points_norm);
    if (!points && !pointsNorm) {
      warnWater(`skipping river entry ${idx}: expected at least 2 valid points or points_norm entries`, warn ?? undefined);
      continue;
    }
    rivers.push({
      points: points ?? [],
      pointsNorm,
      width: readNumberAtLeast(rawRiver.width, fb.fakeBodies.rivers[0].width, 0.1),
      levelOffset: readNumber(rawRiver.level_offset, fb.fakeBodies.rivers[0].levelOffset),
      downstreamDrop: readNumber(rawRiver.downstream_drop, fb.fakeBodies.rivers[0].downstreamDrop),
    });
  }
  if (rivers.length === 0 && (rawRivers ?? []).length > 0) {
    warnWater("all river entries invalid; using no rivers", warn ?? undefined);
  }
  const fallbackRivers = rivers.length > 0 ? rivers
    : (rawRivers !== undefined && rawRivers.length === 0) ? []
    : (rawRivers !== undefined) ? []
    : fb.fakeBodies.rivers;

  const v = raw.visual ?? {};
  const foamRaw = v.foam ?? {};
  const fresnelRaw = v.fresnel ?? {};
  const colorRaw = v.color ?? {};
  const depthScale = readNumberAtLeast(colorRaw.depth_scale ?? v.max_depth_for_color, fb.visual.color.depthScale, 0.1);
  const visual: WaterVisualConfig = {
    shallowColor: readVec3(v.shallow_color, fb.visual.shallowColor),
    deepColor: readVec3(v.deep_color, fb.visual.deepColor),
    foamColor: readVec3(v.foam_color, fb.visual.foamColor),
    alpha: Math.min(1, Math.max(0, readNumber(v.alpha, fb.visual.alpha))),
    rippleCycle: readNumberAtLeast(v.ripple_cycle, fb.visual.rippleCycle, 0.0001),
    fresnelPower: readNumberAtLeast(v.fresnel_power ?? fresnelRaw.power, fb.visual.fresnelPower, 0.1),
    rippleAmp: readNumberAtLeast(v.ripple_amp, fb.visual.rippleAmp, 0),
    rippleSpeed: readNumberAtLeast(v.ripple_speed, fb.visual.rippleSpeed, 0),
    rippleScaleA: readNumberAtLeast(v.ripple_scale_a, fb.visual.rippleScaleA, 0.0001),
    rippleScaleB: readNumberAtLeast(v.ripple_scale_b, fb.visual.rippleScaleB, 0.0001),
    rippleStrengthA: readNumberAtLeast(v.ripple_strength_a, fb.visual.rippleStrengthA, 0),
    rippleStrengthB: readNumberAtLeast(v.ripple_strength_b, fb.visual.rippleStrengthB, 0),
    rippleLoopDistance: readNumberAtLeast(v.ripple_loop_distance, fb.visual.rippleLoopDistance, 0.001),
    lakeBreeze: readVec2(v.lake_breeze, fb.visual.lakeBreeze),
    shoreFoamStart: readNumber(v.shore_foam_start, fb.visual.shoreFoamStart),
    shoreFoamEnd: readNumber(v.shore_foam_end, fb.visual.shoreFoamEnd),
    maxDepthForColor: depthScale,
    foam: {
      noiseScale: readNumberAtLeast(foamRaw.noise_scale, fb.visual.foam.noiseScale, 0.0001),
      shoreStrength: Math.min(1, Math.max(0, readNumber(foamRaw.shore_strength, fb.visual.foam.shoreStrength))),
      riverStrength: Math.min(1, Math.max(0, readNumber(foamRaw.river_strength, fb.visual.foam.riverStrength))),
      speedStart: readNumberAtLeast(foamRaw.speed_start, fb.visual.foam.speedStart, 0),
      speedEnd: readNumberAtLeast(foamRaw.speed_end, fb.visual.foam.speedEnd, 0),
      dropStart: readNumberAtLeast(foamRaw.drop_start, fb.visual.foam.dropStart, 0),
      dropEnd: readNumberAtLeast(foamRaw.drop_end, fb.visual.foam.dropEnd, 0),
    },
    fresnel: {
      base: Math.min(1, Math.max(0, readNumber(fresnelRaw.base, fb.visual.fresnel.base))),
      power: readNumberAtLeast(fresnelRaw.power ?? v.fresnel_power, fb.visual.fresnel.power, 0.1),
      normalFlatten: Math.min(1, Math.max(0, readNumber(fresnelRaw.normal_flatten, fb.visual.fresnel.normalFlatten))),
    },
    color: {
      depthScale,
      turbidity: Math.min(1, Math.max(0, readNumber(colorRaw.turbidity, fb.visual.color.turbidity))),
    },
    refraction: {
      enabled: readBoolean(v.refraction?.enabled, fb.visual.refraction.enabled),
      strength: readNumberAtLeast(v.refraction?.strength, fb.visual.refraction.strength, 0),
      depthValidationBias: readNumberAtLeast(v.refraction?.depth_validation_bias, fb.visual.refraction.depthValidationBias, 0),
      absorptionR: readNumberAtLeast(v.refraction?.absorption_r, fb.visual.refraction.absorptionR, 0),
      absorptionG: readNumberAtLeast(v.refraction?.absorption_g, fb.visual.refraction.absorptionG, 0),
      absorptionB: readNumberAtLeast(v.refraction?.absorption_b, fb.visual.refraction.absorptionB, 0),
      turbidityStrength: readNumberAtLeast(v.refraction?.turbidity_strength, fb.visual.refraction.turbidityStrength, 0),
      maxThickness: readNumberAtLeast(v.refraction?.max_thickness, fb.visual.refraction.maxThickness, 0.1),
    },
    reflection: {
      mode: (v.reflection?.mode === "ssr" || v.reflection?.mode === "fake") ? v.reflection.mode : fb.visual.reflection.mode,
      ssrEnabled: readBoolean(v.reflection?.ssr_enabled, fb.visual.reflection.ssrEnabled),
      maxSteps: readIntegerAtLeast(v.reflection?.max_steps, fb.visual.reflection.maxSteps, 1),
      stepScale: readNumberAtLeast(v.reflection?.step_scale, fb.visual.reflection.stepScale, 0.001),
      edgeFadeStart: readNumberAtLeast(v.reflection?.edge_fade_start, fb.visual.reflection.edgeFadeStart, 0),
      edgeFadeEnd: readNumberAtLeast(v.reflection?.edge_fade_end, fb.visual.reflection.edgeFadeEnd, 0),
      skyFallbackStrength: readNumberAtLeast(v.reflection?.sky_fallback_strength, fb.visual.reflection.skyFallbackStrength, 0),
      terrainFallbackStrength: readNumberAtLeast(v.reflection?.terrain_fallback_strength, fb.visual.reflection.terrainFallbackStrength, 0),
    },
    depthWrite: readBoolean(v.depth_write, fb.visual.depthWrite),
  };
  if (visual.shoreFoamEnd < visual.shoreFoamStart) {
    visual.shoreFoamEnd = visual.shoreFoamStart;
  }
  if (visual.foam.speedEnd < visual.foam.speedStart) visual.foam.speedEnd = visual.foam.speedStart;
  if (visual.foam.dropEnd < visual.foam.dropStart) visual.foam.dropEnd = visual.foam.dropStart;

  const debugModeRaw = raw.debug?.mode;
  const debugMode: WaterDebugModeId = isWaterDebugModeId(debugModeRaw)
    ? debugModeRaw
    : fb.debug.mode;

  const cellSizes = readNumberArray(raw.cell_sizes, fb.cellSizes);
  const cellsPerLevel = readIntegerAtLeast(raw.cells_per_level, fb.cellsPerLevel, 4);
  const snapCells = readIntegerAtLeast(raw.snap_cells, fb.snapCells, 1);
  const drySentinelDepth = readNumberAtLeast(raw.dry_sentinel_depth, fb.drySentinelDepth, 0.1);
  const hydRaw = raw.hydrology ?? {};
  const hfb = DEFAULT_HYDROLOGY_CONFIG;
  const hydrology: HydrologyConfig = {
    enabled: readBoolean(hydRaw.enabled, hfb.enabled),
    simRes: readIntegerAtLeast(hydRaw.sim_res, hfb.simRes, 8),
    drySentinelDepth: readNumberAtLeast(hydRaw.dry_sentinel_depth, hfb.drySentinelDepth, 0.1),
    fill: {
      enabled: readBoolean(hydRaw.fill?.enabled, hfb.fill.enabled),
      iterations: readIntegerAtLeast(hydRaw.fill?.iterations, hfb.fill.iterations, 0),
      epsilonPerCell: readNumberAtLeast(hydRaw.fill?.epsilon_per_cell, hfb.fill.epsilonPerCell, 0),
      lakeDelta: readNumberAtLeast(hydRaw.fill?.lake_delta, hfb.fill.lakeDelta, 0.01),
      marshDelta: readNumberAtLeast(hydRaw.fill?.marsh_delta, hfb.fill.marshDelta, 0),
    },
    accumulation: {
      particles: readIntegerAtLeast(hydRaw.accumulation?.particles, hfb.accumulation.particles, 0),
      maxSteps: readIntegerAtLeast(hydRaw.accumulation?.max_steps, hfb.accumulation.maxSteps, 1),
      flatGradientStop: readNumberAtLeast(hydRaw.accumulation?.flat_gradient_stop, hfb.accumulation.flatGradientStop, 0),
      inertia: Math.min(0.98, Math.max(0, readNumber(hydRaw.accumulation?.inertia, hfb.accumulation.inertia))),
      jitterSeed: readIntegerAtLeast(hydRaw.accumulation?.jitter_seed, hfb.accumulation.jitterSeed, 0),
    },
    rivers: {
      riverThresholdAdd: readNumberAtLeast(hydRaw.rivers?.river_threshold_add, hfb.rivers.riverThresholdAdd, 0),
      visibleWaterThresholdAdd: readNumberAtLeast(hydRaw.rivers?.visible_water_threshold_add, hfb.rivers.visibleWaterThresholdAdd, 0),
      widenRadius: readIntegerAtLeast(hydRaw.rivers?.widen_radius, hfb.rivers.widenRadius, 0),
      carveDepthM: readNumberAtLeast(hydRaw.rivers?.carve_depth_m, hfb.rivers.carveDepthM, 0),
      carvePower: readNumberAtLeast(hydRaw.rivers?.carve_power, hfb.rivers.carvePower, 0.01),
      visibleDepthM: readNumberAtLeast(hydRaw.rivers?.visible_depth_m, hfb.rivers.visibleDepthM, 0),
      visibleDepthPower: readNumberAtLeast(hydRaw.rivers?.visible_depth_power, hfb.rivers.visibleDepthPower, 0.01),
      slopeGateStart: readNumberAtLeast(hydRaw.rivers?.slope_gate_start, hfb.rivers.slopeGateStart, 0),
      slopeGateEnd: readNumberAtLeast(hydRaw.rivers?.slope_gate_end, hfb.rivers.slopeGateEnd, 0),
      minVisibleDepth: readNumberAtLeast(hydRaw.rivers?.min_visible_depth, hfb.rivers.minVisibleDepth, 0),
      lakeSurfaceDropM: readNumberAtLeast(hydRaw.rivers?.lake_surface_drop_m, hfb.rivers.lakeSurfaceDropM, 0),
    },
    waterSurface: {
      wetSmoothIterations: readIntegerAtLeast(hydRaw.water_surface?.wet_smooth_iterations, hfb.waterSurface.wetSmoothIterations, 0),
      wetToWetCliffSlopeMax: readNumberAtLeast(hydRaw.water_surface?.wet_to_wet_cliff_slope_max, hfb.waterSurface.wetToWetCliffSlopeMax, 0.001),
      farReduceFactor: readIntegerAtLeast(hydRaw.water_surface?.far_reduce_factor, hfb.waterSurface.farReduceFactor, 1),
      farLevelMinCellSize: readNumberAtLeast(hydRaw.water_surface?.far_level_min_cell_size, hfb.waterSurface.farLevelMinCellSize, 0),
      drySentinelDepth: readNumberAtLeast(
        hydRaw.water_surface?.dry_sentinel_depth ?? hydRaw.dry_sentinel_depth,
        hfb.waterSurface.drySentinelDepth,
        0.1,
      ),
      farLakeDominance: Math.min(1, Math.max(0, readNumber(hydRaw.water_surface?.far_lake_dominance, hfb.waterSurface.farLakeDominance))),
      farRiverDominance: Math.min(1, Math.max(0, readNumber(hydRaw.water_surface?.far_river_dominance, hfb.waterSurface.farRiverDominance))),
      farWetThreshold: Math.min(1, Math.max(0, readNumber(hydRaw.water_surface?.far_wet_threshold, hfb.waterSurface.farWetThreshold))),
    },
    moisture: {
      enabled: readBoolean(hydRaw.moisture?.enabled, hfb.moisture.enabled),
      blurRadius: readIntegerAtLeast(hydRaw.moisture?.blur_radius, hfb.moisture.blurRadius, 0),
      lakeSource: Math.min(1, Math.max(0, readNumber(hydRaw.moisture?.lake_source, hfb.moisture.lakeSource))),
      riverSource: Math.min(1, Math.max(0, readNumber(hydRaw.moisture?.river_source, hfb.moisture.riverSource))),
      marshSource: Math.min(1, Math.max(0, readNumber(hydRaw.moisture?.marsh_source, hfb.moisture.marshSource))),
      dryDecay: Math.min(1, Math.max(0, readNumber(hydRaw.moisture?.dry_decay, hfb.moisture.dryDecay))),
    },
    talus: {
      enabled: readBoolean(hydRaw.talus?.enabled, hfb.talus.enabled),
      iterations: readIntegerAtLeast(hydRaw.talus?.iterations, hfb.talus.iterations, 0),
      strength: Math.max(0, readNumber(hydRaw.talus?.strength, hfb.talus.strength)),
    },
    debug: {
      showFill: readBoolean(hydRaw.debug?.show_fill, hfb.debug.showFill),
      showAccumulation: readBoolean(hydRaw.debug?.show_accumulation, hfb.debug.showAccumulation),
      showCarvedBed: readBoolean(hydRaw.debug?.show_carved_bed, hfb.debug.showCarvedBed),
      showWaterY: readBoolean(hydRaw.debug?.show_water_y, hfb.debug.showWaterY),
      dumpFields: readBoolean(hydRaw.debug?.dump_fields, hfb.debug.dumpFields),
      dumpDir: typeof hydRaw.debug?.dump_dir === "string" && hydRaw.debug.dump_dir.trim() !== ""
        ? hydRaw.debug.dump_dir
        : hfb.debug.dumpDir,
    },
  };
  if (hydrology.rivers.slopeGateEnd > hydrology.rivers.slopeGateStart) {
    hydrology.rivers.slopeGateEnd = hydrology.rivers.slopeGateStart;
  }

  return {
    enabled: readBoolean(raw.enabled, fb.enabled),
    source: readSource(raw.source, fb.source),
    cellsPerLevel,
    cellSizes,
    snapCells,
    drySentinelDepth,
    fakeBodies: {
      carveTerrain: readBoolean(raw.fake_bodies?.carve_terrain, fb.fakeBodies.carveTerrain),
      lakes: fallbackLakes,
      rivers: fallbackRivers,
    },
    hydrology,
    visual,
    caustics: {
      enabled: readBoolean(raw.caustics?.enabled, DEFAULT_CAUSTICS_CONFIG.enabled),
      gain: readNumberAtLeast(raw.caustics?.gain, DEFAULT_CAUSTICS_CONFIG.gain, 0),
      depthFade: readNumberAtLeast(raw.caustics?.depth_fade, DEFAULT_CAUSTICS_CONFIG.depthFade, 0),
      focalDepth: readNumberAtLeast(raw.caustics?.focal_depth, DEFAULT_CAUSTICS_CONFIG.focalDepth, 0),
      sunGateStart: readNumberAtLeast(raw.caustics?.sun_gate_start, DEFAULT_CAUSTICS_CONFIG.sunGateStart, 0),
      sunGateEnd: readNumberAtLeast(raw.caustics?.sun_gate_end, DEFAULT_CAUSTICS_CONFIG.sunGateEnd, 0),
      flowAdvection: readNumberAtLeast(raw.caustics?.flow_advection, DEFAULT_CAUSTICS_CONFIG.flowAdvection, 0),
      scale: readNumberAtLeast(raw.caustics?.scale, DEFAULT_CAUSTICS_CONFIG.scale, 0.001),
      speed: readNumberAtLeast(raw.caustics?.speed, DEFAULT_CAUSTICS_CONFIG.speed, 0),
    },
    debug: {
      mode: debugMode,
      clipmapTint: readBoolean(raw.debug?.clipmap_tint, fb.debug.clipmapTint),
      wireframe: readBoolean(raw.debug?.wireframe, fb.debug.wireframe),
    },
  };
}

/** Resolves normalized fake bodies to absolute coordinate space. */
export function resolveWaterConfig(config: WaterConfig, worldCells: number): WaterConfig {
  const resolved = cloneWaterConfig(config);
  for (const lake of resolved.fakeBodies.lakes) {
    if (lake.centerNorm) {
      lake.center = [lake.centerNorm[0] * worldCells, lake.centerNorm[1] * worldCells];
    }
  }
  for (const river of resolved.fakeBodies.rivers) {
    if (river.pointsNorm) {
      river.points = river.pointsNorm.map((p) => [p[0] * worldCells, p[1] * worldCells]);
    }
  }
  return resolved;
}
