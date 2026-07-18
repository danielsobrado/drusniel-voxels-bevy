import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import type { WaterBodyVisualPreset, WaterBodyVisualPresets } from "./water_body_presets.js";
import type { WaterConfig } from "./water_config_types.js";

function cloneWaterBodyPreset(preset: WaterBodyVisualPreset): WaterBodyVisualPreset {
  return {
    ...preset,
    shallowColor: [...preset.shallowColor],
    deepColor: [...preset.deepColor],
    absorption: [...preset.absorption],
  };
}

function cloneWaterBodyPresets(presets: WaterBodyVisualPresets): WaterBodyVisualPresets {
  return {
    ocean: cloneWaterBodyPreset(presets.ocean),
    lake: cloneWaterBodyPreset(presets.lake),
    river: cloneWaterBodyPreset(presets.river),
    pond: cloneWaterBodyPreset(presets.pond),
    marsh: cloneWaterBodyPreset(presets.marsh),
  };
}

export function cloneWaterConfig(config: WaterConfig): WaterConfig {
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
      bodies: cloneWaterBodyPresets(config.visual.bodies),
      glacialMurkiness: {
        ...config.visual.glacialMurkiness,
        absorptionMultiplier: [...config.visual.glacialMurkiness.absorptionMultiplier],
      },
      rockFlour: {
        ...config.visual.rockFlour,
        lakeColor: [...config.visual.rockFlour.lakeColor],
        riverColor: [...config.visual.rockFlour.riverColor],
      },
      refraction: { ...config.visual.refraction },
      reflection: {
        ...config.visual.reflection,
        clipmapTiers: { ...config.visual.reflection.clipmapTiers },
      },
    },
    debug: { ...config.debug },
  };
}
