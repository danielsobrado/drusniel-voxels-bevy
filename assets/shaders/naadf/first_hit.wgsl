#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_CHUNK
#import "shaders/naadf/ray_trace.wgsl" NaadfHit, NaadfRay, naadf_chunk_records, trace_naadf_dense_debug

struct NaadfFirstHitParams {
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    config: vec4<u32>,
}

struct NaadfFirstHitPreview {
    hit: u32,
    color: vec3<f32>,
    distance: f32,
    normal: vec3<f32>,
    material_id: u32,
}

@group(3) @binding(16) var<uniform> naadf_first_hit_params: NaadfFirstHitParams;
@group(3) @binding(17) var naadf_first_hit_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(18) var naadf_first_hit_depth_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(19) var naadf_first_hit_normal_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(20) var<storage, read> naadf_chunk_lookup_records: array<vec4<u32>>;

@compute @workgroup_size(8, 8, 1)
fn naadf_first_hit_preview(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_first_hit_output);
    if any(id.xy >= output_size) {
        return;
    }

    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(output_size);
    let ndc = uv * 2.0 - vec2<f32>(1.0);
    let fov_scale = tan(naadf_first_hit_params.camera_forward_fov_y.w * 0.5);
    let ray_direction = normalize(
        naadf_first_hit_params.camera_forward_fov_y.xyz +
        naadf_first_hit_params.camera_right_aspect.xyz * (ndc.x * naadf_first_hit_params.camera_right_aspect.w * fov_scale) +
        naadf_first_hit_params.camera_up_pad.xyz * (-ndc.y * fov_scale),
    );
    let ray = NaadfRay(
        naadf_first_hit_params.camera_origin_max_distance.xyz,
        ray_direction,
        naadf_first_hit_params.camera_origin_max_distance.w,
        0u,
    );
    let preview = preview_naadf_first_hit_world(ray, naadf_first_hit_params.config.xyz);

    let miss_color = vec3<f32>(0.0);
    let color = select(miss_color, preview.color, preview.hit != 0u);
    let depth = select(1.0, clamp(preview.distance / max(ray.max_distance, 0.0001), 0.0, 1.0), preview.hit != 0u);
    let normal = select(vec3<f32>(0.5), preview.normal * 0.5 + vec3<f32>(0.5), preview.hit != 0u);
    let coord = vec2<i32>(id.xy);
    textureStore(
        naadf_first_hit_output,
        coord,
        vec4<f32>(color, 1.0),
    );
    textureStore(naadf_first_hit_depth_output, coord, vec4<f32>(depth, 0.0, 0.0, 1.0));
    textureStore(naadf_first_hit_normal_output, coord, vec4<f32>(normal, 1.0));
}

fn preview_naadf_first_hit_world(ray: NaadfRay, config: vec3<u32>) -> NaadfFirstHitPreview {
    let max_steps = config.x;
    let chunk_count = min(config.y, arrayLength(&naadf_chunk_records) / NAADF_PACKED_CHUNK_WORDS);
    let lookup_count = min(config.z, arrayLength(&naadf_chunk_lookup_records));
    var miss = NaadfFirstHitPreview(
        0u,
        vec3<f32>(0.0),
        ray.max_distance,
        vec3<f32>(0.0),
        0u,
    );
    if lookup_count == 0u {
        return miss;
    }

    let direction = normalize(ray.direction);
    let step = vec3<i32>(
        select(-1i, 1i, direction.x >= 0.0),
        select(-1i, 1i, direction.y >= 0.0),
        select(-1i, 1i, direction.z >= 0.0),
    );
    var chunk_pos = vec3<i32>(floor(ray.origin / f32(NAADF_VOXELS_PER_CHUNK_AXIS)));
    let chunk_size = f32(NAADF_VOXELS_PER_CHUNK_AXIS);
    let t_delta = vec3<f32>(chunk_size) / max(abs(direction), vec3<f32>(0.000001));
    let next_boundary = (vec3<f32>(chunk_pos) + vec3<f32>(
        select(0.0, 1.0, step.x > 0i),
        select(0.0, 1.0, step.y > 0i),
        select(0.0, 1.0, step.z > 0i),
    )) * chunk_size;
    var t_max = abs((next_boundary - ray.origin) / max(abs(direction), vec3<f32>(0.000001)));
    var traveled = 0.0;

    for (var chunk_step = 0u; chunk_step < max_steps; chunk_step = chunk_step + 1u) {
        if traveled > ray.max_distance {
            break;
        }
        let chunk_index = naadf_lookup_chunk_slot(chunk_pos, lookup_count);
        if chunk_index != 0xffffffffu && chunk_index < chunk_count {
            let chunk_base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
            if naadf_chunk_record_valid(chunk_base) {
                let hit = preview_naadf_first_hit(
                    ray,
                    chunk_pos,
                    naadf_chunk_records[chunk_base + 0u],
                    chunk_index * NAADF_VOXELS_PER_CHUNK,
                    chunk_index * NAADF_VOXELS_PER_CHUNK,
                    max_steps,
                );
                if hit.hit != 0u {
                    return hit;
                }
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

    return miss;
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

fn naadf_chunk_step_axis(t_max: vec3<f32>) -> u32 {
    if t_max.x <= t_max.y && t_max.x <= t_max.z {
        return 0u;
    }
    if t_max.y <= t_max.z {
        return 1u;
    }
    return 2u;
}

fn naadf_chunk_record_valid(base: u32) -> bool {
    return naadf_chunk_records[base + 4u] == NAADF_BLOCKS_PER_CHUNK &&
        naadf_chunk_records[base + 5u] == NAADF_VOXELS_PER_CHUNK;
}

fn naadf_chunk_record_position(base: u32) -> vec3<i32> {
    return vec3<i32>(
        bitcast<i32>(naadf_chunk_records[base + 1u]),
        bitcast<i32>(naadf_chunk_records[base + 2u]),
        bitcast<i32>(naadf_chunk_records[base + 3u]),
    );
}

fn trace_naadf_first_hit(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> NaadfHit {
    return trace_naadf_dense_debug(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
}

fn preview_naadf_first_hit(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> NaadfFirstHitPreview {
    let hit = trace_naadf_first_hit(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
    return NaadfFirstHitPreview(
        hit.hit,
        naadf_preview_material_color(hit.material_id),
        hit.distance,
        hit.normal,
        hit.material_id,
    );
}

fn naadf_preview_material_color(material_id: u32) -> vec3<f32> {
    if material_id == 0u {
        return vec3<f32>(0.55, 0.72, 0.95);
    }
    if material_id == 2u {
        return vec3<f32>(0.42, 0.38, 0.32);
    }
    if material_id == 3u {
        return vec3<f32>(0.18, 0.28, 0.95);
    }
    return vec3<f32>(0.48, 0.58, 0.34);
}
