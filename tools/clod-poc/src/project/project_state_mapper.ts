import type {
  ProjectSessionState,
  ProjectWaterArchiveState,
  ProjectWeatherArchiveState,
} from "../project_archive.js";
import type { WaterSliceState } from "../app/state/water_state.js";
import type { WeatherSliceState } from "../app/state/weather_state.js";

export type ProjectStateSource = Omit<ProjectSessionState, "forceMaxLevel"> & {
  forceMaxLevel: string;
} & Pick<WaterSliceState, keyof ProjectWaterArchiveState>
  & Pick<WeatherSliceState, keyof ProjectWeatherArchiveState>;

export function mapProjectSessionState(state: ProjectStateSource): ProjectSessionState {
  return {
    thresholdPx: state.thresholdPx,
    enforce21: state.enforce21,
    freeze: state.freeze,
    wireframe: state.wireframe,
    showBounds: state.showBounds,
    showSeamPoints: state.showSeamPoints,
    showCrossLodBorders: state.showCrossLodBorders,
    colorByLod: state.colorByLod,
    normalColor: state.normalColor,
    normalDivergence: state.normalDivergence,
    divergenceGain: state.divergenceGain,
    frontSideOnly: state.frontSideOnly,
    recomputedNormals: state.recomputedNormals,
    forceMaxLevel: state.forceMaxLevel as ProjectSessionState["forceMaxLevel"],
    textureScale: state.textureScale,
    triplanar: state.triplanar,
    albedo: state.albedo,
    normalMap: state.normalMap,
    normalIntensity: state.normalIntensity,
    roughness: state.roughness,
    metalness: state.metalness,
    textureBlendMode: state.textureBlendMode,
    textureBlendWidth: state.textureBlendWidth,
    terrainBrightness: state.terrainBrightness,
    terrainContrast: state.terrainContrast,
    terrainSaturation: state.terrainSaturation,
    terrainWarmth: state.terrainWarmth,
    sunAzimuthDeg: state.sunAzimuthDeg,
    sunElevationDeg: state.sunElevationDeg,
    sunIntensity: state.sunIntensity,
    skyIntensity: state.skyIntensity,
    groundIntensity: state.groundIntensity,
    exposure: state.exposure,
    horizonSoftness: state.horizonSoftness,
    sunDiskIntensity: state.sunDiskIntensity,
    sunGlowIntensity: state.sunGlowIntensity,
    hazeIntensity: state.hazeIntensity,
    postProcessEnabled: state.postProcessEnabled,
    postProcessOpacity: state.postProcessOpacity,
    postProcessExposure: state.postProcessExposure,
    postProcessContrast: state.postProcessContrast,
    postProcessSaturation: state.postProcessSaturation,
    postProcessVignette: state.postProcessVignette,
    postProcessDebugMode: state.postProcessDebugMode,
    bubble: state.bubble,
    bubbleRadius: state.bubbleRadius,
    tintBubble: state.tintBubble,
    digEnabled: state.digEnabled,
    digRadius: state.digRadius,
    brushOp: state.brushOp,
    brushShape: state.brushShape,
    brushMaterial: state.brushMaterial,
    brushHeight: state.brushHeight,
    brushStrength: state.brushStrength,
    brushFalloff: state.brushFalloff,
    brushFlowMs: state.brushFlowMs,
    grassEnabled: state.grassEnabled,
    grassShaderMode: state.grassShaderMode,
    grassAlphaToCoverage: state.grassAlphaToCoverage,
    grassDistance: state.grassDistance,
    grassBladeSpacing: state.grassBladeSpacing,
    grassBladeHeight: state.grassBladeHeight,
    grassBladeHeightVariation: state.grassBladeHeightVariation,
    grassBladeWidth: state.grassBladeWidth,
    grassWindStrength: state.grassWindStrength,
    grassWindSpeed: state.grassWindSpeed,
    grassSlopeMinY: state.grassSlopeMinY,
    grassMinHeight: state.grassMinHeight,
    grassMaxHeight: state.grassMaxHeight,
    grassMaxBlades: state.grassMaxBlades,
    grassSeed: state.grassSeed,
    treesEnabled: state.treesEnabled,
    treeDistance: state.treeDistance,
    treeMaxInstances: state.treeMaxInstances,
    treeDebugColorByLod: state.treeDebugColorByLod,
    treeWindEnabled: state.treeWindEnabled,
    treeWindStrength: state.treeWindStrength,
    treeWindSpeed: state.treeWindSpeed,
    treeGustStrength: state.treeGustStrength,
    treeTrunkSwayStrength: state.treeTrunkSwayStrength,
    treeLeafFlutterStrength: state.treeLeafFlutterStrength,
  };
}

export function mapProjectWaterArchiveState(state: Pick<WaterSliceState, keyof ProjectWaterArchiveState>): ProjectWaterArchiveState {
  return {
    waterEnabled: state.waterEnabled,
    waterDebugMode: state.waterDebugMode,
    waterClipmapTint: state.waterClipmapTint,
    waterWireframe: state.waterWireframe,
    waterDepthWrite: state.waterDepthWrite,
  };
}

export function mapProjectWeatherArchiveState(
  state: Pick<WeatherSliceState, keyof ProjectWeatherArchiveState>,
): ProjectWeatherArchiveState {
  return {
    weatherMode: state.weatherMode,
    weatherIntensity: state.weatherIntensity,
    weatherWindX: state.weatherWindX,
    weatherWindZ: state.weatherWindZ,
  };
}
