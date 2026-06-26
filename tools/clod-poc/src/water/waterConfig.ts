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

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumberTuple(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1])];
  }
  return [...fallback] as [number, number];
}

function readColorTuple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1]), readNumber(value[2], fallback[2])];
  }
  return [...fallback] as [number, number, number];
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  if (Array.isArray(value)) {
    const numbers = value.map((entry, index) => readNumber(entry, fallback[index] ?? 0));
    return numbers.length > 0 ? numbers : [...fallback];
  }
  return [...fallback];
}

function readLakeBody(value: unknown, fallback: LakeBodyConfig): LakeBodyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const centerNorm = record.center_norm ?? record.centerNorm;
  return {
    center: readNumberTuple(record.center, fallback.center),
    centerNorm: centerNorm ? readNumberTuple(centerNorm, fallback.centerNorm ?? [0.5, 0.5]) : fallback.centerNorm,
    radius: readNumberTuple(record.radius, fallback.radius),
    levelOffset: readNumber(record.level_offset ?? record.levelOffset, fallback.levelOffset),
  };
}

function readRiverBody(value: unknown, fallback: RiverBodyConfig): RiverBodyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const pointsExplicit = Array.isArray(record.points);
  const points = pointsExplicit
    ? (record.points as unknown[]).map((point: unknown, index: number) => readNumberTuple(point, fallback.points[index] ?? [0, 0]))
    : fallback.points.map((point) => [...point] as [number, number]);
  const rawPointsNorm = record.points_norm ?? record.pointsNorm;
  const pointsNormExplicit = Array.isArray(rawPointsNorm);
  const pointsNorm = pointsNormExplicit
    ? rawPointsNorm.map((point, index) => readNumberTuple(point, fallback.pointsNorm?.[index] ?? [0, 0]))
    : pointsExplicit ? undefined : fallback.pointsNorm?.map((point) => [...point] as [number, number]);
  return {
    points,
    pointsNorm,
    width: readNumber(record.width, fallback.width),
    levelOffset: readNumber(record.level_offset ?? record.levelOffset, fallback.levelOffset),
    downstreamDrop: readNumber(record.downstream_drop ?? record.downstreamDrop, fallback.downstreamDrop),
  };
}

