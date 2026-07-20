import type { CausticsConfig } from "./causticsConfig.js";
import type { WaterVisualConfig } from "./water_config_types.js";
import {
  deriveDefaultWaterBodyPresets,
  type WaterBodyVisualPreset,
  type WaterBodyVisualPresets,
} from "./water_body_presets.js";
import {
  readBoolean,
  readColorTuple,
  readNumber,
  readNumberTuple,
  recordFrom,
} from "./water_config_readers.js";
import { parseWaterNormalModel } from "./water_normal_models.js";

function readBodyPreset(value: unknown, defaults: WaterBodyVisualPreset): WaterBodyVisualPreset {
  const body = recordFrom(value);
  return {
    shallowColor: readColorTuple(body.shallow_color ?? body.shallowColor, defaults.shallowColor),
    deepColor: readColorTuple(body.deep_color ?? body.deepColor, defaults.deepColor),
    absorption: readColorTuple(body.absorption, defaults.absorption),
    turbidity: readNumber(body.turbidity, defaults.turbidity),
    reflectionDamping: readNumber(body.reflection_damping ?? body.reflectionDamping, defaults.reflectionDamping),
    scatterColor: readColorTuple(body.scatter_color ?? body.scatterColor, defaults.scatterColor),
    scatterExtinction: readNumber(
      body.scatter_extinction ?? body.scatterExtinction,
      defaults.scatterExtinction,
    ),
    scatterStrength: readNumber(body.scatter_strength ?? body.scatterStrength, defaults.scatterStrength),
    scatterAmbient: readNumber(body.scatter_ambient ?? body.scatterAmbient, defaults.scatterAmbient),
  };
}

function readBodyPresets(value: unknown, defaults: WaterBodyVisualPresets): WaterBodyVisualPresets {
  const bodies = recordFrom(value);
  return {
    ocean: readBodyPreset(bodies.ocean, defaults.ocean),
    lake: readBodyPreset(bodies.lake, defaults.lake),
    river: readBodyPreset(bodies.river, defaults.river),
    pond: readBodyPreset(bodies.pond, defaults.pond),
    marsh: readBodyPreset(bodies.marsh, defaults.marsh),
  };
}

