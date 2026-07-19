import {
  GRASS_CONTACT_FIELD_OFFSET,
  GRASS_CONTACT_METADATA_INDEX,
  GRASS_CONTACT_PATCH_OFFSET,
  GRASS_CONTACT_PATCH_CAPACITY,
  readGrassContactSettings,
} from "../grass/grass_contact_patches.js";

const CONTACT_CONFIG_FIELD = "  contact_patch_config: vec4<f32>,\n";
const CONTACT_BINDING = "@group(0) @binding(17) var<storage, read_write> grass_contact_patches: array<vec4<f32>>;\n";

function contactSelectionWgsl(): string {
  const settings = readGrassContactSettings();
  return `
const STONE_CONTACT_PATCH_CAPACITY: u32 = ${GRASS_CONTACT_PATCH_CAPACITY}u;
const STONE_CONTACT_METADATA_INDEX: u32 = ${GRASS_CONTACT_METADATA_INDEX}u;
const STONE_CONTACT_PATCH_OFFSET: u32 = ${GRASS_CONTACT_PATCH_OFFSET}u;
const STONE_CONTACT_FIELD_OFFSET: u32 = ${GRASS_CONTACT_FIELD_OFFSET}u;
const STONE_CONTACT_FIELD_GRID: u32 = ${settings.fieldGrid}u;
const STONE_CONTACT_FIELD_CELL_M: f32 = ${settings.fieldCellM};
const STONE_CONTACT_INVALID_INDEX: u32 = 0xffffffffu;

var<workgroup> contact_best_distance: array<f32, 64>;
var<workgroup> contact_best_index: array<u32, 64>;
var<workgroup> contact_selected_index: array<u32, ${GRASS_CONTACT_PATCH_CAPACITY}>;

fn contact_candidate_is_better(distance_sq: f32, index: u32, best_distance_sq: f32, best_index: u32) -> bool {
  return distance_sq < best_distance_sq || (distance_sq == best_distance_sq && index < best_index);
}

fn contact_source_index(candidate_slot: u32, large_count: u32, medium_count: u32, class_cap: u32) -> u32 {
  if (candidate_slot < large_count) {
    return candidate_slot;
  }
  if (candidate_slot < large_count + medium_count) {
    return class_cap + candidate_slot - large_count;
  }
  return class_cap * 2u + candidate_slot - large_count - medium_count;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn select_contact_patches(@builtin(local_invocation_index) local_index: u32) {
  let class_cap = params.view_counts.z;
  let configured_count = min(
    STONE_CONTACT_PATCH_CAPACITY,
    u32(max(params.contact_patch_config.z, 0.0)),
  );
  let contact_enabled = params.contact_patch_config.w > 0.5;

  if (local_index == 0u) {
    let active_grid = select(0.0, f32(STONE_CONTACT_FIELD_GRID), contact_enabled);
    grass_contact_patches[STONE_CONTACT_METADATA_INDEX] = vec4<f32>(
      params.ring.xy,
      STONE_CONTACT_FIELD_CELL_M,
      active_grid,
    );
  }
  if (local_index < STONE_CONTACT_PATCH_CAPACITY) {
    contact_selected_index[local_index] = STONE_CONTACT_INVALID_INDEX;
    if (!contact_enabled || configured_count == 0u) {
      grass_contact_patches[STONE_CONTACT_PATCH_OFFSET + local_index] = vec4<f32>(0.0);
    }
  }
  workgroupBarrier();

  if (!contact_enabled || configured_count == 0u || class_cap == 0u) {
    return;
  }

  let large_count = min(atomicLoad(&counters[1u]), class_cap);
  let medium_count = min(atomicLoad(&counters[2u]), class_cap);
  let small_count = min(atomicLoad(&counters[3u]), class_cap);
  let accepted_count = large_count + medium_count + small_count;

  for (var rank = 0u; rank < STONE_CONTACT_PATCH_CAPACITY; rank = rank + 1u) {
    var best_distance_sq = 3.402823466e+38;
    var best_index = STONE_CONTACT_INVALID_INDEX;

    if (rank < configured_count) {
      for (var candidate_slot = local_index; candidate_slot < accepted_count; candidate_slot = candidate_slot + WORKGROUP_SIZE) {
        let flat_index = contact_source_index(candidate_slot, large_count, medium_count, class_cap);
        var already_selected = false;
        for (var selected_rank = 0u; selected_rank < rank; selected_rank = selected_rank + 1u) {
          if (contact_selected_index[selected_rank] == flat_index) {
            already_selected = true;
          }
        }
        if (already_selected) {
          continue;
        }

        let stone_data = source_a[flat_index];
        let delta = stone_data.xz - params.ring.xy;
        let distance_sq = dot(delta, delta);
        if (contact_candidate_is_better(distance_sq, flat_index, best_distance_sq, best_index)) {
          best_distance_sq = distance_sq;
          best_index = flat_index;
        }
      }
    }

    contact_best_distance[local_index] = best_distance_sq;
    contact_best_index[local_index] = best_index;
    workgroupBarrier();

    var stride = WORKGROUP_SIZE / 2u;
    loop {
      if (stride == 0u) {
        break;
      }
      if (local_index < stride) {
        let candidate_distance = contact_best_distance[local_index + stride];
        let candidate_index = contact_best_index[local_index + stride];
        if (contact_candidate_is_better(
          candidate_distance,
          candidate_index,
          contact_best_distance[local_index],
          contact_best_index[local_index],
        )) {
          contact_best_distance[local_index] = candidate_distance;
          contact_best_index[local_index] = candidate_index;
        }
      }
      workgroupBarrier();
      stride = stride / 2u;
    }

    if (local_index == 0u) {
      let selected = contact_best_index[0];
      contact_selected_index[rank] = selected;
      if (rank >= configured_count || selected == STONE_CONTACT_INVALID_INDEX) {
        grass_contact_patches[STONE_CONTACT_PATCH_OFFSET + rank] = vec4<f32>(0.0);
      } else {
        let cls = selected / class_cap;
        let stone_data = source_a[selected];
        let radius = max(0.01, stone_data.w * class_base_radius(cls));
        let inner_radius = radius * max(params.contact_patch_config.x, 0.0);
        let outer_radius = max(inner_radius + 0.001, radius * max(params.contact_patch_config.y, 0.0));
        grass_contact_patches[STONE_CONTACT_PATCH_OFFSET + rank] = vec4<f32>(
          stone_data.x,
          stone_data.z,
          inner_radius,
          outer_radius,
        );
      }
    }
    workgroupBarrier();
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn rasterize_contact_field(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let field_index = global_id.x;
  let field_cell_count = STONE_CONTACT_FIELD_GRID * STONE_CONTACT_FIELD_GRID;
  if (field_index >= field_cell_count) {
    return;
  }

  let cell_x = field_index % STONE_CONTACT_FIELD_GRID;
  let cell_z = field_index / STONE_CONTACT_FIELD_GRID;
  let grid_half = f32(STONE_CONTACT_FIELD_GRID) * 0.5;
  let world_xz = params.ring.xy + vec2<f32>(
    (f32(cell_x) + 0.5 - grid_half) * STONE_CONTACT_FIELD_CELL_M,
    (f32(cell_z) + 0.5 - grid_half) * STONE_CONTACT_FIELD_CELL_M,
  );

  var suppress = 0.0;
  var trample = 0.0;
  var splay_sum = vec2<f32>(0.0);
  for (var patch_index = 0u; patch_index < STONE_CONTACT_PATCH_CAPACITY; patch_index = patch_index + 1u) {
    let patch = grass_contact_patches[STONE_CONTACT_PATCH_OFFSET + patch_index];
    if (patch.w <= 0.0) {
      continue;
    }
    let delta = world_xz - patch.xy;
    let distance_m = length(delta);
    let inner_radius = max(patch.z, 0.001);
    let outer_radius = max(patch.w, inner_radius + 0.001);
    let core = 1.0 - smoothstep(0.0, inner_radius, distance_m);
    let contact = 1.0 - smoothstep(inner_radius, outer_radius, distance_m);
    let influence = max(core, contact);
    let direction = delta / max(distance_m, 0.001);
    suppress = max(suppress, core);
    trample = max(trample, influence);
    splay_sum += direction * influence * (1.0 - core * 0.65);
  }

  let splay_length = length(splay_sum);
  let splay = select(vec2<f32>(0.0), splay_sum / splay_length, splay_length > 0.001);
  grass_contact_patches[STONE_CONTACT_FIELD_OFFSET + field_index] = vec4<f32>(
    suppress,
    max(suppress, trample),
    splay,
  );
}
`;
}

export function withStoneGrassContactPatches(source: string): string {
  if (source.includes("fn select_contact_patches")) return source;
  const withConfig = source.replace(
    "  hydro_atlas: vec4<f32>,\n",
    `  hydro_atlas: vec4<f32>,\n${CONTACT_CONFIG_FIELD}`,
  );
  if (withConfig === source) throw new Error("stone contact WGSL transform could not add contact config");

  const withBinding = withConfig.replace(
    "@group(0) @binding(14) var<storage, read_write> source_b: array<vec4<f32>>;\n",
    `@group(0) @binding(14) var<storage, read_write> source_b: array<vec4<f32>>;\n${CONTACT_BINDING}`,
  );
  if (withBinding === withConfig) throw new Error("stone contact WGSL transform could not add contact buffer");

  const marker = "fn view_frustum_accept(center: vec3<f32>, radius: f32) -> bool {";
  const withSelection = withBinding.replace(marker, `${contactSelectionWgsl()}\n${marker}`);
  if (withSelection === withBinding) throw new Error("stone contact WGSL transform could not add contact passes");
  return withSelection;
}
