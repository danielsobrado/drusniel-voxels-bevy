export function treeRingSixSpeciesParamsStructSource(): string {
  return `struct TreeRingParams {
  center_radius: vec4<f32>,
  lod: vec4<f32>,
  settings_a: vec4<f32>,
  settings_b: vec4<f32>,
  settings_c: vec4<f32>,
  settings_d: vec4<f32>,
  settings_e: vec4<f32>,
  species_weights_a: vec4<f32>,
  species_weights_b: vec4<f32>,
  terrain_visibility: vec4<f32>,
  terrain_visibility_u: vec4<u32>,
  index_counts_a: vec4<u32>,
  index_counts_b: vec4<u32>,
  index_counts_c: vec4<u32>,
  index_counts_d: vec4<u32>,
  index_counts_e: vec4<u32>,
  index_counts_f: vec4<u32>,
  settings_u: vec4<u32>,
  material_density: vec4<f32>,
  species_material_oak: vec4<f32>,
  species_material_pine: vec4<f32>,
  species_material_dead: vec4<f32>,
  species_material_birch: vec4<f32>,
  species_material_willow: vec4<f32>,
  species_material_spruce: vec4<f32>,
  planes: array<vec4<f32>, 6>,
  shadow_planes: array<vec4<f32>, 24>,
  hydro_atlas: vec4<f32>,
};`;
}

export function treeRingSixSpeciesIndexCountSource(): string {
  return `fn index_count_for_group(group: u32) -> u32 {
  if (group < 4u) { return params.index_counts_a[group]; }
  if (group < 8u) { return params.index_counts_b[group - 4u]; }
  if (group < 12u) { return params.index_counts_c[group - 8u]; }
  if (group < 16u) { return params.index_counts_d[group - 12u]; }
  if (group < 20u) { return params.index_counts_e[group - 16u]; }
  return params.index_counts_f[group - 20u];
}`;
}

export function replaceTreeRingParamsStruct(source: string, replacement: string): string {
  const start = source.indexOf("struct TreeRingParams {");
  const end = source.indexOf("struct TreeHydrologySample", start);
  if (start < 0 || end < 0) return source;
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}

export function replaceTreeRingIndexCountFunction(source: string, replacement: string): string {
  const start = source.indexOf("fn index_count_for_group(");
  const end = source.indexOf("fn in_frustum(", start);
  if (start < 0 || end < 0) return source;
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}
