const DRESSING_WORKGROUP_SIZE: u32 = 64u;
const DRESSING_CLASS_COUNT: u32 = 29u;
const DRESSING_LOD_COUNT: u32 = 3u;
const DRESSING_GROUP_COUNT: u32 = DRESSING_CLASS_COUNT * DRESSING_LOD_COUNT;
const DRESSING_RECORD_VEC4S: u32 = 3u;
const DRESSING_INDIRECT_WORDS: u32 = 5u;
const DRESSING_PARENT_OWNERSHIP: u32 = 1u;
const DRESSING_ATTACHMENT_ID_CHANNEL: u32 = 0x2101u;

struct DressingParams {
  center_radius: vec4<f32>,
  settings: vec4<u32>,
  hydro_atlas: vec4<f32>,
  canopy_meta: vec4<f32>,
  category_ranges: vec4<u32>,
  persistence_meta: vec4<u32>,
};

struct DressingClassParams {
  class_meta: vec4<u32>,
  grid_density: vec4<f32>,
  lod: vec4<f32>,
  rules: vec4<f32>,
  index_counts: vec4<u32>,
};

struct DressingEnvironment {
  height: f32,
  normal: vec3<f32>,
  water_depth: f32,
  shore_distance: f32,
  wet_mask: f32,
  canopy_density: f32,
  forest_edge: f32,
  understory_density: f32,
  grass_suppression: f32,
  canopy_height: f32,
  broadleaf: f32,
  conifer: f32,
  competition: f32,
};

struct DressingRecord {
  position_scale: vec4<f32>,
  rotation_environment: vec4<f32>,
  identity: vec4<u32>,
};

@group(0) @binding(0) var<uniform> params: DressingParams;
@group(0) @binding(1) var<storage, read> class_params: array<DressingClassParams>;
@group(0) @binding(2) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(4) var<storage, read_write> out_records: array<vec4<f32>>;
@group(0) @binding(5) var hydro_texture: texture_2d<f32>;
@group(0) @binding(6) var hydro_sampler: sampler;
@group(0) @binding(9) var hydro_atlas_texture: texture_2d<f32>;
@group(0) @binding(13) var canopy_aux_texture: texture_2d<f32>;
@group(0) @binding(14) var canopy_detail_texture: texture_2d<f32>;
@group(0) @binding(15) var<storage, read> persistent_exclusions: array<vec2<u32>>;

fn placement_hydro_atlas_params() -> vec4<f32> {
  return params.hydro_atlas;
}

fn dressing_hash01(cell: vec2<i32>, class_id: u32, channel: u32) -> f32 {
  let value = vegetationValueHash(
    params.settings.x,
    VEGETATION_DRESSING_CATEGORY,
    params.settings.w,
    cell,
    channel ^ (class_id * 0x9e3779b9u),
  );
  return f32(value.x & 0xffffffu) / 16777216.0;
}

fn dressing_stable_identity(cell: vec2<i32>, class_id: u32) -> vec2<u32> {
  return vegetationStableIdentity(
    params.settings.x,
    VEGETATION_DRESSING_CATEGORY,
    params.settings.w,
    cell,
    class_id + 1u,
  );
}

fn dressing_identity_roll(identity: vec2<u32>, salt: u32) -> vec2<f32> {
  return treePcg2d01(bitcast<i32>(identity.x), bitcast<i32>(identity.y), salt);
}

fn dressing_identity_roll_swapped(identity: vec2<u32>, salt: u32) -> vec2<f32> {
  return treePcg2d01(bitcast<i32>(identity.y), bitcast<i32>(identity.x), salt);
}

fn dressing_identity_before(left: vec2<u32>, right: vec2<u32>) -> bool {
  return left.y < right.y || (left.y == right.y && left.x < right.x);
}

