import type { ProjectSessionState } from "../../project_archive.js";
import type { GrassSettings } from "../../grass/grass_config.js";
import type { StoneSettings } from "../../stones/stone_config.js";
import type { TreeSettings } from "../../trees/tree_config.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import type { ForestLightingSettings } from "../../forest_lighting/forest_lighting_config.js";
import type { ForestLightingDebugMode } from "../../forest_lighting/index.js";
import type { TreeTotalDisplay } from "../../trees/tree_info.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface VegetationSliceState {
  grassEnabled: boolean;
  grassRingDebug: boolean;
  grassShaderMode: GrassSettings["shaderMode"];
  grassAlphaToCoverage: boolean;
  grassNearCrossedQuads: boolean;
  grassDistance: number;
  grassBladeSpacing: number;
  grassBladeHeight: number;
  grassBladeHeightVariation: number;
  grassBladeWidth: number;
  grassWindStrength: number;
  grassWindSpeed: number;
  grassSlopeMinY: number;
  grassMinHeight: number;
  grassMaxHeight: number;
  grassMaxBlades: number;
  grassSeed: number;
  grassBladeCount: number;
  grassVisiblePatches: string;
  grassTierSummary: string;
  grassEdgeSuppressed: number;
  grassCandidateCount: number;
  grassPatchRebuildCount: number;
  grassBuildMs: number;
  stonesEnabled: boolean;
  stoneDensity: number;
  stoneMaxInstances: number;
  stoneSeed: number;
  stoneShowLarge: boolean;
  stoneShowMedium: boolean;
  stoneShowSmall: boolean;
  stoneTotal: number;
  stoneClassSummary: string;
  stoneVisible: number;
  treesEnabled: boolean;
  treeDistance: number;
  treeMaxInstances: number;
  treeDebugColorByLod: boolean;
  treeWindEnabled: boolean;
  treeWindStrength: number;
  treeWindSpeed: number;
  treeGustStrength: number;
  treeTrunkSwayStrength: number;
  treeLeafFlutterStrength: number;
  treeGpuEnabled: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
  treeTotal: TreeTotalDisplay;
  treeVisiblePatches: string;
  treeLodSummary: string;
  treeGpuSummary: string;
  understoryEnabled: boolean;
  understoryDistance: number;
  understoryMaxInstances: number;
  understoryDebugColorByClass: boolean;
  understoryTotal: number;
  understoryVisiblePatches: string;
  understoryClassSummary: string;
  understoryGpuSummary: string;
  forestLightingEnabled: boolean;
  forestLightingAoStrength: number;
  forestLightingShadowStrength: number;
  forestLightingFogStrength: number;
  forestLightingSunShaftsStrength: number;
  forestLightingDebugMode: ForestLightingDebugMode;
  forestLightingStats: string;
}

const GRASS_ARCHIVE_KEYS = [
  "grassEnabled", "grassShaderMode", "grassAlphaToCoverage", "grassDistance", "grassBladeSpacing",
  "grassBladeHeight", "grassBladeHeightVariation", "grassBladeWidth", "grassWindStrength",
  "grassWindSpeed", "grassSlopeMinY", "grassMinHeight", "grassMaxHeight", "grassMaxBlades", "grassSeed",
] as const satisfies readonly (keyof ProjectSessionState)[];

const TREE_ARCHIVE_KEYS = [
  "treesEnabled", "treeDistance", "treeMaxInstances", "treeDebugColorByLod", "treeWindEnabled",
  "treeWindStrength", "treeWindSpeed", "treeGustStrength", "treeTrunkSwayStrength", "treeLeafFlutterStrength",
] as const;

