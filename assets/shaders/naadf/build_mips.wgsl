#import "shaders/naadf/common.wgsl" NAADF_MIP_CELLS_PER_CHUNK, NAADF_MIP_LEVEL_COUNT, NAADF_NODE_CHILDREN, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, naadf_make_mip_bounds_record, naadf_make_traversal_record, naadf_payload_material_id, naadf_traversal_state

@group(3) @binding(6) var<storage, read_write> naadf_mip_traversal_records: array<u32>;
@group(3) @binding(7) var<storage, read_write> naadf_mip_payload_records: array<u32>;
@group(3) @binding(8) var<storage, read_write> naadf_mip_bounds_records: array<u32>;
@group(3) @binding(30) var<storage, read> naadf_build_slots: array<u32>;

@compute @workgroup_size(1, 1, 1)
fn build_naadf_mips(@builtin(workgroup_id) workgroup_id: vec3<u32>) {
    let chunk_slot = naadf_build_slots[workgroup_id.x];
    for (var parent_level = 1u; parent_level < NAADF_MIP_LEVEL_COUNT; parent_level = parent_level + 1u) {
        naadf_build_mip_level(chunk_slot, parent_level);
    }
    for (var level = 0u; level < NAADF_MIP_LEVEL_COUNT; level = level + 1u) {
        naadf_build_mip_bounds_level(chunk_slot, level);
    }
}

fn naadf_build_mip_level(chunk_slot: u32, parent_level: u32) {
    let child_level = parent_level - 1u;
    let parent_axis = naadf_mip_axis(parent_level);
    let parent_count = parent_axis * parent_axis * parent_axis;
    for (var parent_index = 0u; parent_index < parent_count; parent_index = parent_index + 1u) {
        let parent_local = naadf_unflatten_mip(parent_index, parent_axis);
        let summary = naadf_summarize_mip_children(chunk_slot, child_level, parent_local * 2u);
        let output_index = naadf_mip_record_index(chunk_slot, parent_level, parent_local);
        naadf_mip_traversal_records[output_index] = naadf_make_traversal_record(
            summary.state,
            summary.child_mask,
            summary.thin_or_hole,
        );
        naadf_mip_payload_records[output_index] = summary.material_id;
    }
}

struct NaadfMipSummary {
    state: u32,
    child_mask: u32,
    thin_or_hole: bool,
    material_id: u32,
}

fn naadf_summarize_mip_children(
    chunk_slot: u32,
    child_level: u32,
    child_origin: vec3<u32>,
) -> NaadfMipSummary {
    var occupied_count = 0u;
    var child_mask = 0u;
    var first_material = 0u;
    var uniform_material = true;
    var all_full = true;
    var bit = 0u;

    for (var z = 0u; z < 2u; z = z + 1u) {
        for (var y = 0u; y < 2u; y = y + 1u) {
            for (var x = 0u; x < 2u; x = x + 1u) {
                let child = child_origin + vec3<u32>(x, y, z);
                let child_index = naadf_mip_record_index(chunk_slot, child_level, child);
                let child_state = naadf_traversal_state(naadf_mip_traversal_records[child_index]);
                let occupied = child_state != NAADF_NODE_UNIFORM_EMPTY;
                if occupied {
                    occupied_count = occupied_count + 1u;
                    child_mask = child_mask | (1u << bit);
                    let material_id = naadf_payload_material_id(naadf_mip_payload_records[child_index]);
                    if first_material == 0u {
                        first_material = material_id;
                    } else if material_id != 0u && material_id != first_material {
                        uniform_material = false;
                    }
                }
                all_full = all_full && child_state == NAADF_NODE_UNIFORM_FULL;
                bit = bit + 1u;
            }
        }
    }

    var state = NAADF_NODE_CHILDREN;
    if occupied_count == 0u {
        state = NAADF_NODE_UNIFORM_EMPTY;
    } else if occupied_count == 8u && all_full && uniform_material {
        state = NAADF_NODE_UNIFORM_FULL;
    }

    let thin_or_hole = state == NAADF_NODE_CHILDREN &&
        (occupied_count <= 2u || occupied_count >= 6u || !all_full);
    return NaadfMipSummary(state, child_mask, thin_or_hole, first_material);
}

fn naadf_mip_axis(level: u32) -> u32 {
    if level == 0u { return 16u; }
    if level == 1u { return 8u; }
    if level == 2u { return 4u; }
    if level == 3u { return 2u; }
    return 1u;
}

fn naadf_mip_offset(level: u32) -> u32 {
    if level == 0u { return 0u; }
    if level == 1u { return 4096u; }
    if level == 2u { return 4608u; }
    if level == 3u { return 4672u; }
    return 4680u;
}

fn naadf_mip_record_index(chunk_slot: u32, level: u32, local: vec3<u32>) -> u32 {
    let axis = naadf_mip_axis(level);
    return chunk_slot * NAADF_MIP_CELLS_PER_CHUNK +
        naadf_mip_offset(level) +
        local.x + local.y * axis + local.z * axis * axis;
}

fn naadf_unflatten_mip(index: u32, axis: u32) -> vec3<u32> {
    return vec3<u32>(index % axis, (index / axis) % axis, index / (axis * axis));
}

fn naadf_build_mip_bounds_level(chunk_slot: u32, level: u32) {
    let axis = naadf_mip_axis(level);
    let count = axis * axis * axis;
    for (var cell_index = 0u; cell_index < count; cell_index = cell_index + 1u) {
        let local = naadf_unflatten_mip(cell_index, axis);
        let record_index = naadf_mip_record_index(chunk_slot, level, local);
        if naadf_traversal_state(naadf_mip_traversal_records[record_index]) != NAADF_NODE_UNIFORM_EMPTY {
            naadf_mip_bounds_records[record_index] = 0u;
        } else {
            naadf_mip_bounds_records[record_index] = naadf_make_mip_bounds_record(
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(-1, 0, 0)),
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(1, 0, 0)),
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(0, -1, 0)),
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(0, 1, 0)),
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(0, 0, -1)),
                naadf_count_empty_mip_cells(chunk_slot, level, local, vec3<i32>(0, 0, 1)),
            );
        }
    }
}

fn naadf_count_empty_mip_cells(
    chunk_slot: u32,
    level: u32,
    local: vec3<u32>,
    step: vec3<i32>,
) -> u32 {
    let axis = i32(naadf_mip_axis(level));
    var cursor = vec3<i32>(local) + step;
    var count = 0u;
    for (var i = 0u; i < 31u; i = i + 1u) {
        if any(cursor < vec3<i32>(0)) || any(cursor >= vec3<i32>(axis)) {
            break;
        }
        let record_index = naadf_mip_record_index(chunk_slot, level, vec3<u32>(cursor));
        if naadf_traversal_state(naadf_mip_traversal_records[record_index]) != NAADF_NODE_UNIFORM_EMPTY {
            break;
        }
        count = count + 1u;
        cursor = cursor + step;
    }
    return count;
}