fn dressing_persistent_excluded(identity: vec2<u32>) -> bool {
  var lower = 0u;
  var upper = params.persistence_meta.x;
  loop {
    if (lower >= upper) { break; }
    let middle = lower + (upper - lower) / 2u;
    let candidate = persistent_exclusions[middle];
    if (candidate.x == identity.x && candidate.y == identity.y) { return true; }
    if (dressing_identity_before(candidate, identity)) {
      lower = middle + 1u;
    } else {
      upper = middle;
    }
  }
  return false;
}

fn dressing_class_for_slot(slot: u32) -> u32 {
  for (var class_index = 0u; class_index < DRESSING_CLASS_COUNT; class_index = class_index + 1u) {
    let class_meta = class_params[class_index].class_meta;
    if (slot >= class_meta.z && slot < class_meta.z + class_meta.w) { return class_index; }
  }
  return 0xffffffffu;
}

fn dressing_candidate_cell(slot: u32, class_index: u32) -> vec2<i32> {
  let class_data = class_params[class_index];
  let local = slot - class_data.class_meta.z;
  let grid = max(1u, u32(class_data.grid_density.x));
  let spacing = max(0.5, class_data.grid_density.y);
  let slot_x = local % grid;
  let slot_z = local / grid;
  let center_cell = vec2<i32>(floor(params.center_radius.xy / spacing));
  let origin = center_cell - vec2<i32>(i32(grid / 2u));
  return origin + vec2<i32>(i32(slot_x), i32(slot_z));
}

fn dressing_canopy_sample(wpos: vec2<f32>) -> array<vec4<f32>, 2> {
  var result = array<vec4<f32>, 2>();
  if (params.canopy_meta.z < 0.5) {
    result[0] = vec4<f32>(0.0);
    result[1] = vec4<f32>(0.0);
    return result;
  }
  let dims = textureDimensions(canopy_aux_texture);
  let world_size = max(1.0, params.canopy_meta.x);
  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let coord = vec2<i32>(clamp(vec2<f32>(dims) * uv, vec2<f32>(0.0), vec2<f32>(dims - vec2<u32>(1u))));
  result[0] = textureLoad(canopy_aux_texture, coord, 0);
  result[1] = textureLoad(canopy_detail_texture, coord, 0);
  return result;
}

fn dressing_environment(wpos: vec2<f32>, spacing: f32) -> DressingEnvironment {
  let world_size = max(1.0, params.center_radius.w);
  let height = placement_ground_height(wpos.x, wpos.y, world_size);
  let normal = placement_ground_normal(wpos.x, wpos.y, world_size, max(0.75, spacing * 0.35));
  let hydro = placement_sample_hydro_bilinear(wpos.x, wpos.y, world_size);
  let hydro_valid = placement_hydro_sample_valid(hydro);
  let water_depth = select(0.0, max(0.0, hydro.x - height), hydro_valid);
  let shore_distance = select(9999.0, hydro.w, hydro_valid);
  let wet_mask = select(0.0, clamp(hydro.y, 0.0, 1.0), hydro_valid);
  let canopy = dressing_canopy_sample(wpos);
  return DressingEnvironment(
    height,
    normal,
    water_depth,
    shore_distance,
    wet_mask,
    canopy[0].x,
    canopy[0].y,
    canopy[0].z,
    canopy[0].w,
    canopy[1].x * params.canopy_meta.y,
    canopy[1].y,
    canopy[1].z,
    canopy[1].w,
  );
}

