#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_CHUNK_BOUND_OFFSET_NEG_X, NAADF_CHUNK_BOUND_OFFSET_NEG_Y, NAADF_CHUNK_BOUND_OFFSET_NEG_Z, NAADF_CHUNK_BOUND_OFFSET_POS_X, NAADF_CHUNK_BOUND_OFFSET_POS_Y, NAADF_CHUNK_BOUND_OFFSET_POS_Z, NAADF_MIP_BOUND_OFFSET_NEG_X, NAADF_MIP_BOUND_OFFSET_NEG_Y, NAADF_MIP_BOUND_OFFSET_NEG_Z, NAADF_MIP_BOUND_OFFSET_POS_X, NAADF_MIP_BOUND_OFFSET_POS_Y, NAADF_MIP_BOUND_OFFSET_POS_Z, NAADF_MIP_CELLS_PER_CHUNK, NAADF_MIP_LEVEL_0_OFFSET, NAADF_MIP_LEVEL_1_OFFSET, NAADF_MIP_LEVEL_2_OFFSET, NAADF_MIP_LEVEL_3_OFFSET, NAADF_MIP_LEVEL_4_OFFSET, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, NAADF_PACKED_BLOCK_WORDS, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_BLOCK_AXIS, NAADF_VOXELS_PER_CHUNK, NAADF_VOXELS_PER_CHUNK_AXIS, naadf_node_payload, naadf_node_state, naadf_payload_material_id, naadf_traversal_state, naadf_traversal_thin_or_hole
#import "shaders/naadf/layout.wgsl" naadf_block_coord_for_voxel, naadf_block_index_in_chunk, naadf_chunk_world_origin, naadf_local_coord_in_block, naadf_voxel_index_in_chunk

@group(3) @binding(0) var<storage, read> naadf_voxel_records: array<u32>;
@group(3) @binding(1) var<storage, read> naadf_material_records: array<u32>;
@group(3) @binding(5) var<storage, read> naadf_block_records: array<u32>;
@group(3) @binding(6) var<storage, read> naadf_mip_traversal_records: array<u32>;
@group(3) @binding(7) var<storage, read> naadf_mip_payload_records: array<u32>;
@group(3) @binding(8) var<storage, read> naadf_mip_bounds_records: array<u32>;
@group(3) @binding(11) var<storage, read> naadf_chunk_records: array<u32>;

struct NaadfRay {
    origin: vec3<f32>,
    direction: vec3<f32>,
    max_distance: f32,
    purpose: u32,
};

struct NaadfHit {
    hit: u32,
    distance: f32,
    material_id: u32,
    steps: u32,
    world_voxel: vec3<i32>,
    local_voxel: vec3<u32>,
    normal: vec3<f32>,
    miss_reason: u32,
};

const NAADF_MISS_REASON_NONE: u32 = 0u;
const NAADF_MISS_REASON_CLEAN_EXIT: u32 = 1u;
const NAADF_MISS_REASON_VOXEL_BUDGET: u32 = 2u;
const NAADF_MISS_REASON_CHUNK_BUDGET: u32 = 3u;
const NAADF_MISS_REASON_DISTANCE_CLAMP: u32 = 4u;
const NAADF_MISS_REASON_NO_LOOKUP: u32 = 5u;
const NAADF_RAY_PURPOSE_PREVIEW_PRIMARY: u32 = 5u;

