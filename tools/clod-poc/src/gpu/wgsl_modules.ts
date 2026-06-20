import terrainBindings from "./shaders/terrain_field_bindings_terrain.wgsl?raw";
import grassBindings from "./shaders/terrain_field_bindings_grass.wgsl?raw";
import stoneBindings from "./shaders/terrain_field_bindings_stone.wgsl?raw";
import terrainCommon from "./shaders/terrain_field_common.wgsl?raw";
import terrainEntry from "./shaders/terrain_field_entry.wgsl?raw";
import grassRingEntry from "./shaders/grass_ring.compute.wgsl?raw";
import stoneScatterEntry from "./shaders/stone_scatter.compute.wgsl?raw";

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