fn dressing_environment_acceptance(class_id: u32, env: DressingEnvironment) -> f32 {
  let slope = clamp(1.0 - env.normal.y, 0.0, 1.0);
  let dry = 1.0 - smoothstep(0.02, 0.18, env.water_depth);
  let shore_near = 1.0 - smoothstep(2.0, 7.0, abs(env.shore_distance));
  let shade = clamp(env.canopy_density * 0.65 + env.competition * 0.35, 0.0, 1.0);
  let exposed = clamp(1.0 - shade, 0.0, 1.0);

  if (class_id <= 5u) { return dry * smoothstep(0.55, 0.9, env.normal.y) * mix(0.75, 1.2, shade); }
  if (class_id == 6u) { return dry * shore_near * smoothstep(0.78, 0.96, env.normal.y); }
  if (class_id == 7u) { return dry * smoothstep(0.12, 0.55, slope); }
  if (class_id == 15u) { return dry * smoothstep(0.28, 0.78, shade); }
  if (class_id == 16u) { return dry * smoothstep(0.30, 0.78, exposed) * smoothstep(0.08, 0.55, slope); }
  if (class_id == 17u) { return dry * env.broadleaf * mix(0.65, 1.1, shade); }
  if (class_id == 18u) { return dry * env.conifer * mix(0.65, 1.1, shade); }
  if (class_id == 19u || class_id == 20u) { return dry * mix(0.45, 1.0, shade); }
  if (class_id == 21u) { return dry * smoothstep(0.18, 0.72, slope); }
  if (class_id == 22u) { return max(shore_near * smoothstep(0.08, 0.45, env.wet_mask), smoothstep(0.72, 1.0, env.wet_mask)); }
  if (class_id == 23u) { return max(shore_near, smoothstep(0.65, 0.95, env.wet_mask)); }
  if (class_id == 24u) { return dry * shore_near * smoothstep(0.8, 0.98, env.normal.y); }
  if (class_id == 25u) { return dry * shore_near * smoothstep(0.25, 0.75, shade); }
  if (class_id == 26u) { return dry * smoothstep(0.35, 0.75, shade) * smoothstep(0.15, 0.65, env.forest_edge); }
  if (class_id == 27u) { return dry * smoothstep(0.25, 0.75, slope) * mix(0.45, 1.0, shade); }
  if (class_id == 28u) { return dry * exposed * (1.0 - env.grass_suppression); }
  return 0.0;
}

fn dressing_lod(distance_m: f32, lod: vec4<f32>) -> u32 {
  if (distance_m <= lod.x) { return 0u; }
  if (distance_m <= lod.y) { return 1u; }
  return 2u;
}

fn dressing_group(class_id: u32, lod: u32) -> u32 {
  return class_id * DRESSING_LOD_COUNT + min(lod, DRESSING_LOD_COUNT - 1u);
}

fn write_dressing_record(group: u32, record: DressingRecord) {
  let capacity = params.settings.z;
  let slot = atomicAdd(&counters[group], 1u);
  if (slot >= capacity) { return; }
  let base = (group * capacity + slot) * DRESSING_RECORD_VEC4S;
  out_records[base] = record.position_scale;
  out_records[base + 1u] = record.rotation_environment;
  out_records[base + 2u] = bitcast<vec4<f32>>(record.identity);
}

fn emit_dressing_instance(
  class_id: u32,
  position: vec3<f32>,
  scale: f32,
  yaw: f32,
  env: DressingEnvironment,
  identity: vec2<u32>,
) {
  let distance_m = distance(position.xz, params.center_radius.xy);
  let class_data = class_params[class_id];
  if (distance_m > min(params.center_radius.z, class_data.lod.w)) { return; }
  let lod = dressing_lod(distance_m, class_data.lod);
  let record = DressingRecord(
    vec4<f32>(position, scale),
    vec4<f32>(yaw, env.normal.y, max(env.wet_mask, clamp(1.0 - abs(env.shore_distance) / 4.0, 0.0, 1.0)), dressing_hash01(vec2<i32>(floor(position.xz)), class_id, VEGETATION_AGE_CHANNEL)),
    vec4<u32>(VEGETATION_DRESSING_CATEGORY, class_id, identity.x, identity.y),
  );
  write_dressing_record(dressing_group(class_id, lod), record);
}

