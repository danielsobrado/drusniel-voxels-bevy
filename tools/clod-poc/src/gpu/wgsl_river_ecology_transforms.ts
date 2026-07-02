import { readRiverEcologySettings } from "../water/riverEcologyRuntime.js";

function replaceConst(source: string, name: string, value: number): string {
  const escaped = Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "0";
  return source.replace(new RegExp(`const ${name}: f32 = [-0-9.]+;`), `const ${name}: f32 = ${escaped};`);
}

export function withRiverEcologyConstants(source: string): string {
  const ecology = readRiverEcologySettings();
  return [
    ["GRASS_HYDRO_WATER_CLEARANCE", ecology.grassClearanceM],
    ["GRASS_LOW_BANK_START_M", ecology.grassLowStartM],
    ["GRASS_LOW_BANK_END_M", ecology.grassLowEndM],
    ["GRASS_MOIST_BANK_START_M", ecology.grassMoistStartM],
    ["GRASS_MOIST_BANK_END_M", ecology.grassMoistEndM],
    ["UNDERSTORY_RIVER_CLEAR_M", ecology.understoryClearM],
    ["UNDERSTORY_FERN_START_M", ecology.understoryFernStartM],
    ["UNDERSTORY_FERN_END_M", ecology.understoryFernEndM],
    ["UNDERSTORY_SHRUB_START_M", ecology.understoryShrubStartM],
    ["UNDERSTORY_SHRUB_END_M", ecology.understoryShrubEndM],
    ["TREE_HYDRO_WATER_CLEARANCE", ecology.treeClearanceM],
    ["TREE_RIPARIAN_INNER_END_M", ecology.treeInnerEndM],
    ["TREE_RIPARIAN_OUTER_START_M", ecology.treeOuterStartM],
    ["TREE_RIPARIAN_OUTER_END_M", ecology.treeOuterEndM],
    ["STONE_HYDRO_WATER_CLEARANCE", ecology.stoneClearanceM],
  ].reduce((next, [name, value]) => replaceConst(next, name as string, value as number), source);
}
