import { isRpgDensityScene } from "../../scenes/rpg_density_scenes.js";

const CONTINENT_SCENE = "continent";
const RPG_DENSITY_SCENE_PARAM = "rpgDensityScene";
/** Matches phase0 rpg_* `world: 32` (32 · 64 m = 2048 m authored domain). */
const RPG_DENSITY_WORLD_PAGES = "32";
/** Fast bootstrap window; streaming fills the rest of the authored domain. */
const RPG_DENSITY_STARTUP_WORLD_PAGES = "2";

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

  // RPG density: configured 32-page domain + small startup so boot stays streaming-fast.
  // Construction uses unbounded placement (route coords sit outside the 2-page boot box).
  if (isRpgDensityScene(params.get(RPG_DENSITY_SCENE_PARAM))) {
    changed = setDefault(params, "world", RPG_DENSITY_WORLD_PAGES) || changed;
    changed = setDefault(params, "startupWorld", RPG_DENSITY_STARTUP_WORLD_PAGES) || changed;
  }

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