function readHydrologyConfig(value: unknown, fallback: HydrologyConfig = DEFAULT_HYDROLOGY_CONFIG): HydrologyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const fill = (record.fill ?? {}) as Record<string, unknown>;
  const accumulation = (record.accumulation ?? {}) as Record<string, unknown>;
  const rivers = (record.rivers ?? {}) as Record<string, unknown>;
  const waterSurface = (record.water_surface ?? record.waterSurface ?? {}) as Record<string, unknown>;
  const moisture = (record.moisture ?? {}) as Record<string, unknown>;
  const talus = (record.talus ?? {}) as Record<string, unknown>;
  const debug = (record.debug ?? {}) as Record<string, unknown>;

  return {
    enabled: readBoolean(record.enabled, fallback.enabled),
    simRes: readNumber(record.sim_res ?? record.simRes, fallback.simRes),
    drySentinelDepth: readNumber(record.dry_sentinel_depth ?? record.drySentinelDepth, fallback.drySentinelDepth),
    fill: {
      enabled: readBoolean(fill.enabled, fallback.fill.enabled),
      iterations: readNumber(fill.iterations, fallback.fill.iterations),
      epsilonPerCell: readNumber(fill.epsilon_per_cell ?? fill.epsilonPerCell, fallback.fill.epsilonPerCell),
      lakeDelta: readNumber(fill.lake_delta ?? fill.lakeDelta, fallback.fill.lakeDelta),
      marshDelta: readNumber(fill.marsh_delta ?? fill.marshDelta, fallback.fill.marshDelta),
    },
    accumulation: {
      particles: readNumber(accumulation.particles, fallback.accumulation.particles),
      maxSteps: readNumber(accumulation.max_steps ?? accumulation.maxSteps, fallback.accumulation.maxSteps),
      flatGradientStop: readNumber(accumulation.flat_gradient_stop ?? accumulation.flatGradientStop, fallback.accumulation.flatGradientStop),
      inertia: readNumber(accumulation.inertia, fallback.accumulation.inertia),
      jitterSeed: readNumber(accumulation.jitter_seed ?? accumulation.jitterSeed, fallback.accumulation.jitterSeed),
    },
    rivers: {
      riverThresholdAdd: readNumber(rivers.river_threshold_add ?? rivers.riverThresholdAdd, fallback.rivers.riverThresholdAdd),
      visibleWaterThresholdAdd: readNumber(rivers.visible_water_threshold_add ?? rivers.visibleWaterThresholdAdd, fallback.rivers.visibleWaterThresholdAdd),
      widenRadius: readNumber(rivers.widen_radius ?? rivers.widenRadius, fallback.rivers.widenRadius),
      carveDepthM: readNumber(rivers.carve_depth_m ?? rivers.carveDepthM, fallback.rivers.carveDepthM),
      carvePower: readNumber(rivers.carve_power ?? rivers.carvePower, fallback.rivers.carvePower),
      visibleDepthM: readNumber(rivers.visible_depth_m ?? rivers.visibleDepthM, fallback.rivers.visibleDepthM),
      visibleDepthPower: readNumber(rivers.visible_depth_power ?? rivers.visibleDepthPower, fallback.rivers.visibleDepthPower),
      slopeGateStart: readNumber(rivers.slope_gate_start ?? rivers.slopeGateStart, fallback.rivers.slopeGateStart),
      slopeGateEnd: readNumber(rivers.slope_gate_end ?? rivers.slopeGateEnd, fallback.rivers.slopeGateEnd),
      minVisibleDepth: readNumber(rivers.min_visible_depth ?? rivers.minVisibleDepth, fallback.rivers.minVisibleDepth),
      guaranteeFallbackRivers: readBoolean(rivers.guarantee_fallback_rivers ?? rivers.guaranteeFallbackRivers, fallback.rivers.guaranteeFallbackRivers),
      fallbackMainRiver: readBoolean(rivers.fallback_main_river ?? rivers.fallbackMainRiver, fallback.rivers.fallbackMainRiver),
      fallbackTributaries: readBoolean(rivers.fallback_tributaries ?? rivers.fallbackTributaries, fallback.rivers.fallbackTributaries),
      flowSpeedMultiplier: readNumber(rivers.flow_speed_multiplier ?? rivers.flowSpeedMultiplier, fallback.rivers.flowSpeedMultiplier),
      lakeSurfaceDropM: readNumber(rivers.lake_surface_drop_m ?? rivers.lakeSurfaceDropM, fallback.rivers.lakeSurfaceDropM),
    },
    waterSurface: {
      farReduceFactor: readNumber(waterSurface.far_reduce_factor ?? waterSurface.farReduceFactor, fallback.waterSurface.farReduceFactor),
      farLevelMinCellSize: readNumber(waterSurface.far_level_min_cell_size ?? waterSurface.farLevelMinCellSize, fallback.waterSurface.farLevelMinCellSize),
      drySentinelDepth: readNumber(waterSurface.dry_sentinel_depth ?? waterSurface.drySentinelDepth, fallback.waterSurface.drySentinelDepth),
      wetSmoothIterations: readNumber(waterSurface.wet_smooth_iterations ?? waterSurface.wetSmoothIterations, fallback.waterSurface.wetSmoothIterations),
      wetToWetCliffSlopeMax: readNumber(waterSurface.wet_to_wet_cliff_slope_max ?? waterSurface.wetToWetCliffSlopeMax, fallback.waterSurface.wetToWetCliffSlopeMax),
      farLakeDominance: readNumber(waterSurface.far_lake_dominance ?? waterSurface.farLakeDominance, fallback.waterSurface.farLakeDominance),
      farRiverDominance: readNumber(waterSurface.far_river_dominance ?? waterSurface.farRiverDominance, fallback.waterSurface.farRiverDominance),
      farWetThreshold: readNumber(waterSurface.far_wet_threshold ?? waterSurface.farWetThreshold, fallback.waterSurface.farWetThreshold),
    },
    moisture: {
      enabled: readBoolean(moisture.enabled, fallback.moisture.enabled),
      blurRadius: readNumber(moisture.blur_radius ?? moisture.blurRadius, fallback.moisture.blurRadius),
      lakeSource: readNumber(moisture.lake_source ?? moisture.lakeSource, fallback.moisture.lakeSource),
      riverSource: readNumber(moisture.river_source ?? moisture.riverSource, fallback.moisture.riverSource),
      marshSource: readNumber(moisture.marsh_source ?? moisture.marshSource, fallback.moisture.marshSource),
      dryDecay: readNumber(moisture.dry_decay ?? moisture.dryDecay, fallback.moisture.dryDecay),
    },
    talus: {
      enabled: readBoolean(talus.enabled, fallback.talus.enabled),
      iterations: readNumber(talus.iterations, fallback.talus.iterations),
      strength: readNumber(talus.strength, fallback.talus.strength),
    },
    debug: {
      showFill: readBoolean(debug.show_fill ?? debug.showFill, fallback.debug.showFill),
      showAccumulation: readBoolean(debug.show_accumulation ?? debug.showAccumulation, fallback.debug.showAccumulation),
      showCarvedBed: readBoolean(debug.show_carved_bed ?? debug.showCarvedBed, fallback.debug.showCarvedBed),
      showWaterY: readBoolean(debug.show_water_y ?? debug.showWaterY, fallback.debug.showWaterY),
      dumpFields: readBoolean(debug.dump_fields ?? debug.dumpFields, fallback.debug.dumpFields),
      dumpDir: typeof debug.dump_dir === "string" ? debug.dump_dir : typeof debug.dumpDir === "string" ? debug.dumpDir : fallback.debug.dumpDir,
    },
  };
}

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