fn emit_paired_stump(
  parent_class: u32,
  parent_cell: vec2<i32>,
  parent_position: vec3<f32>,
  parent_scale: f32,
  parent_yaw: f32,
  env: DressingEnvironment,
) {
  if (parent_class > 2u) { return; }
  let stump_class = select(3u, 4u, parent_class != 0u);
  let parent_identity = dressing_stable_identity(parent_cell, parent_class);
  let stump_identity = treePcg2dU32(bitcast<i32>(parent_identity.x), bitcast<i32>(parent_identity.y), 0x3201u);
  let pairing_roll = dressing_identity_roll(stump_identity, 0x4305u).x;
  let pairing_probability = class_params[parent_class].rules.w;
  if (pairing_roll >= pairing_probability) { return; }
  let offset = vec2<f32>(cos(parent_yaw), sin(parent_yaw)) * 1.5;
  let stump_xz = parent_position.xz - offset;
  let stump_env = dressing_environment(stump_xz, max(0.5, class_params[stump_class].grid_density.y));
  let position = vec3<f32>(stump_xz.x, stump_env.height + class_params[stump_class].grid_density.w * parent_scale * 0.85, stump_xz.y);
  emit_dressing_instance(stump_class, position, parent_scale * 0.85, parent_yaw, stump_env, stump_identity);
}

fn emit_parent_attachments(
  parent_class: u32,
  parent_cell: vec2<i32>,
  parent_position: vec3<f32>,
  parent_scale: f32,
  parent_yaw: f32,
  parent_identity: vec2<u32>,
  env: DressingEnvironment,
) {
  let decay = select(0.18, select(0.58, 0.9, parent_class == 2u || parent_class == 4u || parent_class == 5u), parent_class == 1u);
  let attachment_roll = dressing_hash01(parent_cell, parent_class, DRESSING_ATTACHMENT_ID_CHANNEL);
  var attachment_class = 0xffffffffu;
  if (decay > 0.72 && attachment_roll < 0.24) { attachment_class = 8u; }
  else if (decay > 0.55 && attachment_roll < 0.42) { attachment_class = 9u; }
  else if (env.canopy_density > 0.35 && attachment_roll < 0.58) { attachment_class = 10u; }
  else if (env.competition > 0.45 && attachment_roll < 0.68) { attachment_class = 12u; }
  else if (env.canopy_height > 8.0 && attachment_roll < 0.76) { attachment_class = 13u; }
  else if (env.understory_density > 0.35 && attachment_roll < 0.86) { attachment_class = 14u; }
  if (attachment_class >= DRESSING_CLASS_COUNT) { return; }
  let seed_hash = treePcg2dU32(
    bitcast<i32>(params.settings.x),
    bitcast<i32>(rotateLeft(params.settings.x, 16u) ^ params.settings.w),
    VEGETATION_DOMAIN_CHANNEL ^ VEGETATION_DRESSING_CATEGORY,
  );
  let parent_hash = treePcg2dU32(
    bitcast<i32>(parent_identity.x),
    bitcast<i32>(parent_identity.y),
    seed_hash.x ^ seed_hash.y,
  );
  let attachment_channel = DRESSING_ATTACHMENT_ID_CHANNEL ^ ((attachment_class + 1u) * 0x9e3779b9u);
  let attachment_identity = treePcg2dU32(
    bitcast<i32>(parent_hash.x),
    bitcast<i32>(parent_hash.y),
    attachment_channel ^ seed_hash.y,
  );
  let angle = parent_yaw + dressing_hash01(parent_cell, attachment_class, VEGETATION_ROTATION_CHANNEL) * 6.28318530718;
  let radial = select(0.22, 0.45, attachment_class == 13u || attachment_class == 14u);
  let local_height = select(0.15, select(0.65, 1.35, attachment_class == 13u), attachment_class == 8u || attachment_class == 10u);
  let position = parent_position + vec3<f32>(cos(angle) * radial * parent_scale, local_height * parent_scale, sin(angle) * radial * parent_scale);
  emit_dressing_instance(attachment_class, position, parent_scale * 0.78, angle, env, attachment_identity);
}

@compute @workgroup_size(DRESSING_WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index < DRESSING_GROUP_COUNT) { atomicStore(&counters[index], 0u); }
  if (index < DRESSING_GROUP_COUNT * DRESSING_INDIRECT_WORDS) { indirect_args[index] = 0u; }
}

