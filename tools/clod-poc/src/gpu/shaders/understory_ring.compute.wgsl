const UNDERSTORY_WORKGROUP_SIZE: u32 = 64u;
const UNDERSTORY_GROUP_COUNT: u32 = 6u;
const UNDERSTORY_INDIRECT_STRIDE_U32: u32 = 5u;
const UNDERSTORY_CLASS_STRIDE_F32: u32 = 8u;

struct UnderstoryRingParams {
  center_radius: vec4<f32>,
  accept_a: vec4<f32>,
  accept_b: vec4<f32>,
  ecology_a: vec4<f32>,
  ecology_b: vec4<f32>,
  ecology_c: vec4<f32>,
  settings_u: vec4<u32>,
  settings_extra: vec4<u32>,
  class_index_counts: vec4<u32>,
  planes: array<vec4<f32>, 6>,
};

@group(0) @binding(0) var<uniform> params: UnderstoryRingParams;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> out_cell: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> class_params: array<f32>;

// --- Hash functions (matching tree_noise.ts hash2 / valueNoise2D / fractalNoise2D) ---

fn understory_hash2(x: f32, z: f32, seed: u32) -> f32 {
  var v: u32 = seed;
  v = v ^ (u32(i32(floor(x))) * 0x27d4eb2du);
  v = v ^ (u32(i32(floor(z))) * 0x165667b1u);
  v = (v ^ (v >> 15u)) * 0x85ebca6bu;
  v = (v ^ (v >> 13u)) * 0xc2b2ae35u;
  return f32(v ^ (v >> 16u)) / 4294967296.0;
}

fn understory_smoothstep01(t_in: f32) -> f32 {
  let t = clamp(t_in, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn understory_smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
  if (abs(edge1 - edge0) <= 1e-8) {
    if (value < edge0) { return 0.0; }
    return 1.0;
  }
  return understory_smoothstep01(clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0));
}

