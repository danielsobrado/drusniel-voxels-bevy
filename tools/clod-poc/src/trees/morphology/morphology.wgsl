const MORPH_AGE_CHANNEL: u32 = 0x1101u;
const MORPH_LEAN_CHANNEL: u32 = 0x1102u;
const MORPH_CROWN_BIAS_CHANNEL: u32 = 0x1103u;
const MORPH_WIDTH_CHANNEL: u32 = 0x1104u;
const MORPH_FLAT_CHANNEL: u32 = 0x1105u;
const MORPH_DROOP_CHANNEL: u32 = 0x1106u;
const MORPH_HEALTH_CHANNEL: u32 = 0x1107u;
const MORPH_FLARE_CHANNEL: u32 = 0x1108u;
const MORPH_FOLIAGE_CARD_CHANNEL: u32 = 0x1109u;

struct TreeInstanceMorphologyGpu {
  morphology0: vec4<f32>,
  morphology1: vec4<f32>,
  morphology2: vec4<f32>,
};

struct TreeMorphologyVertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

fn clamp_tree_morphology(value: TreeInstanceMorphologyGpu) -> TreeInstanceMorphologyGpu {
  let lean = clamp_length(value.morphology0.yz, 0.22);
  let bias = clamp_length(value.morphology1.xy, 0.35);
  return TreeInstanceMorphologyGpu(
    vec4<f32>(clamp(value.morphology0.x, 0.0, 1.0), lean, clamp(value.morphology0.w, 0.0, 1.0)),
    vec4<f32>(bias, clamp(value.morphology1.z, 0.82, 1.18), clamp(value.morphology1.w, 0.82, 1.20)),
    vec4<f32>(
      clamp(value.morphology2.x, -0.18, 0.32),
      clamp(value.morphology2.y, 0.55, 1.15),
      clamp(value.morphology2.z, 0.75, 1.35),
      clamp(value.morphology2.w, 0.65, 1.35),
    ),
  );
}

fn clamp_length(value: vec2<f32>, maximum: f32) -> vec2<f32> {
  let magnitude = length(value);
  return select(value, value * maximum / max(magnitude, 1e-6), magnitude > maximum);
}

fn deform_tree_morphology_vertex(
  base_position: vec3<f32>,
  base_normal: vec3<f32>,
  height01: f32,
  branch_level: f32,
  branch_phase: f32,
  root_mask: f32,
  tree_height: f32,
  crown_radius: f32,
  crown_start01: f32,
  packed: TreeInstanceMorphologyGpu,
) -> TreeMorphologyVertex {
  let morphology = clamp_tree_morphology(packed);
  let age = morphology.morphology0.x;
  let height_scale = mix(0.72, 1.08, smoothstep(0.0, 1.0, age));
  let radius_scale = mix(0.78, 1.12, age);
  let crown_blend = smoothstep(crown_start01 - 0.10, crown_start01, height01);
  var position = vec3<f32>(base_position.x * radius_scale, base_position.y * height_scale, base_position.z * radius_scale);
  position.y = position.y + mix(0.08, -0.04, age) * tree_height * crown_blend;
  position.xz = position.xz * mix(1.0, morphology.morphology1.z, crown_blend);
  let crown_center_y = mix(crown_start01, 1.0, 0.5) * tree_height * height_scale;
  position.y = mix(position.y, crown_center_y + (position.y - crown_center_y) * morphology.morphology1.w, crown_blend);
  position.xz = position.xz * mix(1.0, morphology.morphology2.z, root_mask);
  let droop_weight = branch_level * height01 * height01;
  let radial_length = length(position.xz);
  let fallback_direction = vec2<f32>(cos(branch_phase * 6.28318530718), sin(branch_phase * 6.28318530718));
  let branch_direction = select(fallback_direction, position.xz / max(radial_length, 1e-6), radial_length > 1e-6);
  position.y = position.y - morphology.morphology2.x * droop_weight * tree_height;
  position.xz = position.xz + branch_direction * morphology.morphology2.x * droop_weight * tree_height * 0.18;
  let bias_weight = smoothstep(crown_start01, 1.0, height01);
  position.xz = position.xz + morphology.morphology1.xy * crown_radius * bias_weight;
  let lean_weight = height01 * height01;
  position.xz = position.xz + morphology.morphology0.yz * position.y * lean_weight;
  var normal = vec3<f32>(base_normal.x / radius_scale, base_normal.y / height_scale, base_normal.z / radius_scale);
  normal.y = normal.y - dot(morphology.morphology0.yz * 3.0 * lean_weight, normal.xz);
  return TreeMorphologyVertex(position, normalize(normal));
}
