export interface RiverEcologySettings {
  grassClearanceM: number;
  grassLowStartM: number;
  grassLowEndM: number;
  grassMoistStartM: number;
  grassMoistEndM: number;
  understoryClearM: number;
  understoryFernStartM: number;
  understoryFernEndM: number;
  understoryShrubStartM: number;
  understoryShrubEndM: number;
  treeClearanceM: number;
  treeInnerEndM: number;
  treeOuterStartM: number;
  treeOuterEndM: number;
  stoneClearanceM: number;
}

export const DEFAULT_RIVER_ECOLOGY_SETTINGS: RiverEcologySettings = {
  grassClearanceM: 0.35,
  grassLowStartM: 0.8,
  grassLowEndM: 4.2,
  grassMoistStartM: 3.2,
  grassMoistEndM: 11.0,
  understoryClearM: 0.45,
  understoryFernStartM: 1.2,
  understoryFernEndM: 8.0,
  understoryShrubStartM: 5.5,
  understoryShrubEndM: 18.0,
  treeClearanceM: 1.5,
  treeInnerEndM: 8.0,
  treeOuterStartM: 9.0,
  treeOuterEndM: 32.0,
  stoneClearanceM: 0.22,
};

const PARAM_KEYS: Record<keyof RiverEcologySettings, string> = {
  grassClearanceM: "ecoGrassClear",
  grassLowStartM: "ecoGrassLowStart",
  grassLowEndM: "ecoGrassLowEnd",
  grassMoistStartM: "ecoGrassMoistStart",
  grassMoistEndM: "ecoGrassMoistEnd",
  understoryClearM: "ecoUnderClear",
  understoryFernStartM: "ecoUnderFernStart",
  understoryFernEndM: "ecoUnderFernEnd",
  understoryShrubStartM: "ecoUnderShrubStart",
  understoryShrubEndM: "ecoUnderShrubEnd",
  treeClearanceM: "ecoTreeClear",
  treeInnerEndM: "ecoTreeInnerEnd",
  treeOuterStartM: "ecoTreeOuterStart",
  treeOuterEndM: "ecoTreeOuterEnd",
  stoneClearanceM: "ecoStoneClear",
};

function runtimeParams(): URLSearchParams | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
}

