import { DEFAULT_HYDROLOGY_CONFIG, type HydrologyConfig } from "./hydrologyConfig.js";
import { readBoolean, readNumber } from "./water_config_readers.js";

export function readHydrologyConfig(value: unknown, fallback: HydrologyConfig = DEFAULT_HYDROLOGY_CONFIG): HydrologyConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const fill = (record.fill ?? {}) as Record<string, unknown>;
  const accumulation = (record.accumulation ?? {}) as Record<string, unknown>;
  const rivers = (record.rivers ?? {}) as Record<string, unknown>;
  const waterSurface = (record.water_surface ?? record.waterSurface ?? {}) as Record<string, unknown>;
  const moisture = (record.moisture ?? {}) as Record<string, unknown>;
  const talus = (record.talus ?? {}) as Record<string, unknown>;
  const infinite = (record.infinite ?? {}) as Record<string, unknown>;
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
    infinite: {
      tileSizeM: Math.max(16, readNumber(infinite.tile_size_m ?? infinite.tileSizeM, fallback.infinite.tileSizeM)),
      tileRes: Math.max(4, Math.floor(readNumber(infinite.tile_res ?? infinite.tileRes, fallback.infinite.tileRes))),
      maxResidentTiles: Math.max(0, Math.floor(readNumber(infinite.max_resident_tiles ?? infinite.maxResidentTiles, fallback.infinite.maxResidentTiles))),
      unifiedStartup: readBoolean(infinite.unified_startup ?? infinite.unifiedStartup, fallback.infinite.unifiedStartup),
      boundaryBlendM: Math.max(0, readNumber(infinite.boundary_blend_m ?? infinite.boundaryBlendM, fallback.infinite.boundaryBlendM)),
      atlasTilesPerSide: Math.max(0, Math.floor(readNumber(infinite.atlas_tiles_per_side ?? infinite.atlasTilesPerSide, fallback.infinite.atlasTilesPerSide))),
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
