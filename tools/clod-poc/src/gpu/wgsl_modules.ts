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
const GRASS_FRUSTUM_RADIUS_CONST = "const GRASS_FRUSTUM_HORIZONTAL_SLACK_M: f32 = 1.4;";

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
    new RegExp(`const ${name}: f32 = [-+]?[0-9]*\.?[0-9]+;`),
    `const ${name}: f32 = ${formatWgslFloat(value)};`,
  );
}

function withConservativeGrassFrustum(source: string): string {
  if (source.includes("in_frustum_sphere")) return source;
  const normalized = source.replace(/\r\n/g, "\n");
  const withConst = normalized.replace(
    "const GRASS_MOIST_BANK_END_M: f32 = 11.0;",
    `const GRASS_MOIST_BANK_END_M: f32 = 11.0;\n${GRASS_FRUSTUM_RADIUS_CONST}`,
  );
  const withSphereFn = withConst.replace(
    /fn in_frustum\(center: vec3<f32>, slack: f32\) -> bool \{[\s\S]*?\n\}/,
    `fn in_frustum_sphere(center: vec3<f32>, radius: f32) -> bool {
  let safe_radius = max(0.0, radius);
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.planes[p];
    if (dot(plane.xyz, center) + plane.w < -safe_radius) { return false; }
  }
  return true;
}`,
  );
  return withSphereFn.replace(
    /  if \(!in_frustum\(vec3<f32>\(wpos\.x, height \+ 0\.5, wpos\.y\), 1\.4\)\) \{ return; \}\r?\n  let river_band = river_grass_ecology_band\(wpos\.x, wpos\.y, hydro, height\);/,
    `  let river_band = river_grass_ecology_band(wpos.x, wpos.y, hydro, height);
  let max_height_scale = max(0.1, 1.0 + abs(params.settings_a.z)) * river_band.height;
  let max_blade_height = params.settings_a.y * max_height_scale * 2.25;
  let blade_center = vec3<f32>(wpos.x, height + 0.02 + max_blade_height * 0.5, wpos.y);
  let blade_radius = max_blade_height * 0.5 + GRASS_FRUSTUM_HORIZONTAL_SLACK_M;
  if (!in_frustum_sphere(blade_center, blade_radius)) { return; }`,
  );
}

function withTreeFinalPlacementHeight(source: string): string {
  return source
    .replace(
      "let hx0 = surfaceHeightField(wpos.x - sample_radius, wpos.y);",
      "let hx0 = placement_ground_height(wpos.x - sample_radius, wpos.y, params.center_radius.w);",
    )
    .replace(
      "let hx1 = surfaceHeightField(wpos.x + sample_radius, wpos.y);",
      "let hx1 = placement_ground_height(wpos.x + sample_radius, wpos.y, params.center_radius.w);",
    )
    .replace(
      "let hz0 = surfaceHeightField(wpos.x, wpos.y - sample_radius);",
      "let hz0 = placement_ground_height(wpos.x, wpos.y - sample_radius, params.center_radius.w);",
    )
    .replace(
      "let hz1 = surfaceHeightField(wpos.x, wpos.y + sample_radius);",
      "let hz1 = placement_ground_height(wpos.x, wpos.y + sample_radius, params.center_radius.w);",
    )
    .replace(
      "let start_height = surfaceHeightField(start_xz.x, start_xz.y) + 18.0;",
      "let start_height = placement_ground_height(start_xz.x, start_xz.y, params.center_radius.w) + 18.0;",
    )
    .replace(
      "let sample_ground_height = surfaceHeightField(sample_xz.x, sample_xz.y);",
      "let sample_ground_height = placement_ground_height(sample_xz.x, sample_xz.y, params.center_radius.w);",
    )
    .replace(
      "let raw_height = surfaceHeightField(wpos.x, wpos.y);",
      "let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);",
    )
    .replace(
      "let height = tree_hydrology_ground_height(raw_height, hydro);",
      "let height = raw_height;",
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
  return composeShader("grass ring shader", [grassBindings, terrainCommon, placementHeight, withRiverEcologyConstants(withConservativeGrassFrustum(grassRingEntry))]);
}

export function composeStoneScatterShader(): string {
  return composeShader("stone scatter shader", [stoneBindings, terrainCommon, placementHeight, withRiverEcologyConstants(stoneScatterEntry)]);
}

export function composeTreeRingShader(workgroupSize = 64): string {
  const size = workgroupSize === 32 || workgroupSize === 64 || workgroupSize === 128 || workgroupSize === 256
    ? workgroupSize
    : 64;
  const treeEntry = withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry)).replace(
    /const TREE_WORKGROUP_SIZE: u32 = \d+u;/,
    `const TREE_WORKGROUP_SIZE: u32 = ${size}u;`,
  );
  return composeShader("tree ring shader", [treeBindings, terrainCommon, placementHeight, treeEntry]);
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
