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
import { readLakeBody, readRiverBody } from "./water_config_fake_bodies.js";
import { isWaterDebugModeId, riverHasValidPoints } from "./water_config_guards.js";
import { readHydrologyConfig } from "./water_config_hydrology_parsing.js";
import {
  readBoolean,
  readColorTuple,
  readNumber,
  readNumberArray,
  readNumberTuple,
} from "./water_config_readers.js";
import { applyRuntimeRiverOverrides } from "./water_config_runtime_overrides.js";

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
  shallowColor: [0.00, 0.32, 0.55],
  deepColor: [0.00, 0.025, 0.12],
  foamColor: [0.90, 0.95, 0.96],
  alpha: 0.90,
  rippleCycle: 0.07,
  fresnelPower: 5.0,
  rippleAmp: 1.25,
  rippleSpeed: 0.52,
  rippleScaleA: 0.16,
  rippleScaleB: 0.105,
  rippleStrengthA: 0.24,
  rippleStrengthB: 0.16,
  rippleLoopDistance: 22.0,
  lakeBreeze: [0.20, 0.07],
  shoreFoamStart: 0.03,
  shoreFoamEnd: 0.16,
  maxDepthForColor: 5.0,
  foam: {
    noiseScale: 0.075,
    shoreStrength: 0.52,
    riverStrength: 0.38,
    speedStart: 0.25,
    speedEnd: 1.0,
    dropStart: 0.5,
    dropEnd: 2.0,
  },
  fresnel: {
    base: 0.045,
    power: 4.2,
    normalFlatten: 0.55,
  },
  color: {
    depthScale: 5.0,
    turbidity: 0.10,
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
    skyFallbackStrength: 0.78,
    terrainFallbackStrength: 0.12,
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
        points: river.points.map((point) => [...point] as [number, number]),
        pointsNorm: river.pointsNorm?.map((point) => [...point] as [number, number]),
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

const WATER_RUNTIME_OVERRIDE_OPTIONS = {
  clone: cloneWaterConfig,
  defaultHydrology: DEFAULT_HYDROLOGY_CONFIG,
};

export function parseWaterConfigYaml(source: string): WaterConfig {
  const parsed = load(source) as Record<string, unknown> | undefined;
  const waterRecord = (parsed?.water ?? {}) as Record<string, unknown>;
  const visual = (waterRecord.visual ?? {}) as Record<string, unknown>;
  const foam = (visual.foam ?? {}) as Record<string, unknown>;
  const fresnel = (visual.fresnel ?? {}) as Record<string, unknown>;
  const color = (visual.color ?? {}) as Record<string, unknown>;
  const refraction = (visual.refraction ?? {}) as Record<string, unknown>;
  const reflection = (visual.reflection ?? {}) as Record<string, unknown>;
  const fakeBodies = (waterRecord.fake_bodies ?? waterRecord.fakeBodies ?? {}) as Record<string, unknown>;
  const defaultFakeBodies = DEFAULT_WATER_CONFIG.fakeBodies;
  const hydrology = readHydrologyConfig(waterRecord.hydrology, DEFAULT_WATER_CONFIG.hydrology);
  const caustics = (waterRecord.caustics ?? {}) as Record<string, unknown>;
  const causticsDefaults = DEFAULT_CAUSTICS_CONFIG;

  const defaultLakes = defaultFakeBodies.lakes;
  const defaultRivers = defaultFakeBodies.rivers;
  const lakes = Array.isArray(fakeBodies.lakes)
    ? fakeBodies.lakes.map((lake, index) => readLakeBody(lake, defaultLakes[index] ?? defaultLakes[0]))
    : defaultLakes.map((lake) => readLakeBody(lake, lake));
  const rivers = Array.isArray(fakeBodies.rivers)
    ? fakeBodies.rivers.map((river, index) => readRiverBody(river, defaultRivers[index] ?? defaultRivers[0]))
    : defaultRivers.map((river) => readRiverBody(river, river));

  const defaults = DEFAULT_WATER_VISUAL;
  return {
    enabled: readBoolean(waterRecord.enabled, DEFAULT_WATER_CONFIG.enabled),
    source: waterRecord.source === "fake_bodies" ? "fake_bodies" : "hydrology",
    cellsPerLevel: readNumber(waterRecord.cells_per_level ?? waterRecord.cellsPerLevel, DEFAULT_WATER_CONFIG.cellsPerLevel),
    cellSizes: readNumberArray(waterRecord.cell_sizes ?? waterRecord.cellSizes, DEFAULT_WATER_CONFIG.cellSizes),
    snapCells: readNumber(waterRecord.snap_cells ?? waterRecord.snapCells, DEFAULT_WATER_CONFIG.snapCells),
    drySentinelDepth: readNumber(waterRecord.dry_sentinel_depth ?? waterRecord.drySentinelDepth, DEFAULT_WATER_CONFIG.drySentinelDepth),
    fakeBodies: {
      carveTerrain: readBoolean(fakeBodies.carve_terrain ?? fakeBodies.carveTerrain, defaultFakeBodies.carveTerrain),
      lakes,
      rivers,
    },
    hydrology,
    visual: {
      shallowColor: readColorTuple(visual.shallow_color ?? visual.shallowColor, defaults.shallowColor),
      deepColor: readColorTuple(visual.deep_color ?? visual.deepColor, defaults.deepColor),
      foamColor: readColorTuple(visual.foam_color ?? visual.foamColor, defaults.foamColor),
      alpha: readNumber(visual.alpha, defaults.alpha),
      rippleCycle: readNumber(visual.ripple_cycle ?? visual.rippleCycle, defaults.rippleCycle),
      fresnelPower: readNumber(visual.fresnel_power ?? visual.fresnelPower, defaults.fresnelPower),
      rippleAmp: readNumber(visual.ripple_amp ?? visual.rippleAmp, defaults.rippleAmp),
      rippleSpeed: readNumber(visual.ripple_speed ?? visual.rippleSpeed, defaults.rippleSpeed),
      rippleScaleA: readNumber(visual.ripple_scale_a ?? visual.rippleScaleA, defaults.rippleScaleA),
      rippleScaleB: readNumber(visual.ripple_scale_b ?? visual.rippleScaleB, defaults.rippleScaleB),
      rippleStrengthA: readNumber(visual.ripple_strength_a ?? visual.rippleStrengthA, defaults.rippleStrengthA),
      rippleStrengthB: readNumber(visual.ripple_strength_b ?? visual.rippleStrengthB, defaults.rippleStrengthB),
      rippleLoopDistance: readNumber(visual.ripple_loop_distance ?? visual.rippleLoopDistance, defaults.rippleLoopDistance),
      lakeBreeze: readNumberTuple(visual.lake_breeze ?? visual.lakeBreeze, defaults.lakeBreeze),
      shoreFoamStart: readNumber(visual.shore_foam_start ?? visual.shoreFoamStart, defaults.shoreFoamStart),
      shoreFoamEnd: readNumber(visual.shore_foam_end ?? visual.shoreFoamEnd, defaults.shoreFoamEnd),
      maxDepthForColor: readNumber(visual.max_depth_for_color ?? visual.maxDepthForColor, defaults.maxDepthForColor),
      foam: {
        noiseScale: readNumber(foam.noise_scale ?? foam.noiseScale, defaults.foam.noiseScale),
        shoreStrength: readNumber(foam.shore_strength ?? foam.shoreStrength, defaults.foam.shoreStrength),
        riverStrength: readNumber(foam.river_strength ?? foam.riverStrength, defaults.foam.riverStrength),
        speedStart: readNumber(foam.speed_start ?? foam.speedStart, defaults.foam.speedStart),
        speedEnd: readNumber(foam.speed_end ?? foam.speedEnd, defaults.foam.speedEnd),
        dropStart: readNumber(foam.drop_start ?? foam.dropStart, defaults.foam.dropStart),
        dropEnd: readNumber(foam.drop_end ?? foam.dropEnd, defaults.foam.dropEnd),
      },
      fresnel: {
        base: readNumber(fresnel.base, defaults.fresnel.base),
        power: readNumber(fresnel.power, defaults.fresnel.power),
        normalFlatten: readNumber(fresnel.normal_flatten ?? fresnel.normalFlatten, defaults.fresnel.normalFlatten),
      },
      color: {
        depthScale: readNumber(color.depth_scale ?? color.depthScale, defaults.color.depthScale),
        turbidity: readNumber(color.turbidity, defaults.color.turbidity),
      },
      refraction: {
        enabled: readBoolean(refraction.enabled, defaults.refraction.enabled),
        strength: readNumber(refraction.strength, defaults.refraction.strength),
        depthValidationBias: readNumber(refraction.depth_validation_bias ?? refraction.depthValidationBias, defaults.refraction.depthValidationBias),
        absorptionR: readNumber(refraction.absorption_r ?? refraction.absorptionR, defaults.refraction.absorptionR),
        absorptionG: readNumber(refraction.absorption_g ?? refraction.absorptionG, defaults.refraction.absorptionG),
        absorptionB: readNumber(refraction.absorption_b ?? refraction.absorptionB, defaults.refraction.absorptionB),
        turbidityStrength: readNumber(refraction.turbidity_strength ?? refraction.turbidityStrength, defaults.refraction.turbidityStrength),
        maxThickness: readNumber(refraction.max_thickness ?? refraction.maxThickness, defaults.refraction.maxThickness),
      },
      reflection: {
        mode: reflection.mode === "ssr" ? "ssr" : "fake",
        ssrEnabled: readBoolean(reflection.ssr_enabled ?? reflection.ssrEnabled, defaults.reflection.ssrEnabled),
        maxSteps: readNumber(reflection.max_steps ?? reflection.maxSteps, defaults.reflection.maxSteps),
        stepScale: readNumber(reflection.step_scale ?? reflection.stepScale, defaults.reflection.stepScale),
        edgeFadeStart: readNumber(reflection.edge_fade_start ?? reflection.edgeFadeStart, defaults.reflection.edgeFadeStart),
        edgeFadeEnd: readNumber(reflection.edge_fade_end ?? reflection.edgeFadeEnd, defaults.reflection.edgeFadeEnd),
        skyFallbackStrength: readNumber(reflection.sky_fallback_strength ?? reflection.skyFallbackStrength, defaults.reflection.skyFallbackStrength),
        terrainFallbackStrength: readNumber(reflection.terrain_fallback_strength ?? reflection.terrainFallbackStrength, defaults.reflection.terrainFallbackStrength),
      },
      depthWrite: readBoolean(visual.depth_write ?? visual.depthWrite, defaults.depthWrite),
    },
    caustics: {
      enabled: readBoolean(caustics.enabled, causticsDefaults.enabled),
      gain: readNumber(caustics.gain, causticsDefaults.gain),
      depthFade: readNumber(caustics.depth_fade ?? caustics.depthFade, causticsDefaults.depthFade),
      focalDepth: readNumber(caustics.focal_depth ?? caustics.focalDepth, causticsDefaults.focalDepth),
      sunGateStart: readNumber(caustics.sun_gate_start ?? caustics.sunGateStart, causticsDefaults.sunGateStart),
      sunGateEnd: readNumber(caustics.sun_gate_end ?? caustics.sunGateEnd, causticsDefaults.sunGateEnd),
      flowAdvection: readNumber(caustics.flow_advection ?? caustics.flowAdvection, causticsDefaults.flowAdvection),
      scale: readNumber(caustics.scale, causticsDefaults.scale),
      speed: readNumber(caustics.speed, causticsDefaults.speed),
    },
    debug: {
      mode: readNumber((waterRecord.debug as Record<string, unknown> | undefined)?.mode, DEFAULT_WATER_CONFIG.debug.mode) as WaterDebugModeId,
      clipmapTint: readBoolean((waterRecord.debug as Record<string, unknown> | undefined)?.clipmap_tint, DEFAULT_WATER_CONFIG.debug.clipmapTint),
      wireframe: readBoolean((waterRecord.debug as Record<string, unknown> | undefined)?.wireframe, DEFAULT_WATER_CONFIG.debug.wireframe),
    },
  };
}

function warnWater(message: string, warn?: ((message: string) => void) | null): void {
  warn?.(`[water-config] ${message}`);
}

export function parseWaterConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): WaterConfig {
  const fallback = applyRuntimeRiverOverrides(cloneWaterConfig(), WATER_RUNTIME_OVERRIDE_OPTIONS);
  if (!text || text.trim() === "") return fallback;

  let config: WaterConfig;
  try {
    config = applyRuntimeRiverOverrides(parseWaterConfigYaml(text), WATER_RUNTIME_OVERRIDE_OPTIONS);
  } catch (error) {
    warnWater(
      `failed to parse config/water.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`,
      warn ?? undefined,
    );
    return fallback;
  }

  const debugMode = isWaterDebugModeId(config.debug.mode)
    ? config.debug.mode
    : DEFAULT_WATER_CONFIG.debug.mode;

  const rivers: RiverBodyConfig[] = [];
  for (const [idx, river] of config.fakeBodies.rivers.entries()) {
    if (!riverHasValidPoints(river)) {
      warnWater(
        `skipping river entry ${idx}: expected at least 2 valid points or points_norm entries`,
        warn ?? undefined,
      );
      continue;
    }
    rivers.push(river);
  }

  if (debugMode === config.debug.mode && rivers.length === config.fakeBodies.rivers.length) {
    return config;
  }

  return {
    ...config,
    debug: { ...config.debug, mode: debugMode },
    fakeBodies: { ...config.fakeBodies, rivers },
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
      river.points = river.pointsNorm.map((point) => [point[0] * worldCells, point[1] * worldCells]);
    }
  }
  return resolved;
}
