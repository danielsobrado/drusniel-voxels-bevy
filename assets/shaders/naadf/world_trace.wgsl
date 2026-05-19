#import "shaders/naadf/common.wgsl" NAADF_VOXELS_PER_CHUNK_AXIS
#import "shaders/naadf/layout.wgsl" naadf_chunk_world_origin
#import "shaders/naadf/ray_trace.wgsl" NAADF_MISS_REASON_CHUNK_BUDGET, NAADF_MISS_REASON_CLEAN_EXIT, NAADF_MISS_REASON_DISTANCE_CLAMP, NAADF_MISS_REASON_NO_LOOKUP, NaadfHit, NaadfRay, naadf_chunk_voxel_occupied_at, naadf_make_miss, trace_naadf_chunk, trace_naadf_chunk_lod

@group(3) @binding(20) var<storage, read> naadf_chunk_lookup_records: array<vec4<u32>>;

fn trace_naadf_world(
    ray: NaadfRay,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> NaadfHit {
    let lookup_count = min(chunk_lookup_count, arrayLength(&naadf_chunk_lookup_records));
    if lookup_count == 0u {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }

    let direction = normalize(ray.direction);
    let step = vec3<i32>(
        select(-1i, 1i, direction.x >= 0.0),
        select(-1i, 1i, direction.y >= 0.0),
        select(-1i, 1i, direction.z >= 0.0),
    );
    var chunk_pos = naadf_world_chunk_for_position(ray.origin);
    let chunk_size = f32(NAADF_VOXELS_PER_CHUNK_AXIS);
    let t_delta = vec3<f32>(chunk_size) / max(abs(direction), vec3<f32>(0.000001));
    let next_boundary = naadf_world_next_chunk_boundary(chunk_pos, step);
    var t_max = abs((next_boundary - ray.origin) / max(abs(direction), vec3<f32>(0.000001)));
    var traveled = 0.0;

    var chunk_steps_taken = 0u;
    var total_voxel_steps_taken = 0u;
    var miss_reason = NAADF_MISS_REASON_CHUNK_BUDGET;
    for (var chunk_step = 0u; chunk_step < max_steps; chunk_step = chunk_step + 1u) {
        chunk_steps_taken = chunk_step + 1u;
        if total_voxel_steps_taken >= max_steps {
            miss_reason = NAADF_MISS_REASON_CHUNK_BUDGET;
            break;
        }
        if traveled > ray.max_distance {
            miss_reason = NAADF_MISS_REASON_DISTANCE_CLAMP;
            break;
        }
        let chunk_index = naadf_lookup_chunk_slot(chunk_pos, lookup_count);
        if chunk_index != 0xffffffffu && chunk_index < chunk_count {
            var hit = trace_naadf_chunk(ray, chunk_pos, chunk_index, max_steps - total_voxel_steps_taken);
            total_voxel_steps_taken = min(max_steps, total_voxel_steps_taken + hit.steps);
            hit.steps = total_voxel_steps_taken;
            if hit.hit != 0u {
                return hit;
            }
            if hit.miss_reason != NAADF_MISS_REASON_CLEAN_EXIT &&
                hit.miss_reason != NAADF_MISS_REASON_NO_LOOKUP {
                return hit;
            }
        }

        let axis = naadf_chunk_step_axis(t_max);
        if axis == 0u {
            chunk_pos.x = chunk_pos.x + step.x;
            traveled = t_max.x + 0.0001;
            t_max.x = t_max.x + t_delta.x;
        } else if axis == 1u {
            chunk_pos.y = chunk_pos.y + step.y;
            traveled = t_max.y + 0.0001;
            t_max.y = t_max.y + t_delta.y;
        } else {
            chunk_pos.z = chunk_pos.z + step.z;
            traveled = t_max.z + 0.0001;
            t_max.z = t_max.z + t_delta.z;
        }
    }

    return naadf_make_miss(max(chunk_steps_taken, total_voxel_steps_taken), miss_reason);
}

fn trace_naadf_world_lod(
    ray: NaadfRay,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
    cone_config: vec4<f32>,
) -> NaadfHit {
    let lookup_count = min(chunk_lookup_count, arrayLength(&naadf_chunk_lookup_records));
    if lookup_count == 0u {
        return naadf_make_miss(0u, NAADF_MISS_REASON_NO_LOOKUP);
    }

    let direction = normalize(ray.direction);
    let step = vec3<i32>(
        select(-1i, 1i, direction.x >= 0.0),
        select(-1i, 1i, direction.y >= 0.0),
        select(-1i, 1i, direction.z >= 0.0),
    );
    var chunk_pos = naadf_world_chunk_for_position(ray.origin);
    let chunk_size = f32(NAADF_VOXELS_PER_CHUNK_AXIS);
    let t_delta = vec3<f32>(chunk_size) / max(abs(direction), vec3<f32>(0.000001));
    let next_boundary = naadf_world_next_chunk_boundary(chunk_pos, step);
    var t_max = abs((next_boundary - ray.origin) / max(abs(direction), vec3<f32>(0.000001)));
    var traveled = 0.0;

    var chunk_steps_taken = 0u;
    var total_voxel_steps_taken = 0u;
    var miss_reason = NAADF_MISS_REASON_CHUNK_BUDGET;
    for (var chunk_step = 0u; chunk_step < max_steps; chunk_step = chunk_step + 1u) {
        chunk_steps_taken = chunk_step + 1u;
        if total_voxel_steps_taken >= max_steps {
            miss_reason = NAADF_MISS_REASON_CHUNK_BUDGET;
            break;
        }
        if traveled > ray.max_distance {
            miss_reason = NAADF_MISS_REASON_DISTANCE_CLAMP;
            break;
        }
        let chunk_index = naadf_lookup_chunk_slot(chunk_pos, lookup_count);
        if chunk_index != 0xffffffffu && chunk_index < chunk_count {
            var hit = trace_naadf_chunk_lod(
                ray,
                chunk_pos,
                chunk_index,
                max_steps - total_voxel_steps_taken,
                cone_config,
            );
            total_voxel_steps_taken = min(max_steps, total_voxel_steps_taken + hit.steps);
            hit.steps = total_voxel_steps_taken;
            if hit.hit != 0u {
                return hit;
            }
            if hit.miss_reason != NAADF_MISS_REASON_CLEAN_EXIT &&
                hit.miss_reason != NAADF_MISS_REASON_NO_LOOKUP {
                return hit;
            }
        }

        let axis = naadf_chunk_step_axis(t_max);
        if axis == 0u {
            chunk_pos.x = chunk_pos.x + step.x;
            traveled = t_max.x + 0.0001;
            t_max.x = t_max.x + t_delta.x;
        } else if axis == 1u {
            chunk_pos.y = chunk_pos.y + step.y;
            traveled = t_max.y + 0.0001;
            t_max.y = t_max.y + t_delta.y;
        } else {
            chunk_pos.z = chunk_pos.z + step.z;
            traveled = t_max.z + 0.0001;
            t_max.z = t_max.z + t_delta.z;
        }
    }

    return naadf_make_miss(max(chunk_steps_taken, total_voxel_steps_taken), miss_reason);
}

fn naadf_world_chunk_for_position(position: vec3<f32>) -> vec3<i32> {
    return vec3<i32>(floor(position / f32(NAADF_VOXELS_PER_CHUNK_AXIS)));
}

fn naadf_world_next_chunk_boundary(chunk_pos: vec3<i32>, step: vec3<i32>) -> vec3<f32> {
    return (vec3<f32>(chunk_pos) + vec3<f32>(
        select(0.0, 1.0, step.x > 0i),
        select(0.0, 1.0, step.y > 0i),
        select(0.0, 1.0, step.z > 0i),
    )) * f32(NAADF_VOXELS_PER_CHUNK_AXIS);
}

fn naadf_lookup_chunk_slot(chunk_pos: vec3<i32>, lookup_count: u32) -> u32 {
    var low = 0u;
    var high = lookup_count;
    for (var i = 0u; i < 32u; i = i + 1u) {
        if low >= high {
            break;
        }
        let mid = (low + high) / 2u;
        let record = naadf_chunk_lookup_records[mid];
        let record_pos = vec3<i32>(
            bitcast<i32>(record.x),
            bitcast<i32>(record.y),
            bitcast<i32>(record.z),
        );
        let comparison = naadf_compare_chunk_pos(record_pos, chunk_pos);
        if comparison == 0i {
            return record.w;
        }
        if comparison < 0i {
            low = mid + 1u;
        } else {
            high = mid;
        }
    }
    return 0xffffffffu;
}

fn naadf_compare_chunk_pos(a: vec3<i32>, b: vec3<i32>) -> i32 {
    if a.x < b.x {
        return -1i;
    }
    if a.x > b.x {
        return 1i;
    }
    if a.y < b.y {
        return -1i;
    }
    if a.y > b.y {
        return 1i;
    }
    if a.z < b.z {
        return -1i;
    }
    if a.z > b.z {
        return 1i;
    }
    return 0i;
}

fn naadf_world_surface_normal(
    hit: NaadfHit,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> vec3<f32> {
    if hit.hit == 0u {
        return hit.normal;
    }

    let x_pos = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(1, 0, 0), chunk_count, chunk_lookup_count);
    let x_neg = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(-1, 0, 0), chunk_count, chunk_lookup_count);
    let y_pos = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(0, 1, 0), chunk_count, chunk_lookup_count);
    let y_neg = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(0, -1, 0), chunk_count, chunk_lookup_count);
    let z_pos = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(0, 0, 1), chunk_count, chunk_lookup_count);
    let z_neg = naadf_world_voxel_occupied(hit.world_voxel + vec3<i32>(0, 0, -1), chunk_count, chunk_lookup_count);

    let gradient = vec3<f32>(
        select(0.0, 1.0, x_neg) - select(0.0, 1.0, x_pos),
        select(0.0, 1.0, y_neg) - select(0.0, 1.0, y_pos),
        select(0.0, 1.0, z_neg) - select(0.0, 1.0, z_pos),
    );
    if dot(gradient, gradient) > 0.000001 {
        return normalize(gradient);
    }
    return hit.normal;
}

fn naadf_world_voxel_occupied(
    world_voxel: vec3<i32>,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> bool {
    let lookup_count = min(chunk_lookup_count, arrayLength(&naadf_chunk_lookup_records));
    if lookup_count == 0u {
        return false;
    }

    let chunk_pos = vec3<i32>(floor(vec3<f32>(world_voxel) / f32(NAADF_VOXELS_PER_CHUNK_AXIS)));
    let chunk_index = naadf_lookup_chunk_slot(chunk_pos, lookup_count);
    if chunk_index == 0xffffffffu || chunk_index >= chunk_count {
        return false;
    }

    let chunk_origin = naadf_chunk_world_origin(chunk_pos);
    let local = world_voxel - chunk_origin;
    if any(local < vec3<i32>(0)) || any(local >= vec3<i32>(i32(NAADF_VOXELS_PER_CHUNK_AXIS))) {
        return false;
    }
    return naadf_chunk_voxel_occupied_at(chunk_index, vec3<u32>(local));
}

fn naadf_chunk_step_axis(t_max: vec3<f32>) -> u32 {
    if t_max.x <= t_max.y && t_max.x <= t_max.z {
        return 0u;
    }
    if t_max.y <= t_max.z {
        return 1u;
    }
    return 2u;
}
