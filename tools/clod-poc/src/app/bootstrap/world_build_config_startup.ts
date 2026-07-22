import { parseConfig, type ClodPagesConfig } from "../../config.js";
import {
  parseBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
} from "../../terrain/terrain.js";
import { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import { parseGrassConfig, applyGrassMaterialBiasFromYaml } from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { parseTreeConfig, applyTreeMaterialBiasFromYaml } from "../../trees/index.js";
import { parseUnderstoryConfig } from "../../understory/index.js";
import {
  createForestLightingIntegrationWarner,
  parseForestLightingConfig,
} from "../../forest_lighting/index.js";
import {
  parseWaterConfig,
  type WaterConfig,
} from "../../water/index.js";
import { applyWaterQueryOverrides } from "../../water/water_quality_overrides.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import configText from "../../../config/clod_pages.yaml?raw";
import stoneConfigText from "../../../config/stones.yaml?raw";
import treeConfigText from "../../../config/trees.yaml?raw";
import understoryConfigText from "../../../config/understory.yaml?raw";
import proceduralConfigText from "../../../config/procedural_textures.yaml?raw";
import grassConfigText from "../../../config/grass.yaml?raw";
import waterConfigText from "../../../config/water.yaml?raw";
import borderCoastOceanConfigText from "../../../config/border_coast_ocean.yaml?raw";
import borderOceanSceneConfigText from "../../../config/border_ocean_scene.yaml?raw";
import forestLightingConfigText from "../../../config/forest_lighting.yaml?raw";
import customPropsConfigText from "../../../config/custom_props.yaml?raw";
import customPropPlacementsText from "../../../config/custom_prop_placements.yaml?raw";
import customPropPlacements500Text from "../../../config/custom_prop_placements_500.yaml?raw";
import customPropPlacements5000Text from "../../../config/custom_prop_placements_5000.yaml?raw";
import customPropPlacements20000Text from "../../../config/custom_prop_placements_20000.yaml?raw";
import { parseCustomPropsConfig } from "../../props/prop_config.js";
import { parsePropPlacements } from "../../props/prop_placements.js";
import type { CustomPropsSettings } from "../../props/prop_types.js";
import type { PropPlacementScene } from "../../props/prop_types.js";
import { parseBorderOceanSceneConfig } from "../../debug/border_ocean_scene.js";
import { addTiming, measure, type StartupTimings } from "./world_build_startup_params.js";

function createLazyPropPlacementScenes(timings: StartupTimings): Record<string, PropPlacementScene> {
  const texts: Record<string, string> = {
    smoke: customPropPlacementsText,
    "500": customPropPlacements500Text,
    "5000": customPropPlacements5000Text,
    "20000": customPropPlacements20000Text,
  };
  const cache = new Map<string, PropPlacementScene>();
  const scenes = {} as Record<string, PropPlacementScene>;
  for (const [sceneId, text] of Object.entries(texts)) {
    Object.defineProperty(scenes, sceneId, {
      enumerable: true,
      configurable: false,
      get: () => {
        const cached = cache.get(sceneId);
        if (cached) return cached;
        const startedAt = performance.now();
        const parsed = parsePropPlacements(text);
        const elapsed = performance.now() - startedAt;
        cache.set(sceneId, parsed);
        addTiming(timings, "startup.prop_placements_ms", elapsed);
        timings[`startup.prop_placement_${sceneId}_ms`] = elapsed;
        return parsed;
      },
    });
  }
  return scenes;
}

export interface WorldBuildParsedConfigs {
  cfg: ClodPagesConfig;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  forestLightingConfig: ReturnType<typeof parseForestLightingConfig>;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  customPropsConfig: CustomPropsSettings;
  propPlacementScenes: Record<string, PropPlacementScene>;
  waterConfig: WaterConfig;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  borderOceanSceneConfig: ReturnType<typeof parseBorderOceanSceneConfig>;
  proceduralTextureConfig: ReturnType<typeof parseProceduralTextureConfig>;
}

export function parseWorldBuildConfigs(input: {
  stagedImport: VoxelProjectArchiveContents | null;
  searchParams: URLSearchParams;
  startupTimings: StartupTimings;
}): WorldBuildParsedConfigs {
  const { stagedImport, searchParams, startupTimings } = input;
  return measure(startupTimings, "startup.parse_configs_ms", () => {
    const cfg = stagedImport?.manifest.config ?? parseConfig(configText);
    const stoneConfig = parseStoneConfig(stoneConfigText);
    const treeConfig = applyTreeMaterialBiasFromYaml(parseTreeConfig(treeConfigText), treeConfigText);
    const understoryConfig = parseUnderstoryConfig(understoryConfigText);
    const forestLightingConfig = parseForestLightingConfig(forestLightingConfigText);
    createForestLightingIntegrationWarner()(forestLightingConfig);
    const grassConfig = applyGrassMaterialBiasFromYaml(parseGrassConfig(grassConfigText), grassConfigText);
    const customPropsConfig = parseCustomPropsConfig(customPropsConfigText);
    const propPlacementScenes = createLazyPropPlacementScenes(startupTimings);
    const waterConfig = applyWaterQueryOverrides(parseWaterConfig(waterConfigText), searchParams);
    const borderCoastOceanConfig = parseBorderCoastOceanConfig(borderCoastOceanConfigText);
    const borderOceanSceneConfig = parseBorderOceanSceneConfig(borderOceanSceneConfigText);
    const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
    return {
      cfg,
      stoneConfig,
      treeConfig,
      understoryConfig,
      forestLightingConfig,
      grassConfig,
      customPropsConfig,
      propPlacementScenes,
      waterConfig,
      borderCoastOceanConfig,
      borderOceanSceneConfig,
      proceduralTextureConfig,
    };
  });
}
