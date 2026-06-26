import terrainBindings from "./shaders/terrain_field_bindings_terrain.wgsl?raw";
import grassBindings from "./shaders/terrain_field_bindings_grass.wgsl?raw";
import stoneBindings from "./shaders/terrain_field_bindings_stone.wgsl?raw";
import treeBindings from "./shaders/terrain_field_bindings_tree.wgsl?raw";
import terrainCommon from "./shaders/terrain_field_common.wgsl?raw";
import placementHeight from "./shaders/placement_height.wgsl?raw";
import terrainEntry from "./shaders/terrain_field_entry.wgsl?raw";
import grassRingEntry from "./shaders/grass_ring.compute.wgsl?raw";
import stoneScatterEntry from "./shaders/stone_scatter.compute.wgsl?raw";
import treeRingEntry from "./shaders/tree_ring.compute.wgsl?raw";
import understoryBindings from "./shaders/terrain_field_bindings_understory.wgsl?raw";
import understoryRingEntry from "./shaders/understory_ring.compute.wgsl?raw";
import { readRiverEcologySettings } from "../water/riverEcologyRuntime.js";

const FIELD_GLOBALS = ["digEdits", "fieldParams"] as const;

function composeShader(label: string, parts: readonly string[]): string {
  const source = parts.join("\n");
  validateSingleFieldBindings(label, source);
  return source;
}

function validateSingleFieldBindings(label: string, source: string): void {
  for (const name of FIELD_GLOBALS) {
    const declarations = source.match(new RegExp(`\\bvar<[^>]+>\\s+${name}\\s*:`, "g")) ?? [];
    if (declarations.length !== 1) {
      throw new Error(`${label} must declare exactly one ${name} binding; found ${declarations.length}`);
    }
  }
}

function formatWgslFloat(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
}

function replaceConst(source: string, name: string, value: number): string {
  return source.replace(
    new RegExp(`const ${name}: f32 = [-+]?[0-9]*\\.?[0-9]+;`),
    `const ${name}: f32 = ${formatWgslFloat(value)};`,
  );
}

function withRiverEcologyConstants(source: string): string {
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

export function composeTerrainFieldShader(): string {
  return composeShader("terrain field shader", [terrainBindings, terrainCommon, terrainEntry]);
}

export function composeGrassRingShader(): string {
  return composeShader("grass ring shader", [grassBindings, terrainCommon, placementHeight, withRiverEcologyConstants(grassRingEntry)]);
}

export function composeStoneScatterShader(): string {
  return composeShader("stone scatter shader", [stoneBindings, terrainCommon, placementHeight, withRiverEcologyConstants(stoneScatterEntry)]);
}

export function composeTreeRingShader(workgroupSize = 64): string {
  const size = workgroupSize === 32 || workgroupSize === 64 || workgroupSize === 128 || workgroupSize === 256
    ? workgroupSize
    : 64;
  const treeEntry = withRiverEcologyConstants(treeRingEntry).replace(
    /const TREE_WORKGROUP_SIZE: u32 = \d+u;/,
    `const TREE_WORKGROUP_SIZE: u32 = ${size}u;`,
  );
  return composeShader("tree ring shader", [treeBindings, terrainCommon, treeEntry]);
}

export function composeUnderstoryRingShader(workgroupSize = 64): string {
  const size = workgroupSize === 32 || workgroupSize === 64 || workgroupSize === 128 || workgroupSize === 256
    ? workgroupSize
    : 64;
  const entry = withRiverEcologyConstants(understoryRingEntry).replace(
    /const UNDERSTORY_WORKGROUP_SIZE: u32 = \d+u;/,
    `const UNDERSTORY_WORKGROUP_SIZE: u32 = ${size}u;`,
  );
  return composeShader("understory ring shader", [understoryBindings, terrainCommon, placementHeight, entry]);
}