fn generate_and_compact(slot: u32) {
  if (slot >= params.settings.y) { return; }
  let class_index = dressing_class_for_slot(slot);
  if (class_index >= DRESSING_CLASS_COUNT) { return; }
  let class_data = class_params[class_index];
  if (class_data.class_meta.y == DRESSING_PARENT_OWNERSHIP || class_data.class_meta.w == 0u) { return; }
  let cell = dressing_candidate_cell(slot, class_index);
  let identity = dressing_stable_identity(cell, class_index);
  if (class_data.class_meta.y == 0u && dressing_persistent_excluded(identity)) { return; }
  let acceptance_rolls = dressing_identity_roll(identity, 0x4100u + class_index + 1u);
  let spacing = max(0.5, class_data.grid_density.y);
  let jitter_x = acceptance_rolls.y;
  let jitter_z = dressing_identity_roll_swapped(identity, 0x4201u).x;
  let jitter = vec2<f32>(jitter_x, jitter_z);
  let wpos = (vec2<f32>(cell) + vec2<f32>(0.1) + jitter * 0.8) * spacing;
  if (distance(wpos, params.center_radius.xy) > params.center_radius.z) { return; }
  let finite_world = params.canopy_meta.w < 0.5;
  if (finite_world && (wpos.x < 0.0 || wpos.y < 0.0 || wpos.x > params.center_radius.w || wpos.y > params.center_radius.w)) { return; }
  let environment = dressing_environment(wpos, spacing);
  if (placement_ground_height_is_excluded(environment.height)) { return; }
  let probability = class_data.grid_density.z * dressing_environment_acceptance(class_index, environment);
  if (acceptance_rolls.x >= probability) { return; }
  let random_yaw = dressing_identity_roll(identity, 0x4202u).x * 6.28318530718;
  let downhill_yaw = atan2(-environment.normal.z, -environment.normal.x);
  let yaw = select(
    select(downhill_yaw, 3.14159265359 * 0.18, acceptance_rolls.y >= 0.65),
    random_yaw,
    acceptance_rolls.y >= 0.85,
  );
  if (class_index <= 2u) {
    let axis = vec2<f32>(cos(yaw), sin(yaw)) * 1.5;
    let endpoint_a = placement_ground_height(wpos.x + axis.x, wpos.y + axis.y, max(1.0, params.center_radius.w));
    let endpoint_b = placement_ground_height(wpos.x - axis.x, wpos.y - axis.y, max(1.0, params.center_radius.w));
    if (abs(endpoint_a - environment.height) > 0.35 || abs(endpoint_b - environment.height) > 0.35) { return; }
  }
  let scale = 0.75 + dressing_identity_roll_swapped(identity, 0x4203u).y * 0.65;
  let position = vec3<f32>(wpos.x, environment.height + class_data.grid_density.w * scale, wpos.y);
  emit_dressing_instance(class_index, position, scale, yaw, environment, identity);
  if (class_data.class_meta.y == 0u) {
    emit_paired_stump(class_index, cell, position, scale, yaw, environment);
    emit_parent_attachments(class_index, cell, position, scale, yaw, identity, environment);
  }
}

@compute @workgroup_size(DRESSING_WORKGROUP_SIZE)
fn generate_persistent(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = params.category_ranges.x + gid.x;
  if (slot >= params.category_ranges.y) { return; }
  generate_and_compact(slot);
}

@compute @workgroup_size(DRESSING_WORKGROUP_SIZE)
fn generate_terrain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = params.category_ranges.z + gid.x;
  if (slot >= params.category_ranges.w) { return; }
  generate_and_compact(slot);
}

@compute @workgroup_size(DRESSING_WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) gid: vec3<u32>) {
  let group = gid.x;
  if (group >= DRESSING_GROUP_COUNT) { return; }
  let class_id = group / DRESSING_LOD_COUNT;
  let lod = group % DRESSING_LOD_COUNT;
  let base = group * DRESSING_INDIRECT_WORDS;
  indirect_args[base] = class_params[class_id].index_counts[lod];
  indirect_args[base + 1u] = min(atomicLoad(&counters[group]), params.settings.z);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = group * params.settings.z;
}
