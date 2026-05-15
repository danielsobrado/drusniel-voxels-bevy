#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, NAADF_PACKED_BLOCK_WORDS, NAADF_VOXELS_PER_BLOCK_AXIS, NAADF_VOXELS_PER_CHUNK, NAADF_VOXELS_PER_CHUNK_AXIS, naadf_node_payload, naadf_node_state
#import "shaders/naadf/layout.wgsl" naadf_block_coord_for_voxel, naadf_block_index_in_chunk, naadf_chunk_world_origin, naadf_local_coord_in_block, naadf_voxel_index_in_chunk

@group(3) @binding(0) var<storage, read> naadf_voxel_records: array<u32>;
@group(3) @binding(1) var<storage, read> naadf_material_records: array<u32>;
@group(3) @binding(5) var<storage, read> naadf_block_records: array<u32>;

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
};

fn trace_naadf_dense_debug(
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
            return naadf_make_miss(0u);
        }

        let hit_position = ray.origin + direction * entry_t;
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
        return naadf_make_miss(0u);
    }

    var traveled = max(entry_t, 0.0);
    var normal = vec3<f32>(0.0);
    let chunk_origin = naadf_chunk_world_origin(chunk_pos);
    let chunk_end = chunk_origin + vec3<i32>(i32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let block_base_record = (voxel_base_record / NAADF_VOXELS_PER_CHUNK) *
        NAADF_BLOCKS_PER_CHUNK * NAADF_PACKED_BLOCK_WORDS;

    for (var steps = 0u; steps < max_steps; steps = steps + 1u) {
        if traveled > ray.max_distance {
            break;
        }
        let current_position = ray.origin + direction * traveled;
        let cell_position = current_position + normal * -0.5;
        let voxel = vec3<i32>(floor(cell_position));
        if all(voxel >= chunk_origin) && all(voxel < chunk_end) {
            let local = vec3<u32>(voxel - chunk_origin);
            let local_index = naadf_voxel_index_in_chunk(local);
            let voxel_record = naadf_voxel_records[voxel_base_record + local_index];
            if naadf_voxel_record_occupied(voxel_record) {
                return naadf_make_hit(
                    ray,
                    current_position,
                    voxel,
                    local,
                    normal,
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
            break;
        }
    }

    return naadf_make_miss(max_steps);
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
    );
}

fn naadf_make_miss(steps: u32) -> NaadfHit {
    return NaadfHit(
        0u,
        0.0,
        0u,
        steps,
        vec3<i32>(0),
        vec3<u32>(0u),
        vec3<f32>(0.0),
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

fn naadf_ray_chunk_entry(origin: vec3<f32>, direction: vec3<f32>, chunk_pos: vec3<i32>) -> f32 {
    let bounds_min = vec3<f32>(naadf_chunk_world_origin(chunk_pos));
    let bounds_max = bounds_min + vec3<f32>(f32(NAADF_VOXELS_PER_CHUNK_AXIS));
    let safe_direction = select(
        vec3<f32>(0.000001),
        direction,
        abs(direction) >= vec3<f32>(0.000001),
    );
    let t0 = (bounds_min - origin) / safe_direction;
    let t1 = (bounds_max - origin) / safe_direction;
    let near = min(t0, t1);
    let far = max(t0, t1);
    let entry = max(max(near.x, near.y), near.z);
    let exit = min(min(far.x, far.y), far.z);
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
