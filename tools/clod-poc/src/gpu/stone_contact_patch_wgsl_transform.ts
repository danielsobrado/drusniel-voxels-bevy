const CONTACT_CONFIG_FIELD = "  contact_patch_config: vec4<f32>,\n";
const CONTACT_BINDING = "@group(0) @binding(17) var<storage, read_write> grass_contact_patches: array<vec4<f32>>;\n";

const CONTACT_SELECTION_WGSL = `
const STONE_CONTACT_PATCH_CAPACITY: u32 = 32u;
const STONE_CONTACT_INVALID_INDEX: u32 = 0xffffffffu;

var<workgroup> contact_best_distance: array<f32, 64>;
var<workgroup> contact_best_index: array<u32, 64>;
var<workgroup> contact_selected_index: array<u32, 32>;

fn contact_candidate_is_better(distance_sq: f32, index: u32, best_distance_sq: f32, best_index: u32) -> bool {
  return distance_sq < best_distance_sq || (distance_sq == best_distance_sq && index < best_index);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn select_contact_patches(@builtin(local_invocation_index) local_index: u32) {
  let class_cap = params.view_counts.z;
  let configured_count = min(
    STONE_CONTACT_PATCH_CAPACITY,
    u32(max(params.contact_patch_config.z, 0.0)),
  );

  if (local_index < STONE_CONTACT_PATCH_CAPACITY) {
    contact_selected_index[local_index] = STONE_CONTACT_INVALID_INDEX;
    if (params.contact_patch_config.w <= 0.5 || configured_count == 0u) {
      grass_contact_patches[local_index] = vec4<f32>(0.0);
    }
  }
  workgroupBarrier();

  if (params.contact_patch_config.w <= 0.5 || configured_count == 0u || class_cap == 0u) {
    return;
  }

  for (var rank = 0u; rank < STONE_CONTACT_PATCH_CAPACITY; rank = rank + 1u) {
    var best_distance_sq = 3.402823466e+38;
    var best_index = STONE_CONTACT_INVALID_INDEX;

    if (rank < configured_count) {
      let source_count = class_cap * 3u;
      for (var flat_index = local_index; flat_index < source_count; flat_index = flat_index + WORKGROUP_SIZE) {
        let cls = flat_index / class_cap;
        let slot = flat_index % class_cap;
        let produced = min(atomicLoad(&counters[cls + 1u]), class_cap);
        if (slot >= produced) {
          continue;
        }

        var already_selected = false;
        for (var selected_rank = 0u; selected_rank < rank; selected_rank = selected_rank + 1u) {
          if (contact_selected_index[selected_rank] == flat_index) {
            already_selected = true;
          }
        }
        if (already_selected) {
          continue;
        }

        let source = source_a[flat_index];
        let delta = source.xz - params.ring.xy;
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
        grass_contact_patches[rank] = vec4<f32>(0.0);
      } else {
        let cls = selected / class_cap;
        let source = source_a[selected];
        let radius = max(0.01, source.w * class_base_radius(cls));
        let inner_radius = radius * max(params.contact_patch_config.x, 0.0);
        let outer_radius = max(inner_radius + 0.001, radius * max(params.contact_patch_config.y, 0.0));
        grass_contact_patches[rank] = vec4<f32>(source.x, source.z, inner_radius, outer_radius);
      }
    }
    workgroupBarrier();
  }
}
`;

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
  const withSelection = withBinding.replace(marker, `${CONTACT_SELECTION_WGSL}\n${marker}`);
  if (withSelection === withBinding) throw new Error("stone contact WGSL transform could not add selection pass");
  return withSelection;
}
