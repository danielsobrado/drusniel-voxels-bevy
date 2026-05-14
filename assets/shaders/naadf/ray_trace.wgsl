#import "shaders/naadf/common.wgsl" NAADF_NODE_UNIFORM_FULL, NAADF_VOXELS_PER_CHUNK_AXIS, naadf_node_payload, naadf_node_state
#import "shaders/naadf/layout.wgsl" naadf_chunk_world_origin, naadf_voxel_index_in_chunk

@group(3) @binding(0) var<storage, read> naadf_voxel_records: array<u32>;
@group(3) @binding(1) var<storage, read> naadf_material_records: array<u32>;

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
    var voxel = vec3<i32>(floor(ray.origin));
    let step = naadf_step_direction(direction);
    var t_max = naadf_initial_t_max(ray.origin, direction, voxel, step);
    let t_delta = naadf_t_delta(direction);
    var traveled = 0.0;
    var normal = vec3<f32>(0.0);
    let chunk_origin = naadf_chunk_world_origin(chunk_pos);
    let chunk_end = chunk_origin + vec3<i32>(i32(NAADF_VOXELS_PER_CHUNK_AXIS));

    for (var steps = 0u; steps < max_steps; steps = steps + 1u) {
        if traveled > ray.max_distance {
            break;
        }
        if all(voxel >= chunk_origin) && all(voxel < chunk_end) {
            let local = vec3<u32>(voxel - chunk_origin);
            let local_index = naadf_voxel_index_in_chunk(local);
            if naadf_voxel_records[voxel_base_record + local_index] != 0u {
                return naadf_make_hit(
                    ray,
                    ray.origin + direction * traveled,
                    voxel,
                    local,
                    normal,
                    naadf_material_records[material_base_record + local_index],
                    steps,
                );
            }
        }

        let axis = naadf_step_axis(t_max);
        if axis == 0u {
            voxel.x = voxel.x + step.x;
            traveled = t_max.x;
            t_max.x = t_max.x + t_delta.x;
            normal = vec3<f32>(f32(-step.x), 0.0, 0.0);
        } else if axis == 1u {
            voxel.y = voxel.y + step.y;
            traveled = t_max.y;
            t_max.y = t_max.y + t_delta.y;
            normal = vec3<f32>(0.0, f32(-step.y), 0.0);
        } else {
            voxel.z = voxel.z + step.z;
            traveled = t_max.z;
            t_max.z = t_max.z + t_delta.z;
            normal = vec3<f32>(0.0, 0.0, f32(-step.z));
        }
    }

    return naadf_make_miss(max_steps);
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