function isWaterDebugModeId(value: unknown): value is WaterDebugModeId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 14;
}

function warnWater(message: string, warn?: ((message: string) => void) | null): void {
  warn?.(`[water-config] ${message}`);
}

function riverHasValidPoints(river: RiverBodyConfig): boolean {
  if (river.points.length >= 2) return true;
  return (river.pointsNorm?.length ?? 0) >= 2;
}

function runtimeSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function queryBool(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

function queryNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyRuntimeRiverOverrides(config: WaterConfig): WaterConfig {
  const params = runtimeSearchParams();
  if (!params) return config;
  const next = cloneWaterConfig(config);
  const source = params.get("waterSource");
  if (source === "hydrology" || source === "fake_bodies") next.source = source;
  next.hydrology.rivers.guaranteeFallbackRivers = queryBool(params, "riversFallback", next.hydrology.rivers.guaranteeFallbackRivers);
  next.hydrology.rivers.fallbackMainRiver = queryBool(params, "riverMain", next.hydrology.rivers.fallbackMainRiver);
  next.hydrology.rivers.fallbackTributaries = queryBool(params, "riverTributaries", next.hydrology.rivers.fallbackTributaries);
  next.hydrology.rivers.widenRadius = queryNumber(params, "riverWidth", next.hydrology.rivers.widenRadius);
  next.hydrology.rivers.visibleDepthM = queryNumber(params, "riverVisibleDepth", next.hydrology.rivers.visibleDepthM);
  next.hydrology.rivers.carveDepthM = queryNumber(params, "riverCarveDepth", next.hydrology.rivers.carveDepthM);
  next.hydrology.rivers.flowSpeedMultiplier = queryNumber(params, "riverFlowSpeed", next.hydrology.rivers.flowSpeedMultiplier);
  next.visual.foam.riverStrength = queryNumber(params, "riverFoamStrength", next.visual.foam.riverStrength);
  for (const river of next.fakeBodies.rivers) {
    river.width = Math.max(0.1, river.width * Math.max(0.1, next.hydrology.rivers.widenRadius / DEFAULT_HYDROLOGY_CONFIG.rivers.widenRadius));
  }
  return next;
}

export function parseWaterConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): WaterConfig {
  const fallback = applyRuntimeRiverOverrides(cloneWaterConfig());
  if (!text || text.trim() === "") return fallback;

  let config: WaterConfig;
  try {
    config = applyRuntimeRiverOverrides(parseWaterConfigYaml(text));
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
