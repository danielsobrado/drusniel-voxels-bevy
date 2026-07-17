import { isRpgDensityScene } from "../../scenes/rpg_density_scenes.js";

const CONTINENT_SCENE = "continent";
const RPG_DENSITY_SCENE_PARAM = "rpgDensityScene";

function setDefault(params: URLSearchParams, key: string, value: string): boolean {
  if (params.has(key)) return false;
  params.set(key, value);
  return true;
}

/** Continent-backed scenes must exercise the same unified path as acceptance. */
export function applyContinentDefaults(params: URLSearchParams): boolean {
  const requestedScene = params.get("scene");
  let changed = false;
  if (isRpgDensityScene(requestedScene)) {
    params.set(RPG_DENSITY_SCENE_PARAM, requestedScene);
    params.set("scene", CONTINENT_SCENE);
    changed = true;
  }
  if (params.get("scene") !== CONTINENT_SCENE) return false;

  changed = setDefault(params, "continentHydrology", "1") || changed;
  changed = setDefault(params, "heightTiles", "1") || changed;
  changed = setDefault(params, "liveClodRootGpuMesher", "1") || changed;
  changed = setDefault(params, "farSummaryLayout", "2") || changed;

  if (params.get("farSummaryLayout") === "2") {
    changed = setDefault(params, "farClipmap", "1") || changed;
    if (params.get("farClipmap") === "1") {
      changed = setDefault(params, "farClipmapMode", "replace") || changed;
      changed = setDefault(params, "farClipmapInnerRadius", "768") || changed;
    }
  }

  return changed;
}
