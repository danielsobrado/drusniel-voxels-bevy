const CONTINENT_SCENE = "continent";

function setDefault(params: URLSearchParams, key: string, value: string): boolean {
  if (params.has(key)) return false;
  params.set(key, value);
  return true;
}

/** The ordinary continent URL must exercise the same unified path as acceptance. */
export function applyContinentDefaults(params: URLSearchParams): boolean {
  if (params.get("scene") !== CONTINENT_SCENE) return false;

  let changed = setDefault(params, "continentHydrology", "1");
  changed = setDefault(params, "heightTiles", "1") || changed;
  changed = setDefault(params, "liveClodRootGpuMesher", "1") || changed;
  changed = setDefault(params, "farSummaryLayout", "2") || changed;

  if (params.get("farSummaryLayout") === "2") {
    changed = setDefault(params, "farClipmap", "1") || changed;
    if (params.get("farClipmap") === "1") {
      changed = setDefault(params, "farClipmapMode", "replace") || changed;
    }
  }

  return changed;
}