function readNumber(params: URLSearchParams | null, key: string, fallback: number): number {
  const raw = params?.get(key);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitize(settings: RiverEcologySettings): RiverEcologySettings {
  const positive = (value: number, fallback: number) => Number.isFinite(value) ? Math.max(0, value) : fallback;
  const grassClearanceM = positive(settings.grassClearanceM, DEFAULT_RIVER_ECOLOGY_SETTINGS.grassClearanceM);
  const grassLowStartM = positive(settings.grassLowStartM, DEFAULT_RIVER_ECOLOGY_SETTINGS.grassLowStartM);
  const grassLowEndM = Math.max(grassLowStartM + 0.1, positive(settings.grassLowEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.grassLowEndM));
  const grassMoistStartM = positive(settings.grassMoistStartM, DEFAULT_RIVER_ECOLOGY_SETTINGS.grassMoistStartM);
  const grassMoistEndM = Math.max(grassMoistStartM + 0.1, positive(settings.grassMoistEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.grassMoistEndM));
  const understoryClearM = positive(settings.understoryClearM, DEFAULT_RIVER_ECOLOGY_SETTINGS.understoryClearM);
  const understoryFernStartM = positive(settings.understoryFernStartM, DEFAULT_RIVER_ECOLOGY_SETTINGS.understoryFernStartM);
  const understoryFernEndM = Math.max(understoryFernStartM + 0.1, positive(settings.understoryFernEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.understoryFernEndM));
  const understoryShrubStartM = positive(settings.understoryShrubStartM, DEFAULT_RIVER_ECOLOGY_SETTINGS.understoryShrubStartM);
  const understoryShrubEndM = Math.max(understoryShrubStartM + 0.1, positive(settings.understoryShrubEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.understoryShrubEndM));
  const treeClearanceM = positive(settings.treeClearanceM, DEFAULT_RIVER_ECOLOGY_SETTINGS.treeClearanceM);
  const treeInnerEndM = Math.max(treeClearanceM + 0.1, positive(settings.treeInnerEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.treeInnerEndM));
  const treeOuterStartM = positive(settings.treeOuterStartM, DEFAULT_RIVER_ECOLOGY_SETTINGS.treeOuterStartM);
  const treeOuterEndM = Math.max(treeOuterStartM + 0.1, positive(settings.treeOuterEndM, DEFAULT_RIVER_ECOLOGY_SETTINGS.treeOuterEndM));
  const stoneClearanceM = positive(settings.stoneClearanceM, DEFAULT_RIVER_ECOLOGY_SETTINGS.stoneClearanceM);
  return {
    grassClearanceM,
    grassLowStartM,
    grassLowEndM,
    grassMoistStartM,
    grassMoistEndM,
    understoryClearM,
    understoryFernStartM,
    understoryFernEndM,
    understoryShrubStartM,
    understoryShrubEndM,
    treeClearanceM,
    treeInnerEndM,
    treeOuterStartM,
    treeOuterEndM,
    stoneClearanceM,
  };
}

export function readRiverEcologySettings(): RiverEcologySettings {
  const params = runtimeParams();
  const defaults = DEFAULT_RIVER_ECOLOGY_SETTINGS;
  return sanitize({
    grassClearanceM: readNumber(params, PARAM_KEYS.grassClearanceM, defaults.grassClearanceM),
    grassLowStartM: readNumber(params, PARAM_KEYS.grassLowStartM, defaults.grassLowStartM),
    grassLowEndM: readNumber(params, PARAM_KEYS.grassLowEndM, defaults.grassLowEndM),
    grassMoistStartM: readNumber(params, PARAM_KEYS.grassMoistStartM, defaults.grassMoistStartM),
    grassMoistEndM: readNumber(params, PARAM_KEYS.grassMoistEndM, defaults.grassMoistEndM),
    understoryClearM: readNumber(params, PARAM_KEYS.understoryClearM, defaults.understoryClearM),
    understoryFernStartM: readNumber(params, PARAM_KEYS.understoryFernStartM, defaults.understoryFernStartM),
    understoryFernEndM: readNumber(params, PARAM_KEYS.understoryFernEndM, defaults.understoryFernEndM),
    understoryShrubStartM: readNumber(params, PARAM_KEYS.understoryShrubStartM, defaults.understoryShrubStartM),
    understoryShrubEndM: readNumber(params, PARAM_KEYS.understoryShrubEndM, defaults.understoryShrubEndM),
    treeClearanceM: readNumber(params, PARAM_KEYS.treeClearanceM, defaults.treeClearanceM),
    treeInnerEndM: readNumber(params, PARAM_KEYS.treeInnerEndM, defaults.treeInnerEndM),
    treeOuterStartM: readNumber(params, PARAM_KEYS.treeOuterStartM, defaults.treeOuterStartM),
    treeOuterEndM: readNumber(params, PARAM_KEYS.treeOuterEndM, defaults.treeOuterEndM),
    stoneClearanceM: readNumber(params, PARAM_KEYS.stoneClearanceM, defaults.stoneClearanceM),
  });
}

export function reloadWithRiverEcologySettings(settings: RiverEcologySettings): void {
  if (typeof window === "undefined") return;
  const sanitized = sanitize(settings);
  const url = new URL(window.location.href);
  for (const [key, param] of Object.entries(PARAM_KEYS) as Array<[keyof RiverEcologySettings, string]>) {
    url.searchParams.set(param, sanitized[key].toFixed(2));
  }
  window.location.assign(url.toString());
}

export function riverEcologyReadout(settings: RiverEcologySettings = readRiverEcologySettings()): Record<"grass" | "understory" | "trees" | "stones", string> {
  const s = sanitize(settings);
  return {
    grass: `clear ${s.grassClearanceM.toFixed(2)}m; low ${s.grassLowStartM.toFixed(1)}-${s.grassLowEndM.toFixed(1)}m; moist ${s.grassMoistStartM.toFixed(1)}-${s.grassMoistEndM.toFixed(1)}m`,
    understory: `clear ${s.understoryClearM.toFixed(2)}m; fern ${s.understoryFernStartM.toFixed(1)}-${s.understoryFernEndM.toFixed(1)}m; shrub ${s.understoryShrubStartM.toFixed(1)}-${s.understoryShrubEndM.toFixed(1)}m`,
    trees: `clear ${s.treeClearanceM.toFixed(1)}m; sparse inner to ${s.treeInnerEndM.toFixed(1)}m; outer ${s.treeOuterStartM.toFixed(1)}-${s.treeOuterEndM.toFixed(1)}m`,
    stones: `clear ${s.stoneClearanceM.toFixed(2)}m; dry streambed edge; deeper sink`,
  };
}