fn trace_naadf(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> NaadfHit {
    if naadf_node_state(chunk_node) == NAADF_NODE_UNIFORM_FULL {
        let direction = normalize(ray.direction);
        let entry_t = naadf_ray_chunk_entry(ray.origin, direction, chunk_pos);
        if entry_t < 0.0 || entry_t > ray.max_distance {
            return naadf_make_miss(0u, NAADF_MISS_REASON_CLEAN_EXIT);
        }

        let hit_position = ray.origin + direction * (entry_t + 0.0001);
        let world_voxel = vec3<i32>(floor(hit_position));
        let chunk_origin = naadf_chunk_world_origin(chunk_pos);
        return naadf_make_hit(
            ray,
            hit_position,
            world_voxel,
            vec3<u32>(world_voxel - chunk_origin),
            naadf_chunk_entry_normal(hit_position, direction, chunk_pos),
            naadf_node_payload(chunk_node),
            0u,
        );
    }

    let direction = normalize(ray.direction);
    let step = naadf_step_direction(direction);
    let inv_direction_abs = naadf_t_delta(direction);
    let entry_t = naadf_ray_chunk_entry(ray.origin, direction, chunk_pos);
    if entry_t < 0.0 || entry_t > ray.max_distance {
        return naadf_make_miss(0u, NAADF_MISS_REASON_CLEAN_EXIT);
    }

    var traveled = max(entry_t, 0.0) + 0.0001;
    var normal = vec3<f32>(0.0);
    let chunk_origin = naadf_chunk_world_origin(chunk_pos);
    let chunk_end = chunk_origin + vec3<i32>(i32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let chunk_record_base = (voxel_base_record / NAADF_VOXELS_PER_CHUNK) *
        NAADF_PACKED_CHUNK_WORDS;
    let block_base_record = (voxel_base_record / NAADF_VOXELS_PER_CHUNK) *
        NAADF_BLOCKS_PER_CHUNK * NAADF_PACKED_BLOCK_WORDS;

    var steps_taken = 0u;
    var miss_reason = NAADF_MISS_REASON_VOXEL_BUDGET;
    for (var steps = 0u; steps < max_steps; steps = steps + 1u) {
        steps_taken = steps + 1u;
        if traveled > ray.max_distance {
            miss_reason = NAADF_MISS_REASON_DISTANCE_CLAMP;
            break;
        }
        let current_position = ray.origin + direction * traveled;
        let cell_position = current_position + normal * -0.5;
        let voxel = vec3<i32>(floor(cell_position));
        if all(voxel >= chunk_origin) && all(voxel < chunk_end) {
            if naadf_node_state(chunk_node) == NAADF_NODE_UNIFORM_EMPTY {
                let chunk_skip_record = naadf_chunk_records[chunk_record_base + 6u];
                let bounds_in_dir = naadf_chunk_skip_for_step(chunk_skip_record, step) *
                    vec3<u32>(NAADF_VOXELS_PER_CHUNK_AXIS) +
                    naadf_distance_to_chunk_edge(vec3<u32>(voxel - chunk_origin), step);
                let axis = naadf_step_axis_from_bounds(
                    current_position,
                    direction,
                    step,
                    normal,
                    bounds_in_dir,
                    inv_direction_abs,
                );
                if axis.axis == 0u {
                    normal = vec3<f32>(f32(-step.x), 0.0, 0.0);
                } else if axis.axis == 1u {
                    normal = vec3<f32>(0.0, f32(-step.y), 0.0);
                } else {
                    normal = vec3<f32>(0.0, 0.0, f32(-step.z));
                }
                traveled = traveled + max(axis.distance, 0.0001);
                continue;
            }

            let local = vec3<u32>(voxel - chunk_origin);
            let local_index = naadf_voxel_index_in_chunk(local);
            let voxel_record = naadf_voxel_records[voxel_base_record + local_index];
            if naadf_voxel_record_occupied(voxel_record) {
                return naadf_make_hit(
                    ray,
                    current_position,
                    voxel,
                    local,
                    naadf_hit_face_normal(current_position, voxel, direction),
                    naadf_material_records[material_base_record + local_index],
                    steps,
                );
            }

            let block_coord = naadf_block_coord_for_voxel(local);
            let block_index = naadf_block_index_in_chunk(block_coord);
            let block_record_base = block_base_record + block_index * NAADF_PACKED_BLOCK_WORDS;
            let block_node = naadf_block_records[block_record_base];
            let local_in_block = naadf_local_coord_in_block(local);
            var bounds_in_dir = naadf_directional_skip_for_step(voxel_record, step);
            if naadf_node_state(block_node) == NAADF_NODE_UNIFORM_EMPTY {
                let block_skip_record = naadf_block_records[block_record_base + 5u];
                bounds_in_dir = naadf_directional_skip_for_step(block_skip_record, step) *
                    vec3<u32>(NAADF_VOXELS_PER_BLOCK_AXIS) +
                    naadf_distance_to_block_edge(local_in_block, step);
            }

            let axis = naadf_step_axis_from_bounds(
                current_position,
                direction,
                step,
                normal,
                bounds_in_dir,
                inv_direction_abs,
            );
            let axis_distance = axis.distance;
            if axis.axis == 0u {
                normal = vec3<f32>(f32(-step.x), 0.0, 0.0);
            } else if axis.axis == 1u {
                normal = vec3<f32>(0.0, f32(-step.y), 0.0);
            } else {
                normal = vec3<f32>(0.0, 0.0, f32(-step.z));
            }
            traveled = traveled + max(axis_distance, 0.0001);
        } else {
            miss_reason = NAADF_MISS_REASON_CLEAN_EXIT;
            break;
        }
    }

    return naadf_make_miss(steps_taken, miss_reason);
}

// Surface normal of a hit voxel face, derived from the ray position relative
// to the voxel rather than the carried traversal step. The carried step normal
// flips at block/chunk skip boundaries (the skip axis depends on bound
// magnitude), which paints dark grid lines along those boundary planes.
fn naadf_hit_face_normal(
    position: vec3<f32>,
    voxel: vec3<i32>,
    direction: vec3<f32>,
) -> vec3<f32> {
    let local = position - vec3<f32>(voxel);
    let face_dist = min(abs(local), abs(local - vec3<f32>(1.0)));
    if face_dist.x <= face_dist.y && face_dist.x <= face_dist.z {
        return vec3<f32>(-sign(direction.x), 0.0, 0.0);
    }
    if face_dist.y <= face_dist.z {
        return vec3<f32>(0.0, -sign(direction.y), 0.0);
    }
    return vec3<f32>(0.0, 0.0, -sign(direction.z));
}

fn naadf_chunk_bounds_field(record: u32, offset: u32) -> u32 {
    return (record >> offset) & 0x1fu;
}

fn naadf_chunk_root_record(chunk_record_base: u32) -> u32 {
    return naadf_chunk_records[chunk_record_base + 0u];
}

fn naadf_chunk_record_valid(chunk_record_base: u32) -> bool {
    return naadf_chunk_records[chunk_record_base + 4u] == NAADF_BLOCKS_PER_CHUNK &&
        naadf_chunk_records[chunk_record_base + 5u] == NAADF_VOXELS_PER_CHUNK;
}

fn trace_naadf_chunk(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_index: u32,
    max_steps: u32,
) -> NaadfHit {
    let chunk_record_base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
    if chunk_record_base + 5u >= arrayLength(&naadf_chunk_records) {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }
    if !naadf_chunk_record_valid(chunk_record_base) {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }
    let voxel_base_record = chunk_index * NAADF_VOXELS_PER_CHUNK;
    return trace_naadf(
        ray,
        chunk_pos,
        naadf_chunk_root_record(chunk_record_base),
        voxel_base_record,
        voxel_base_record,
        max_steps,
    );
}

fn trace_naadf_chunk_lod(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_index: u32,
    max_steps: u32,
    cone_config: vec4<f32>,
) -> NaadfHit {
    let chunk_record_base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
    if chunk_record_base + 5u >= arrayLength(&naadf_chunk_records) {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }
    if !naadf_chunk_record_valid(chunk_record_base) {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }
    return trace_naadf_lod(
        ray,
        chunk_pos,
        naadf_chunk_root_record(chunk_record_base),
        chunk_index,
        max_steps,
        cone_config,
    );
}

fn trace_naadf_lod(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    chunk_index: u32,
    max_steps: u32,
    cone_config: vec4<f32>,
) -> NaadfHit {
    if ray.purpose == NAADF_RAY_PURPOSE_PREVIEW_PRIMARY {
        return trace_naadf(
            ray,
            chunk_pos,
            chunk_node,
            chunk_index * NAADF_VOXELS_PER_CHUNK,
            chunk_index * NAADF_VOXELS_PER_CHUNK,
            max_steps,
        );
    }

    if naadf_node_state(chunk_node) == NAADF_NODE_UNIFORM_FULL {
        return trace_naadf(
            ray,
            chunk_pos,
            chunk_node,
            chunk_index * NAADF_VOXELS_PER_CHUNK,
            chunk_index * NAADF_VOXELS_PER_CHUNK,
            max_steps,
        );
    }

    let direction = normalize(ray.direction);
    let step = naadf_step_direction(direction);
    let inv_direction_abs = naadf_t_delta(direction);
    let entry_t = naadf_ray_chunk_entry(ray.origin, direction, chunk_pos);
    if entry_t < 0.0 || entry_t > ray.max_distance {
        return naadf_make_miss(0u, NAADF_MISS_REASON_CLEAN_EXIT);
    }

    var traveled = max(entry_t, 0.0) + 0.0001;
    var normal = vec3<f32>(0.0);
    let chunk_origin = naadf_chunk_world_origin(chunk_pos);
    let chunk_end = chunk_origin + vec3<i32>(i32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let voxel_base_record = chunk_index * NAADF_VOXELS_PER_CHUNK;

    var steps_taken = 0u;
    var miss_reason = NAADF_MISS_REASON_VOXEL_BUDGET;
    for (var steps = 0u; steps < max_steps; steps = steps + 1u) {
        steps_taken = steps + 1u;
        if traveled > ray.max_distance {
            miss_reason = NAADF_MISS_REASON_DISTANCE_CLAMP;
            break;
        }
        let current_position = ray.origin + direction * traveled;
        let cell_position = current_position + normal * -0.5;
        let voxel = vec3<i32>(floor(cell_position));
        if any(voxel < chunk_origin) || any(voxel >= chunk_end) {
            miss_reason = NAADF_MISS_REASON_CLEAN_EXIT;
            break;
        }

        let local = vec3<u32>(voxel - chunk_origin);
        let selected_level = naadf_select_mip_level(ray, traveled, cone_config);
        let mip_level = min(selected_level, 4u);
        let mip_cell_size = 1u << mip_level;
        let mip_local = local / mip_cell_size;
        let mip_index = naadf_mip_record_index(chunk_index, mip_level, mip_local);
        let mip_record = naadf_mip_traversal_records[mip_index];
        let mip_state = naadf_traversal_state(mip_record);
        if mip_state == NAADF_NODE_UNIFORM_EMPTY {
            let mip_bounds = naadf_mip_bounds_for_step(naadf_mip_bounds_records[mip_index], step) *
                vec3<u32>(mip_cell_size) +
                naadf_distance_to_mip_cell_edge(local, mip_level, step);
            let axis = naadf_step_axis_from_bounds(
                current_position,
                direction,
                step,
                normal,
                mip_bounds,
                inv_direction_abs,
            );
            normal = naadf_normal_for_step_axis(axis.axis, step);
            traveled = traveled + max(axis.distance, 0.0001);
            continue;
        }
        if mip_level > 0u && mip_state == NAADF_NODE_UNIFORM_FULL {
            return naadf_make_hit(
                ray,
                current_position,
                voxel,
                local,
                naadf_hit_face_normal(current_position, voxel, direction),
                naadf_payload_material_id(naadf_mip_payload_records[mip_index]),
                steps,
            );
        }
        if mip_level > 0u &&
            ray.purpose != NAADF_RAY_PURPOSE_PREVIEW_PRIMARY &&
            !naadf_traversal_thin_or_hole(mip_record) {
            return naadf_make_hit(
                ray,
                current_position,
                voxel,
                local,
                naadf_hit_face_normal(current_position, voxel, direction),
                naadf_payload_material_id(naadf_mip_payload_records[mip_index]),
                steps,
            );
        }

        let local_index = naadf_voxel_index_in_chunk(local);
        let voxel_record = naadf_voxel_records[voxel_base_record + local_index];
        if naadf_voxel_record_occupied(voxel_record) {
            return naadf_make_hit(
                ray,
                current_position,
                voxel,
                local,
                naadf_hit_face_normal(current_position, voxel, direction),
                naadf_material_records[voxel_base_record + local_index],
                steps,
            );
        }

        let bounds_in_dir = naadf_directional_skip_for_step(voxel_record, step);
        let axis = naadf_step_axis_from_bounds(
            current_position,
            direction,
            step,
            normal,
            bounds_in_dir,
            inv_direction_abs,
        );
        normal = naadf_normal_for_step_axis(axis.axis, step);
        traveled = traveled + max(axis.distance, 0.0001);
    }

    return naadf_make_miss(steps_taken, miss_reason);
}

fn naadf_chunk_voxel_occupied_at(chunk_index: u32, local: vec3<u32>) -> bool {
    if any(local >= vec3<u32>(NAADF_VOXELS_PER_CHUNK_AXIS)) {
        return false;
    }
    let chunk_record_base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
    if chunk_record_base + 5u >= arrayLength(&naadf_chunk_records) {
        return false;
    }
    if !naadf_chunk_record_valid(chunk_record_base) {
        return false;
    }
    let voxel_index = chunk_index * NAADF_VOXELS_PER_CHUNK + naadf_voxel_index_in_chunk(local);
    if voxel_index >= arrayLength(&naadf_voxel_records) {
        return false;
    }
    return naadf_voxel_record_occupied(naadf_voxel_records[voxel_index]);
}

fn naadf_chunk_skip_for_step(record: u32, step: vec3<i32>) -> vec3<u32> {
    return vec3<u32>(
        naadf_chunk_bounds_field(record, select(NAADF_CHUNK_BOUND_OFFSET_NEG_X, NAADF_CHUNK_BOUND_OFFSET_POS_X, step.x > 0i)),
        naadf_chunk_bounds_field(record, select(NAADF_CHUNK_BOUND_OFFSET_NEG_Y, NAADF_CHUNK_BOUND_OFFSET_POS_Y, step.y > 0i)),
        naadf_chunk_bounds_field(record, select(NAADF_CHUNK_BOUND_OFFSET_NEG_Z, NAADF_CHUNK_BOUND_OFFSET_POS_Z, step.z > 0i)),
    );
}

struct NaadfStepChoice {
    axis: u32,
    distance: f32,
}

fn naadf_voxel_record_occupied(record: u32) -> bool {
    return (record & 0x80000000u) != 0u;
}

fn naadf_bounds_field(record: u32, offset: u32) -> u32 {
    return (record >> offset) & 0x3u;
}

fn naadf_directional_skip_for_step(record: u32, step: vec3<i32>) -> vec3<u32> {
    return vec3<u32>(
        naadf_bounds_field(record, select(0u, 2u, step.x > 0i)),
        naadf_bounds_field(record, select(4u, 6u, step.y > 0i)),
        naadf_bounds_field(record, select(8u, 10u, step.z > 0i)),
    );
}

fn naadf_distance_to_block_edge(local: vec3<u32>, step: vec3<i32>) -> vec3<u32> {
    let max_local = NAADF_VOXELS_PER_BLOCK_AXIS - 1u;
    return vec3<u32>(
        select(local.x, max_local - local.x, step.x > 0i),
        select(local.y, max_local - local.y, step.y > 0i),
        select(local.z, max_local - local.z, step.z > 0i),
    );
}

fn naadf_distance_to_chunk_edge(local: vec3<u32>, step: vec3<i32>) -> vec3<u32> {
    let max_local = NAADF_VOXELS_PER_CHUNK_AXIS - 1u;
    return vec3<u32>(
        select(local.x, max_local - local.x, step.x > 0i),
        select(local.y, max_local - local.y, step.y > 0i),
        select(local.z, max_local - local.z, step.z > 0i),
    );
}

fn naadf_step_axis_from_bounds(
    current_position: vec3<f32>,
    direction: vec3<f32>,
    step: vec3<i32>,
    previous_normal: vec3<f32>,
    bounds_in_dir: vec3<u32>,
    inv_direction_abs: vec3<f32>,
) -> NaadfStepChoice {
    let adjusted_position = current_position + previous_normal * -0.5;
    let frac_position = fract(adjusted_position);
    let is_negative = vec3<f32>(
        select(0.0, 1.0, step.x < 0i),
        select(0.0, 1.0, step.y < 0i),
        select(0.0, 1.0, step.z < 0i),
    );
    let boundary_correction = abs(is_negative - frac_position);
    let distance_to_exit = (
        vec3<f32>(1.0) +
        vec3<f32>(bounds_in_dir) -
        (vec3<f32>(1.0) - abs(previous_normal)) * boundary_correction
    ) * inv_direction_abs;
    let axis = naadf_step_axis(distance_to_exit);
    if axis == 0u {
        return NaadfStepChoice(axis, distance_to_exit.x);
    }
    if axis == 1u {
        return NaadfStepChoice(axis, distance_to_exit.y);
    }
    return NaadfStepChoice(axis, distance_to_exit.z);
}

fn naadf_make_hit(
    ray: NaadfRay,
    position: vec3<f32>,
    world_voxel: vec3<i32>,
    local_voxel: vec3<u32>,
    normal: vec3<f32>,
    material_id: u32,
    steps: u32,
) -> NaadfHit {
    return NaadfHit(
        1u,
        distance(ray.origin, position),
        material_id,
        steps,
        world_voxel,
        local_voxel,
        normal,
        NAADF_MISS_REASON_NONE,
    );
}

fn naadf_distance_to_mip_cell_edge(local: vec3<u32>, level: u32, step: vec3<i32>) -> vec3<u32> {
    let cell_size = 1u << level;
    let cell_local = local % vec3<u32>(cell_size);
    let max_local = cell_size - 1u;
    return vec3<u32>(
        select(cell_local.x, max_local - cell_local.x, step.x > 0i),
        select(cell_local.y, max_local - cell_local.y, step.y > 0i),
        select(cell_local.z, max_local - cell_local.z, step.z > 0i),
    );
}

fn naadf_normal_for_step_axis(axis: u32, step: vec3<i32>) -> vec3<f32> {
    if axis == 0u {
        return vec3<f32>(f32(-step.x), 0.0, 0.0);
    }
    if axis == 1u {
        return vec3<f32>(0.0, f32(-step.y), 0.0);
    }
    return vec3<f32>(0.0, 0.0, f32(-step.z));
}

fn naadf_select_mip_level(ray: NaadfRay, distance_along_ray: f32, cone_config: vec4<f32>) -> u32 {
    let base_footprint = max(cone_config.x, 0.0);
    let cone_spread = max(cone_config.y, 0.0);
    let jitter = cone_config.z;
    let purpose_bias = naadf_lod_bias_for_purpose(ray.purpose);
    let footprint = max(base_footprint + distance_along_ray * cone_spread + jitter, 1.0);
    let biased_footprint = footprint * exp2(purpose_bias);
    if biased_footprint <= 1.5 {
        return 0u;
    }
    if biased_footprint <= 3.0 {
        return 1u;
    }
    if biased_footprint <= 6.0 {
        return 2u;
    }
    if biased_footprint <= 12.0 {
        return 3u;
    }
    return 4u;
}

fn naadf_lod_bias_for_purpose(purpose: u32) -> f32 {
    if purpose == NAADF_RAY_PURPOSE_PREVIEW_PRIMARY {
        return -0.75;
    }
    if purpose == 0u {
        return -0.5;
    }
    return 0.75;
}

fn naadf_mip_bounds_for_step(record: u32, step: vec3<i32>) -> vec3<u32> {
    return vec3<u32>(
        naadf_mip_bounds_field(record, select(NAADF_MIP_BOUND_OFFSET_NEG_X, NAADF_MIP_BOUND_OFFSET_POS_X, step.x > 0i)),
        naadf_mip_bounds_field(record, select(NAADF_MIP_BOUND_OFFSET_NEG_Y, NAADF_MIP_BOUND_OFFSET_POS_Y, step.y > 0i)),
        naadf_mip_bounds_field(record, select(NAADF_MIP_BOUND_OFFSET_NEG_Z, NAADF_MIP_BOUND_OFFSET_POS_Z, step.z > 0i)),
    );
}

fn naadf_mip_bounds_field(record: u32, offset: u32) -> u32 {
    return (record >> offset) & 0x1fu;
}

fn naadf_mip_record_index(chunk_index: u32, level: u32, local: vec3<u32>) -> u32 {
    let axis = naadf_mip_axis(level);
    return chunk_index * NAADF_MIP_CELLS_PER_CHUNK + naadf_mip_offset(level) +
        local.x + local.y * axis + local.z * axis * axis;
}

fn naadf_mip_axis(level: u32) -> u32 {
    if level == 0u { return 16u; }
    if level == 1u { return 8u; }
    if level == 2u { return 4u; }
    if level == 3u { return 2u; }
    return 1u;
}

fn naadf_mip_offset(level: u32) -> u32 {
    if level == 0u { return NAADF_MIP_LEVEL_0_OFFSET; }
    if level == 1u { return NAADF_MIP_LEVEL_1_OFFSET; }
    if level == 2u { return NAADF_MIP_LEVEL_2_OFFSET; }
    if level == 3u { return NAADF_MIP_LEVEL_3_OFFSET; }
    return NAADF_MIP_LEVEL_4_OFFSET;
}

fn naadf_make_miss(steps: u32, miss_reason: u32) -> NaadfHit {
    return NaadfHit(
        0u,
        0.0,
        0u,
        steps,
        vec3<i32>(0),
        vec3<u32>(0u),
        vec3<f32>(0.0),
        miss_reason,
    );
}

fn naadf_step_direction(direction: vec3<f32>) -> vec3<i32> {
    return vec3<i32>(
        select(-1i, 1i, direction.x >= 0.0),
        select(-1i, 1i, direction.y >= 0.0),
        select(-1i, 1i, direction.z >= 0.0),
    );
}

fn naadf_initial_t_max(
    origin: vec3<f32>,
    direction: vec3<f32>,
    voxel: vec3<i32>,
    step: vec3<i32>,
) -> vec3<f32> {
    let next_boundary = vec3<f32>(voxel) + vec3<f32>(
        select(0.0, 1.0, step.x > 0i),
        select(0.0, 1.0, step.y > 0i),
        select(0.0, 1.0, step.z > 0i),
    );
    return abs((next_boundary - origin) / max(abs(direction), vec3<f32>(0.000001)));
}

fn naadf_t_delta(direction: vec3<f32>) -> vec3<f32> {
    return 1.0 / max(abs(direction), vec3<f32>(0.000001));
}

fn naadf_step_axis(t_max: vec3<f32>) -> u32 {
    if t_max.x <= t_max.y && t_max.x <= t_max.z {
        return 0u;
    }
    if t_max.y <= t_max.z {
        return 1u;
    }
    return 2u;
}

fn naadf_ray_box_axis(origin: f32, direction: f32, bounds_min: f32, bounds_max: f32) -> vec2<f32> {
    if abs(direction) < 0.000001 {
        if origin < bounds_min || origin > bounds_max {
            return vec2<f32>(1.0, 0.0);
        }
        return vec2<f32>(-1000000000.0, 1000000000.0);
    }

    let inv_direction = 1.0 / direction;
    let t0 = (bounds_min - origin) * inv_direction;
    let t1 = (bounds_max - origin) * inv_direction;
    return vec2<f32>(min(t0, t1), max(t0, t1));
}

fn naadf_ray_chunk_entry(origin: vec3<f32>, direction: vec3<f32>, chunk_pos: vec3<i32>) -> f32 {
    let bounds_min = vec3<f32>(naadf_chunk_world_origin(chunk_pos));
    let bounds_max = bounds_min + vec3<f32>(f32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let x_axis = naadf_ray_box_axis(origin.x, direction.x, bounds_min.x, bounds_max.x);
    let y_axis = naadf_ray_box_axis(origin.y, direction.y, bounds_min.y, bounds_max.y);
    let z_axis = naadf_ray_box_axis(origin.z, direction.z, bounds_min.z, bounds_max.z);
    let entry = max(max(x_axis.x, y_axis.x), z_axis.x);
    let exit = min(min(x_axis.y, y_axis.y), z_axis.y);
    if exit < 0.0 || entry > exit {
        return -1.0;
    }
    return max(entry, 0.0);
}

fn naadf_chunk_entry_normal(
    position: vec3<f32>,
    direction: vec3<f32>,
    chunk_pos: vec3<i32>,
) -> vec3<f32> {
    let bounds_min = vec3<f32>(naadf_chunk_world_origin(chunk_pos));
    let bounds_max = bounds_min + vec3<f32>(f32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let eps = 0.001;
    if abs(position.x - bounds_min.x) <= eps {
        return vec3<f32>(-1.0, 0.0, 0.0);
    }
    if abs(position.x - bounds_max.x) <= eps {
        return vec3<f32>(1.0, 0.0, 0.0);
    }
    if abs(position.y - bounds_min.y) <= eps {
        return vec3<f32>(0.0, -1.0, 0.0);
    }
    if abs(position.y - bounds_max.y) <= eps {
        return vec3<f32>(0.0, 1.0, 0.0);
    }
    if abs(position.z - bounds_min.z) <= eps {
        return vec3<f32>(0.0, 0.0, -1.0);
    }
    if abs(position.z - bounds_max.z) <= eps {
        return vec3<f32>(0.0, 0.0, 1.0);
    }
    return -direction;
}