fn understory_valueNoise2D(x: f32, z: f32, scaleM: f32, seed: u32) -> f32 {
  let scale = max(0.001, scaleM);
  let nx = x / scale;
  let nz = z / scale;
  let x0 = i32(floor(nx));
  let z0 = i32(floor(nz));
  let tx = understory_smoothstep01(nx - f32(x0));
  let tz = understory_smoothstep01(nz - f32(z0));
  let a = understory_hash2(f32(x0), f32(z0), seed);
  let b = understory_hash2(f32(x0 + 1), f32(z0), seed);
  let c = understory_hash2(f32(x0), f32(z0 + 1), seed);
  let d = understory_hash2(f32(x0 + 1), f32(z0 + 1), seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

fn understory_fractalNoise2D(x: f32, z: f32, scaleM: f32, seed: u32, octaves: i32) -> f32 {
  var amplitude: f32 = 0.5;
  var frequency: f32 = 1.0;
  var total: f32 = 0.0;
  var weight: f32 = 0.0;
  for (var octave: i32 = 0; octave < octaves; octave++) {
    total += understory_valueNoise2D(x * frequency, z * frequency, scaleM, seed + u32(octave) * 1013u) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  if (weight > 0.0) { return clamp(total / weight, 0.0, 1.0); }
  return 0.0;
}

// --- PCG 2D hash for toroidal cell placement (matching understory_ring_math.ts) ---

fn understory_pcg2d(cell: vec2<f32>, salt: u32) -> vec2<f32> {
  let M = 1664525u;
  let C = 1013904223u;
  let a0 = u32(cell.x + 40000.0 + f32(salt & 0x3fffu));
  let b0 = u32(cell.y + 40000.0 + f32((salt >> 14u) & 0x3fffu));
  let a1 = a0 * M + C;
  let b1 = b0 * M + C;
  let a2 = a1 + b1 * M;
  let b2 = b1 + a2 * M;
  let a3 = a2 ^ (a2 >> 16u);
  let b3 = b2 ^ (b2 >> 16u);
  let a4 = a3 + b3 * M;
  let b4 = b3 + a4 * M;
  let a5 = a4 ^ (a4 >> 16u);
  let b5 = b4 ^ (b4 >> 16u);
  let inv = 1.0 / 16777216.0;
  return vec2<f32>(f32(a5 & 0xffffffu) * inv, f32(b5 & 0xffffffu) * inv);
}

fn understory_hash(cell: vec2<f32>, salt: u32) -> f32 {
  let seed = f32(params.settings_u.z);
  let salt_f = f32(salt);
  return fract(sin(dot(cell + vec2<f32>(seed + salt_f, seed * 0.37 + salt_f * 1.17), vec2<f32>(41.3, 289.1))) * 43758.5453);
}

// --- Toroidal cell derivation ---

fn understory_world_cell(slot_x: u32, slot_z: u32, grid: u32, cell_size: f32, camera_xz: vec2<f32>) -> vec2<f32> {
  let safe_grid = max(grid, 1u);
  let safe_cell = max(cell_size, 0.001);
  let sx = f32(slot_x);
  let sz = f32(slot_z);
  let cam_cell = camera_xz / safe_cell;
  return vec2<f32>(
    round((cam_cell.x - sx) / f32(safe_grid)) * f32(safe_grid) + sx,
    round((cam_cell.y - sz) / f32(safe_grid)) * f32(safe_grid) + sz,
  );
}

fn understory_world_cell_from_slot(slot: u32, grid: u32, cell_size: f32, camera_xz: vec2<f32>) -> vec2<f32> {
  let safe_grid = max(grid, 1u);
  return understory_world_cell(slot % safe_grid, slot / safe_grid, safe_grid, cell_size, camera_xz);
}

// --- Terrain accept gate (matching understory_ring_math.ts understoryRingTerrainGate) ---

fn understory_material_weights(height: f32, normal_y: f32) -> vec4<f32> {
  _ = normal_y;
  let sand = max(0.0, 1.0 - abs(height - WATER_LEVEL) / 6.0);
  let snow = max(0.0, (height - 88.0) / 22.0);
  let rock = clamp((height - 48.0) / 34.0, 0.0, 1.0) * (1.0 - snow);
  let grass = max(0.0, 1.0 - sand - snow - rock);
  let sum = max(1e-5, grass + rock + sand + snow);
  return vec4<f32>(grass, rock, sand, snow) / sum;
}

fn understory_terrain_gate(height: f32, normal_y: f32, wpos: vec2<f32>) -> f32 {
  if (height < params.accept_a.y || height > params.accept_a.z) { return -1.0; }
  if (normal_y < params.accept_a.w) { return -1.0; }
  let weights = understory_material_weights(height, normal_y);
  let ground_weight = weights.x + weights.y * 0.25;
  if (ground_weight < params.accept_b.x) { return -1.0; }
  return clamp(ground_weight, 0.0, 1.0);
}

// --- Ecology sample (port of sampleUnderstoryEcology from understory_ecology.ts) ---

struct EcologySample {
  forest_influence: f32,
  forest_edge: f32,
  shade: f32,
  moisture: f32,
  clearing: f32,
  density: f32,
  deadfall: f32,
};

fn sample_understory_ecology(x: f32, z: f32, height: f32, normal_y: f32, ground_weight: f32) -> EcologySample {
  var result: EcologySample;
  let ecology_enabled = params.accept_b.z;
  if (ecology_enabled < 0.5) {
    result.forest_influence = 0.5;
    result.forest_edge = 0.5;
    result.shade = 0.5;
    result.moisture = 0.5;
    result.clearing = 0.5;
    result.density = clamp(ground_weight, 0.0, 1.0);
    result.deadfall = 0.25;
    return result;
  }

  let seed = params.settings_u.z;
  let forest_scale = params.ecology_a.x;
  let edge_width = max(0.001, params.ecology_a.y);
  let moisture_scale = params.ecology_a.z;
  let density_scale = params.ecology_a.w;
  let moisture_strength = params.ecology_b.x;
  let shade_strength = params.ecology_b.y;
  let clearing_pref = params.ecology_b.z;
  let density_strength = params.ecology_b.w;
  let deadfall_bias = params.ecology_c.x;
  let min_height = params.accept_a.y;
  let max_height = params.accept_a.z;
  let slope_min = params.accept_a.w;

  // Forest influence: noise fallback (self-contained, no tree texture)
  let base_forest = understory_fractalNoise2D(x, z, forest_scale, seed + 21001u, 3);
  let forest_influence = understory_smoothstep(0.32, 0.78, base_forest);

  // Forest edge
  let outer = understory_smoothstep(0.32 - 12.0 / edge_width, 0.32 + 12.0 / edge_width, base_forest);
  let inner = understory_smoothstep(0.78 - 12.0 / edge_width, 0.78 + 12.0 / edge_width, base_forest);
  let forest_edge = clamp(min(outer, 1.0 - inner) * 1.45, 0.0, 1.0);

  // Moisture
  let moisture_noise = understory_fractalNoise2D(x + 557.3, z - 811.9, moisture_scale, seed + 22003u, 3);
  let height_damp = 1.0 - understory_smoothstep(min_height, max_height, height) * 0.3;
  let moisture = clamp(0.5 + (moisture_noise - 0.5) * moisture_strength + height_damp * 0.16, 0.0, 1.0);

  // Shade
  let shade = clamp(forest_influence * shade_strength + forest_edge * 0.2, 0.0, 1.0);

  // Clearing
  let clearing_noise = understory_valueNoise2D(x - 109.2, z + 73.4, forest_scale * 1.9, seed + 23011u);
  let clearing = clamp((1.0 - forest_influence) * 0.75 + forest_edge * clearing_pref + clearing_noise * 0.2, 0.0, 1.0);

  // Density
  let density_noise = understory_fractalNoise2D(x, z, density_scale, seed + 24001u, 2);
  let terrain_density = clamp(ground_weight * understory_smoothstep(slope_min, 1.0, normal_y), 0.0, 1.0);
  let density = clamp(terrain_density * (1.0 - density_strength + density_noise * density_strength), 0.0, 1.0);

  // Deadfall
  let old_forest = understory_valueNoise2D(x + 991.7, z - 219.5, forest_scale * 2.4, seed + 25013u);
  let deadfall = clamp(forest_influence * (0.35 + old_forest * deadfall_bias) + shade * 0.18, 0.0, 1.0);

  result.forest_influence = forest_influence;
  result.forest_edge = forest_edge;
  result.shade = shade;
  result.moisture = moisture;
  result.clearing = clearing;
  result.density = density;
  result.deadfall = deadfall;
  return result;
}

// --- Acceptance probability (matching understory_ring_math.ts understoryRingAcceptance) ---

fn understory_acceptance(ecology: EcologySample) -> f32 {
  return clamp(
    0.06 +
    ecology.density * 0.42 +
    ecology.forest_influence * 0.28 +
    ecology.forest_edge * 0.22 +
    ecology.clearing * 0.12,
    0.0, 1.0,
  );
}

// --- Per-class weight (port of understoryClassWeight from understory_ecology.ts) ---

fn understory_class_weight(group: u32, ecology: EcologySample, height: f32, normal_y: f32) -> f32 {
  let base = group * UNDERSTORY_CLASS_STRIDE_F32;
  let cfg_weight = class_params[base + 0u];
  let cfg_density = class_params[base + 1u];
  let cfg_shade_pref = class_params[base + 2u];
  let cfg_moisture_pref = class_params[base + 3u];
  let cfg_edge_bias = class_params[base + 4u];
  let cfg_height_code = class_params[base + 5u];
  let cfg_enabled = class_params[base + 6u];

  if (cfg_enabled < 0.5 || cfg_weight <= 0.0 || cfg_density <= 0.0) { return 0.0; }

  let min_height = params.accept_a.y;
  let max_height = params.accept_a.z;
  let slope_min = params.accept_a.w;
  let height_t = understory_smoothstep(min_height, max_height, height);

  // height weight from heightPreferenceCode: -1=low, 0=any, 1=high
  var height_weight: f32;
  if (cfg_height_code < -0.5) {
    height_weight = 1.0 - height_t * 0.75;
  } else if (cfg_height_code > 0.5) {
    height_weight = 0.35 + height_t * 0.9;
  } else {
    height_weight = 1.0;
  }

  let shade_weight = 1.0 - abs(ecology.shade - cfg_shade_pref) * 0.9;
  let moisture_weight = 1.0 - abs(ecology.moisture - cfg_moisture_pref) * 0.85;
  let edge_weight = 1.0 + ecology.forest_edge * cfg_edge_bias;

  // Per-class modifiers (group indices: 0=shrub, 1=fern, 2=sapling, 3=flower, 4=dead_log, 5=stump)
  var clearing_weight: f32 = 1.0;
  if (group == 3u) { clearing_weight = 0.45 + ecology.clearing * 1.35; }
  var canopy_weight: f32 = 1.0;
  if (group == 2u) { canopy_weight = 0.42 + ecology.forest_influence * 0.9 + ecology.forest_edge * 0.35; }
  var fern_weight: f32 = 1.0;
  if (group == 1u) { fern_weight = 0.35 + ecology.shade * 0.85 + ecology.moisture * 0.75; }
  var dead_weight: f32 = 1.0;
  if (group == 4u || group == 5u) { dead_weight = 0.25 + ecology.deadfall * 1.5; }

  let slope_weight = clamp(normal_y / max(0.001, slope_min), 0.2, 1.15);

  return max(0.0,
    cfg_weight * cfg_density * ecology.density *
    height_weight * shade_weight * moisture_weight * edge_weight *
    clearing_weight * canopy_weight * fern_weight * dead_weight * slope_weight
  );
}

// --- Frustum test ---

fn in_frustum(center: vec3<f32>, slack: f32) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.planes[p];
    if (dot(plane.xyz, center) + plane.w < -slack) {
      return false;
    }
  }
  return true;
}

// --- Cell append ---

fn append_understory_cell(group: u32, wc: vec2<f32>, height: f32, normal_y: f32) {
  let max_per_group = params.settings_u.x;
  if (max_per_group == 0u) { return; }
  let slot = atomicAdd(&counters[group], 1u);
  if (slot >= max_per_group) { return; }
  let out_index = group * max_per_group + slot;
  out_cell[out_index] = vec4<f32>(wc.x, wc.y, height, normal_y);
}

// --- Per-slot processing ---

fn process_understory_slot(slot: u32) {
  let grid = params.settings_u.y;
  let max_per_group = params.settings_u.x;
  if (slot >= grid * grid || max_per_group == 0u) { return; }

  let cell_size = params.accept_a.x;
  let wc = understory_world_cell_from_slot(slot, grid, cell_size, params.center_radius.xy);
  let jitter = understory_pcg2d(wc, 1103u);
  let wpos = (wc + jitter) * cell_size;

  let world_max = params.center_radius.w;
  if (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= world_max || wpos.y >= world_max) { return; }

  let dist = distance(wpos, params.center_radius.xy);
  if (dist > params.center_radius.z) { return; }

  let height = surfaceHeightField(wpos.x, wpos.y);
  if (!in_frustum(vec3<f32>(wpos.x, height + 4.0, wpos.y), 8.0)) { return; }
  let normal = normalize(densityGradient(wpos.x, height, wpos.y));
  let ground = understory_terrain_gate(height, normal.y, wpos);
  if (ground < 0.0) { return; }

  // Ecology acceptance roll
  let ecology = sample_understory_ecology(wpos.x, wpos.y, height, normal.y, ground);
  let acceptance = understory_acceptance(ecology);
  if (understory_hash(wc, 809u) >= acceptance) { return; }

  // Ecology gate: minTreeInfluence
  let min_tree_influence = params.accept_b.y;
  if (ecology.forest_influence < min_tree_influence) { return; }

  // Class selection: weighted roll across 6 classes
  var total_weight: f32 = 0.0;
  var weights: array<f32, 6>;
  for (var g: u32 = 0u; g < UNDERSTORY_GROUP_COUNT; g++) {
    weights[g] = understory_class_weight(g, ecology, height, normal.y);
    total_weight += weights[g];
  }
  if (total_weight <= 0.0) { return; }

  let roll = understory_hash(wc, 409u) * total_weight;
  var selected_group: u32 = 0u;
  var cursor: f32 = roll;
  for (var g: u32 = 0u; g < UNDERSTORY_GROUP_COUNT; g++) {
    cursor -= weights[g];
    if (cursor <= 0.0) {
      selected_group = g;
      break;
    }
  }

  // Class density gate
  let class_density = class_params[selected_group * UNDERSTORY_CLASS_STRIDE_F32 + 1u];
  if (understory_hash(wc, 509u) > min(1.0, class_density)) { return; }

  // Coarser sub-grid hash gate for large classes (dead_log, stump)
  // Approximates O(n²) cross-class spacing dedup per the plan.
  if (selected_group == 4u || selected_group == 5u) {
    let parent = floor(wc / 2.0);
    let parent_hash = understory_pcg2d(parent, params.settings_u.z + 7777u).x;
    if (parent_hash > 0.55) { return; }
  }

  append_understory_cell(selected_group, wc, height, normal.y);
}

// --- Entry points ---

@compute @workgroup_size(UNDERSTORY_WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < UNDERSTORY_GROUP_COUNT) {
    atomicStore(&counters[i], 0u);
  }
  if (i < UNDERSTORY_GROUP_COUNT * UNDERSTORY_INDIRECT_STRIDE_U32) {
    indirect_args[i] = 0u;
  }
}

@compute @workgroup_size(UNDERSTORY_WORKGROUP_SIZE)
fn understory_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  process_understory_slot(id.x);
}

fn write_draw_args(group: u32, index_count: u32, instance_count: u32) {
  let base = group * UNDERSTORY_INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = min(instance_count, params.settings_u.x);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = group * params.settings_u.x;
}

@compute @workgroup_size(UNDERSTORY_WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  let group = id.x;
  if (group >= UNDERSTORY_GROUP_COUNT) { return; }
  var index_count: u32;
  if (group < 4u) {
    index_count = params.class_index_counts[group];
  } else {
    index_count = params.settings_extra[group - 4u];
  }
  write_draw_args(group, index_count, atomicLoad(&counters[group]));
}
