export function treeRingSixSpeciesWgslSelectionSource(): string {
  return `fn species_material_bias(species: u32, materials: vec4<f32>) -> f32 {
  if (species == 0u) { return max(0.0, dot(materials, params.species_material_oak)); }
  if (species == 1u) { return max(0.0, dot(materials, params.species_material_pine)); }
  if (species == 2u) { return max(0.0, dot(materials, params.species_material_dead)); }
  if (species == 3u) { return max(0.0, dot(materials, params.species_material_birch)); }
  if (species == 4u) { return max(0.0, dot(materials, params.species_material_willow)); }
  return max(0.0, dot(materials, params.species_material_spruce));
}

fn select_species(wc: vec2<f32>, wpos: vec2<f32>, height: f32, normal_y: f32) -> u32 {
  let base_a = max(params.species_weights_a, vec4<f32>(0.0));
  let base_b = max(params.species_weights_b.xy, vec2<f32>(0.0));
  let total_base = base_a.x + base_a.y + base_a.z + base_a.w + base_b.x + base_b.y;
  if (total_base <= 0.0) { return 0xffffffffu; }
  let cfg = tree_accept_params_from_uniforms();
  let materials = tree_material_weights(height, normal_y);
  let height_band = smoothstep(cfg.lowland_height_m, cfg.highland_height_m, height);
  let moisture = 1.0 - clamp((height - WATER_LEVEL) / 42.0, 0.0, 1.0);
  let slope_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let ridge_stress = 1.0 - slope_health;
  let clump = clamp(tree_parent_clump_mask(wpos, cfg), 0.0, 1.25);
  let old_age = smoothstep(0.58, 0.96, tree_hash(wc, 2309u));
  let oak = base_a.x
    * species_material_bias(0u, materials)
    * mix(1.45, 0.52, height_band)
    * mix(0.78, 1.28, moisture)
    * mix(0.82, 1.18, slope_health)
    * (1.0 - materials.y * 0.35)
    * mix(1.06, 0.82, old_age);
  let pine = base_a.y
    * species_material_bias(1u, materials)
    * mix(0.52, 1.62, height_band)
    * mix(0.84, 1.16, 1.0 - moisture)
    * mix(0.78, 1.25, slope_health)
    * (1.0 + materials.y * 0.22)
    * mix(1.02, 0.9, old_age);
  let dead = base_a.z
    * species_material_bias(2u, materials)
    * (0.38 + clump * 0.28 + ridge_stress * 0.42 + materials.y * 0.32 + old_age * 0.72);
  let birch = base_a.w
    * species_material_bias(3u, materials)
    * mix(1.28, 0.68, height_band)
    * mix(0.86, 1.16, moisture)
    * mix(0.76, 1.22, slope_health)
    * mix(1.02, 1.14, 1.0 - clump);
  let willow = base_b.x
    * species_material_bias(4u, materials)
    * mix(1.58, 0.28, height_band)
    * mix(0.58, 1.72, moisture)
    * mix(1.26, 0.62, ridge_stress)
    * (1.0 + materials.z * 0.42);
  let spruce = base_b.y
    * species_material_bias(5u, materials)
    * mix(0.42, 1.76, height_band)
    * mix(0.92, 1.18, 1.0 - moisture)
    * mix(0.70, 1.34, slope_health)
    * (1.0 + materials.y * 0.28 + materials.w * 0.36);
  let weights_a = max(vec4<f32>(oak, pine, dead, birch), vec4<f32>(0.0));
  let weights_b = max(vec2<f32>(willow, spruce), vec2<f32>(0.0));
  let total = weights_a.x + weights_a.y + weights_a.z + weights_a.w + weights_b.x + weights_b.y;
  if (total <= 0.0) { return 0xffffffffu; }
  let roll = tree_hash(wc, 409u) * total;
  if (roll < weights_a.x) { return 0u; }
  if (roll < weights_a.x + weights_a.y) { return 1u; }
  if (roll < weights_a.x + weights_a.y + weights_a.z) { return 2u; }
  if (roll < weights_a.x + weights_a.y + weights_a.z + weights_a.w) { return 3u; }
  if (roll < weights_a.x + weights_a.y + weights_a.z + weights_a.w + weights_b.x) { return 4u; }
  return 5u;
}`;
}

export function replaceTreeRingSpeciesSelection(source: string, replacement: string): string {
  const start = source.indexOf("fn species_material_bias(");
  const morphologyStart = source.indexOf("fn tree_species_morphology_runtime(", start);
  const end = morphologyStart >= 0 ? morphologyStart : source.indexOf("fn append_tree(", start);
  if (start < 0 || end < 0) return source;
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}
