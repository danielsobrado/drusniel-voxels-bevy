import type { GrassSettings } from "./grass_config_types.js";
import {
  DEFAULT_GRASS_APPEARANCE_SETTINGS,
  DEFAULT_GRASS_BLADE_SETTINGS,
  DEFAULT_GRASS_DEBUG_SETTINGS,
  DEFAULT_GRASS_LOD_SETTINGS,
  DEFAULT_GRASS_PLACEMENT_SETTINGS,
  DEFAULT_GRASS_RENDER_SETTINGS,
  DEFAULT_GRASS_SETTINGS,
  DEFAULT_GRASS_WIND_SETTINGS,
} from "./grass_config_defaults.js";
import {
  readBoolean,
  readFraction,
  readIntegerAtLeast,
  readNumber,
  readNumberAtLeast,
  readWindDirection,
} from "./grass_config_readers.js";

function readLinearColor(
  value: readonly number[] | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (!value || value.length !== 3 || value.some((c) => !Number.isFinite(c) || c < 0)) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

export function resolveGrassSettings(settings: GrassSettings): GrassSettings {
  const distanceM = readNumberAtLeast(settings.distanceM ?? settings.distance, DEFAULT_GRASS_SETTINGS.distanceM, 0.1);
  const maxInstances = readIntegerAtLeast(settings.maxInstances ?? settings.maxBlades, DEFAULT_GRASS_SETTINGS.maxInstances, 1);
  const refreshDistanceM = readNumberAtLeast(
    settings.refreshDistanceM ?? settings.patchFallback?.refreshDistance,
    DEFAULT_GRASS_SETTINGS.refreshDistanceM,
    0.1,
  );
  const maxNewPatchesPerFrame = readIntegerAtLeast(
    settings.maxNewPatchesPerFrame ?? settings.patchFallback?.maxNewPatchesPerRefresh,
    DEFAULT_GRASS_SETTINGS.maxNewPatchesPerFrame,
    1,
  );

  const placement = { ...DEFAULT_GRASS_PLACEMENT_SETTINGS, ...settings.placement };
  placement.spacingM = readNumberAtLeast(placement.spacingM ?? settings.bladeSpacing, DEFAULT_GRASS_PLACEMENT_SETTINGS.spacingM, 0.05);
  placement.jitter = readFraction(placement.jitter, DEFAULT_GRASS_PLACEMENT_SETTINGS.jitter);
  placement.slopeMinY = readFraction(placement.slopeMinY ?? settings.slopeMinY, DEFAULT_GRASS_PLACEMENT_SETTINGS.slopeMinY);
  placement.minHeightM = readNumber(placement.minHeightM ?? settings.minHeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.minHeightM);
  placement.maxHeightM = readNumber(placement.maxHeightM ?? settings.maxHeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.maxHeightM);
  placement.minGrassWeight = readFraction(placement.minGrassWeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.minGrassWeight);
  if (placement.maxHeightM < placement.minHeightM) placement.maxHeightM = placement.minHeightM;

  const lod = { ...DEFAULT_GRASS_LOD_SETTINGS, ...settings.lod };
  lod.nearFraction = readFraction(lod.nearFraction, DEFAULT_GRASS_LOD_SETTINGS.nearFraction);
  lod.midFraction = readFraction(lod.midFraction, DEFAULT_GRASS_LOD_SETTINGS.midFraction);
  if (lod.midFraction <= lod.nearFraction) lod.midFraction = Math.min(1, lod.nearFraction + 0.01);
  lod.farDensityRatio = readFraction(lod.farDensityRatio, DEFAULT_GRASS_LOD_SETTINGS.farDensityRatio);
  lod.midInstanceFraction = readFraction(lod.midInstanceFraction, DEFAULT_GRASS_LOD_SETTINGS.midInstanceFraction);
  lod.farInstanceFraction = readFraction(lod.farInstanceFraction, DEFAULT_GRASS_LOD_SETTINGS.farInstanceFraction);
  lod.ditherBandM = readNumberAtLeast(lod.ditherBandM, DEFAULT_GRASS_LOD_SETTINGS.ditherBandM, 0);

  const blade = { ...DEFAULT_GRASS_BLADE_SETTINGS, ...settings.blade };
  blade.heightM = readNumberAtLeast(blade.heightM ?? settings.bladeHeight, DEFAULT_GRASS_BLADE_SETTINGS.heightM, 0.05);
  blade.heightVariation = readNumberAtLeast(blade.heightVariation ?? settings.bladeHeightVariation, DEFAULT_GRASS_BLADE_SETTINGS.heightVariation, 0);
  blade.widthM = readNumberAtLeast(blade.widthM ?? settings.bladeWidth, DEFAULT_GRASS_BLADE_SETTINGS.widthM, 0.001);
  blade.nearBladesPerInstance = readIntegerAtLeast(blade.nearBladesPerInstance, DEFAULT_GRASS_BLADE_SETTINGS.nearBladesPerInstance, 1);
  blade.midBladesPerInstance = readIntegerAtLeast(blade.midBladesPerInstance, DEFAULT_GRASS_BLADE_SETTINGS.midBladesPerInstance, 1);
  blade.nearSegments = readIntegerAtLeast(blade.nearSegments, DEFAULT_GRASS_BLADE_SETTINGS.nearSegments, 1);
  blade.midSegments = readIntegerAtLeast(blade.midSegments, DEFAULT_GRASS_BLADE_SETTINGS.midSegments, 1);
  blade.farTuftWidthM = readNumberAtLeast(blade.farTuftWidthM, DEFAULT_GRASS_BLADE_SETTINGS.farTuftWidthM, 0.01);
  blade.nearCrossedQuads = readBoolean(blade.nearCrossedQuads ?? settings.nearCrossedQuads, DEFAULT_GRASS_BLADE_SETTINGS.nearCrossedQuads);
  blade.maxWidthCompensation = readNumberAtLeast(blade.maxWidthCompensation, DEFAULT_GRASS_BLADE_SETTINGS.maxWidthCompensation, 1);

  const windDirection = readWindDirection(settings.wind?.direction, DEFAULT_GRASS_WIND_SETTINGS.direction);
  const wind = { ...DEFAULT_GRASS_WIND_SETTINGS, ...settings.wind, direction: windDirection };
  wind.strength = readNumberAtLeast(wind.strength ?? settings.windStrength, DEFAULT_GRASS_WIND_SETTINGS.strength, 0);
  wind.speed = readNumberAtLeast(wind.speed ?? settings.windSpeed, DEFAULT_GRASS_WIND_SETTINGS.speed, 0);
  wind.gustStrength = readNumberAtLeast(wind.gustStrength, DEFAULT_GRASS_WIND_SETTINGS.gustStrength, 0);
  wind.turbulence = readNumberAtLeast(wind.turbulence, DEFAULT_GRASS_WIND_SETTINGS.turbulence ?? 0.25, 0);

  const appearance = {
    ...DEFAULT_GRASS_APPEARANCE_SETTINGS,
    ...settings.appearance,
    baseColor: readLinearColor(settings.appearance?.baseColor, DEFAULT_GRASS_APPEARANCE_SETTINGS.baseColor),
    tipColor: readLinearColor(settings.appearance?.tipColor, DEFAULT_GRASS_APPEARANCE_SETTINGS.tipColor),
    dryColor: readLinearColor(settings.appearance?.dryColor, DEFAULT_GRASS_APPEARANCE_SETTINGS.dryColor),
  };
  appearance.normalPull = readFraction(appearance.normalPull, DEFAULT_GRASS_APPEARANCE_SETTINGS.normalPull);
  appearance.patchScale = readNumberAtLeast(appearance.patchScale, DEFAULT_GRASS_APPEARANCE_SETTINGS.patchScale, 1);
  appearance.patchStrength = readFraction(appearance.patchStrength, DEFAULT_GRASS_APPEARANCE_SETTINGS.patchStrength);

  const render = { ...DEFAULT_GRASS_RENDER_SETTINGS, ...settings.render };
  render.alphaToCoverage = readBoolean(render.alphaToCoverage ?? settings.alphaToCoverage, DEFAULT_GRASS_RENDER_SETTINGS.alphaToCoverage);
  render.ditherFade = readBoolean(render.ditherFade, DEFAULT_GRASS_RENDER_SETTINGS.ditherFade);

  const debug = { ...DEFAULT_GRASS_DEBUG_SETTINGS, ...settings.debug };
  debug.showLodColors = readBoolean(debug.showLodColors, DEFAULT_GRASS_DEBUG_SETTINGS.showLodColors);
  debug.showPatchBounds = readBoolean(debug.showPatchBounds, DEFAULT_GRASS_DEBUG_SETTINGS.showPatchBounds);

  return {
    ...settings,
    distanceM,
    refreshDistanceM,
    maxNewPatchesPerFrame,
    maxInstances,
    placement,
    lod,
    blade,
    wind,
    appearance,
    render,
    debug,
    alphaToCoverage: render.alphaToCoverage,
    nearCrossedQuads: blade.nearCrossedQuads,
    distance: distanceM,
    bladeSpacing: placement.spacingM,
    bladeHeight: blade.heightM,
    bladeHeightVariation: blade.heightVariation,
    bladeWidth: blade.widthM,
    windStrength: wind.strength,
    windSpeed: wind.speed,
    slopeMinY: placement.slopeMinY,
    minHeight: placement.minHeightM,
    maxHeight: placement.maxHeightM,
    maxBlades: maxInstances,
    ring: {
      ...settings.ring,
      ringDistance: settings.ring.ringDistance,
      bandMeters: settings.ring.bandMeters,
      farDistanceFraction: settings.ring.farDistanceFraction,
    },
    patchFallback: {
      maxNewPatchesPerRefresh: maxNewPatchesPerFrame,
      refreshDistance: refreshDistanceM,
    },
  };
}