export function readWaterVisualConfig(value: unknown, defaults: WaterVisualConfig): WaterVisualConfig {
  const visual = recordFrom(value);
  const foam = recordFrom(visual.foam);
  const fresnel = recordFrom(visual.fresnel);
  const color = recordFrom(visual.color);
  const glacialMurkiness = recordFrom(visual.glacial_murkiness ?? visual.glacialMurkiness);
  const rockFlour = recordFrom(visual.rock_flour ?? visual.rockFlour);
  const glitter = recordFrom(visual.glitter);
  const refraction = recordFrom(visual.refraction);
  const reflection = recordFrom(visual.reflection);
  const reflectionClipmapTiers = recordFrom(reflection.clipmap_tiers ?? reflection.clipmapTiers);
  const parsedBase = {
    shallowColor: readColorTuple(visual.shallow_color ?? visual.shallowColor, defaults.shallowColor),
    deepColor: readColorTuple(visual.deep_color ?? visual.deepColor, defaults.deepColor),
    depthScale: readNumber(color.depth_scale ?? color.depthScale, defaults.color.depthScale),
    turbidity: readNumber(color.turbidity, defaults.color.turbidity),
  };

  return {
    shallowColor: parsedBase.shallowColor,
    deepColor: parsedBase.deepColor,
    foamColor: readColorTuple(visual.foam_color ?? visual.foamColor, defaults.foamColor),
    alpha: readNumber(visual.alpha, defaults.alpha),
    normalModel: parseWaterNormalModel(visual.normal_model ?? visual.normalModel, defaults.normalModel),
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
      shoreDistanceStart: readNumber(foam.shore_distance_start ?? foam.shoreDistanceStart, defaults.foam.shoreDistanceStart),
      shoreDistanceEnd: readNumber(foam.shore_distance_end ?? foam.shoreDistanceEnd, defaults.foam.shoreDistanceEnd),
      detailFadeStartM: readNumber(foam.detail_fade_start_m ?? foam.detailFadeStartM, defaults.foam.detailFadeStartM),
      detailFadeEndM: readNumber(foam.detail_fade_end_m ?? foam.detailFadeEndM, defaults.foam.detailFadeEndM),
    },
    fresnel: {
      base: readNumber(fresnel.base, defaults.fresnel.base),
      power: readNumber(fresnel.power, defaults.fresnel.power),
      normalFlatten: readNumber(fresnel.normal_flatten ?? fresnel.normalFlatten, defaults.fresnel.normalFlatten),
    },
    color: {
      depthScale: parsedBase.depthScale,
      turbidity: parsedBase.turbidity,
    },
    bodies: readBodyPresets(visual.bodies, deriveDefaultWaterBodyPresets(parsedBase)),
    glacialMurkiness: {
      enabled: readBoolean(glacialMurkiness.enabled, defaults.glacialMurkiness.enabled),
      lakeStrength: readNumber(glacialMurkiness.lake_strength ?? glacialMurkiness.lakeStrength, defaults.glacialMurkiness.lakeStrength),
      riverStrength: readNumber(glacialMurkiness.river_strength ?? glacialMurkiness.riverStrength, defaults.glacialMurkiness.riverStrength),
      absorptionMultiplier: readColorTuple(
        glacialMurkiness.absorption_multiplier ?? glacialMurkiness.absorptionMultiplier,
        defaults.glacialMurkiness.absorptionMultiplier,
      ),
      turbidityAdd: readNumber(glacialMurkiness.turbidity_add ?? glacialMurkiness.turbidityAdd, defaults.glacialMurkiness.turbidityAdd),
      reflectionDampingMin: readNumber(
        glacialMurkiness.reflection_damping_min ?? glacialMurkiness.reflectionDampingMin,
        defaults.glacialMurkiness.reflectionDampingMin,
      ),
    },
    rockFlour: {
      enabled: readBoolean(rockFlour.enabled, defaults.rockFlour.enabled),
      lakeStrength: readNumber(rockFlour.lake_strength ?? rockFlour.lakeStrength, defaults.rockFlour.lakeStrength),
      riverStrength: readNumber(rockFlour.river_strength ?? rockFlour.riverStrength, defaults.rockFlour.riverStrength),
      lakeColor: readColorTuple(rockFlour.lake_color ?? rockFlour.lakeColor, defaults.rockFlour.lakeColor),
      riverColor: readColorTuple(rockFlour.river_color ?? rockFlour.riverColor, defaults.rockFlour.riverColor),
      shallowBlend: readNumber(rockFlour.shallow_blend ?? rockFlour.shallowBlend, defaults.rockFlour.shallowBlend),
      deepBlend: readNumber(rockFlour.deep_blend ?? rockFlour.deepBlend, defaults.rockFlour.deepBlend),
      scatterExtinction: readNumber(
        rockFlour.scatter_extinction ?? rockFlour.scatterExtinction,
        defaults.rockFlour.scatterExtinction,
      ),
      scatterStrength: readNumber(rockFlour.scatter_strength ?? rockFlour.scatterStrength, defaults.rockFlour.scatterStrength),
      scatterAmbient: readNumber(rockFlour.scatter_ambient ?? rockFlour.scatterAmbient, defaults.rockFlour.scatterAmbient),
    },
    glitter: {
      enabled: readBoolean(glitter.enabled, defaults.glitter.enabled),
      tightExponent: readNumber(glitter.tight_exponent ?? glitter.tightExponent, defaults.glitter.tightExponent),
      tightGain: readNumber(glitter.tight_gain ?? glitter.tightGain, defaults.glitter.tightGain),
      broadExponent: readNumber(glitter.broad_exponent ?? glitter.broadExponent, defaults.glitter.broadExponent),
      broadGain: readNumber(glitter.broad_gain ?? glitter.broadGain, defaults.glitter.broadGain),
      lowSunGain: readNumber(glitter.low_sun_gain ?? glitter.lowSunGain, defaults.glitter.lowSunGain),
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
      clipmapTiers: {
        enabled: readBoolean(reflectionClipmapTiers.enabled, defaults.reflection.clipmapTiers.enabled),
        fullQualityMaxCellSizeM: readNumber(
          reflectionClipmapTiers.full_quality_max_cell_size_m ?? reflectionClipmapTiers.fullQualityMaxCellSizeM,
          defaults.reflection.clipmapTiers.fullQualityMaxCellSizeM,
        ),
        midQualityMaxCellSizeM: readNumber(
          reflectionClipmapTiers.mid_quality_max_cell_size_m ?? reflectionClipmapTiers.midQualityMaxCellSizeM,
          defaults.reflection.clipmapTiers.midQualityMaxCellSizeM,
        ),
        midMaxSteps: readNumber(reflectionClipmapTiers.mid_max_steps ?? reflectionClipmapTiers.midMaxSteps, defaults.reflection.clipmapTiers.midMaxSteps),
      },
    },
    depthWrite: readBoolean(visual.depth_write ?? visual.depthWrite, defaults.depthWrite),
  };
}

export function readWaterCausticsConfig(value: unknown, defaults: CausticsConfig): CausticsConfig {
  const caustics = recordFrom(value);
  return {
    enabled: readBoolean(caustics.enabled, defaults.enabled),
    gain: readNumber(caustics.gain, defaults.gain),
    depthFade: readNumber(caustics.depth_fade ?? caustics.depthFade, defaults.depthFade),
    focalDepth: readNumber(caustics.focal_depth ?? caustics.focalDepth, defaults.focalDepth),
    sunGateStart: readNumber(caustics.sun_gate_start ?? caustics.sunGateStart, defaults.sunGateStart),
    sunGateEnd: readNumber(caustics.sun_gate_end ?? caustics.sunGateEnd, defaults.sunGateEnd),
    flowAdvection: readNumber(caustics.flow_advection ?? caustics.flowAdvection, defaults.flowAdvection),
    scale: readNumber(caustics.scale, defaults.scale),
    speed: readNumber(caustics.speed, defaults.speed),
  };
}