export function createVegetationSliceState(input: {
  grassConfig: GrassSettings;
  stoneConfig: StoneSettings;
  treeConfig: TreeSettings;
  understoryConfig: UnderstorySettings;
  forestLightingConfig: ForestLightingSettings;
  grassRingDebug: boolean;
}): VegetationSliceState {
  const { grassConfig, stoneConfig, treeConfig, understoryConfig, forestLightingConfig } = input;
  return {
    grassEnabled: grassConfig.enabled,
    grassRingDebug: input.grassRingDebug,
    grassShaderMode: grassConfig.shaderMode,
    grassAlphaToCoverage: grassConfig.alphaToCoverage,
    grassNearCrossedQuads: grassConfig.nearCrossedQuads,
    grassDistance: grassConfig.distance,
    grassBladeSpacing: grassConfig.bladeSpacing,
    grassBladeHeight: grassConfig.bladeHeight,
    grassBladeHeightVariation: grassConfig.bladeHeightVariation,
    grassBladeWidth: grassConfig.bladeWidth,
    grassWindStrength: grassConfig.windStrength,
    grassWindSpeed: grassConfig.windSpeed,
    grassSlopeMinY: grassConfig.slopeMinY,
    grassMinHeight: grassConfig.minHeight,
    grassMaxHeight: grassConfig.maxHeight,
    grassMaxBlades: grassConfig.maxBlades,
    grassSeed: grassConfig.seed,
    grassBladeCount: 0,
    grassVisiblePatches: "0/0",
    grassTierSummary: "0/0/0/0",
    grassEdgeSuppressed: 0,
    grassCandidateCount: 0,
    grassPatchRebuildCount: 0,
    grassBuildMs: 0,
    stonesEnabled: stoneConfig.enabled,
    stoneDensity: stoneConfig.density,
    stoneMaxInstances: stoneConfig.maxInstances,
    stoneSeed: stoneConfig.seedSalt,
    stoneShowLarge: true,
    stoneShowMedium: true,
    stoneShowSmall: true,
    stoneTotal: 0,
    stoneClassSummary: "0/0/0",
    stoneVisible: 0,
    treesEnabled: treeConfig.enabled,
    treeDistance: treeConfig.distanceM,
    treeMaxInstances: treeConfig.maxInstances,
    treeDebugColorByLod: treeConfig.render.debugColorByLod,
    treeWindEnabled: treeConfig.wind.enabled,
    treeWindStrength: treeConfig.wind.strength,
    treeWindSpeed: treeConfig.wind.speed,
    treeGustStrength: treeConfig.wind.gustStrength,
    treeTrunkSwayStrength: treeConfig.wind.trunkSwayStrength,
    treeLeafFlutterStrength: treeConfig.wind.leafFlutterStrength,
    treeGpuEnabled: treeConfig.gpu.enabled,
    treeGpuForceCpu: treeConfig.gpu.debugForceCpu,
    treeGpuShowCounts: treeConfig.gpu.debugShowGpuCounts,
    treeTotal: 0,
    treeVisiblePatches: "0/0",
    treeLodSummary: "0/0/0/0",
    treeGpuSummary: "disabled",
    understoryEnabled: understoryConfig.enabled,
    understoryDistance: understoryConfig.distanceM,
    understoryMaxInstances: understoryConfig.maxInstances,
    understoryDebugColorByClass: understoryConfig.render.debugColorByClass,
    understoryTotal: 0,
    understoryVisiblePatches: "0/0",
    understoryClassSummary: "0/0/0/0/0/0",
    understoryGpuSummary: "disabled",
    forestLightingEnabled: forestLightingConfig.enabled,
    forestLightingAoStrength: forestLightingConfig.ambientOcclusion.strength,
    forestLightingShadowStrength: forestLightingConfig.shadowProxy.strength,
    forestLightingFogStrength: forestLightingConfig.atmosphere.forestFogStrength,
    forestLightingSunShaftsStrength: forestLightingConfig.atmosphere.sunShaftsStrength,
    forestLightingDebugMode: forestLightingConfig.materialIntegration.debugMode as ForestLightingDebugMode,
    forestLightingStats: "pending",
  };
}

export function applyVegetationArchiveState(target: VegetationSliceState, archive: ProjectSessionState): void {
  assignArchiveFields(target, archive, GRASS_ARCHIVE_KEYS);
  for (const key of TREE_ARCHIVE_KEYS) {
    const value = archive[key as keyof ProjectSessionState];
    if (value !== undefined) {
      (target as unknown as Record<string, unknown>)[key] = value;
    }
  }
}
