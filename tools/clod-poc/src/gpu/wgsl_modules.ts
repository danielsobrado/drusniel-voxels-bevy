import terrainBindings from "./shaders/terrain_field_bindings_terrain.wgsl?raw";
import grassBindings from "./shaders/terrain_field_bindings_grass.wgsl?raw";
import stoneBindings from "./shaders/terrain_field_bindings_stone.wgsl?raw";
import treeBindings from "./shaders/terrain_field_bindings_tree.wgsl?raw";
import terrainCommon from "./shaders/terrain_field_common.wgsl?raw";
import terrainEntry from "./shaders/terrain_field_entry.wgsl?raw";
import grassRingEntry from "./shaders/grass_ring.compute.wgsl?raw";
import stoneScatterEntry from "./shaders/stone_scatter.compute.wgsl?raw";
import treeRingEntry from "./shaders/tree_ring.compute.wgsl?raw";
import understoryBindings from "./shaders/terrain_field_bindings_understory.wgsl?raw";
import understoryRingEntry from "./shaders/understory_ring.compute.wgsl?raw";

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

export function composeTerrainFieldShader(): string {
  return composeShader("terrain field shader", [terrainBindings, terrainCommon, terrainEntry]);
}

export function composeGrassRingShader(): string {
  return composeShader("grass ring shader", [grassBindings, terrainCommon, grassRingEntry]);
}

export function composeStoneScatterShader(): string {
  return composeShader("stone scatter shader", [stoneBindings, terrainCommon, stoneScatterEntry]);
}

export function composeTreeRingShader(workgroupSize = 64): string {
  const size = workgroupSize === 32 || workgroupSize === 64 || workgroupSize === 128 || workgroupSize === 256
    ? workgroupSize
    : 64;
  const treeEntry = treeRingEntry.replace(
    /const TREE_WORKGROUP_SIZE: u32 = \d+u;/,
    `const TREE_WORKGROUP_SIZE: u32 = ${size}u;`,
  );
  return composeShader("tree ring shader", [treeBindings, terrainCommon, treeEntry]);
}

export function composeUnderstoryRingShader(workgroupSize = 64): string {
  const size = workgroupSize === 32 || workgroupSize === 64 || workgroupSize === 128 || workgroupSize === 256
    ? workgroupSize
    : 64;
  const entry = understoryRingEntry.replace(
    /const UNDERSTORY_WORKGROUP_SIZE: u32 = \d+u;/,
    `const UNDERSTORY_WORKGROUP_SIZE: u32 = ${size}u;`,
  );
  return composeShader("understory ring shader", [understoryBindings, terrainCommon, entry]);
}
