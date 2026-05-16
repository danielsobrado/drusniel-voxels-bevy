#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_CHUNK, NAADF_VOXELS_PER_CHUNK_AXIS
#import "shaders/naadf/ray_trace.wgsl" NaadfRay, trace_naadf_chunk

struct NaadfFirstHitParams {
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    config: vec4<u32>,
    fog_color_start: vec4<f32>,
    fog_end_strength: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    previous_clip_from_world: mat4x4<f32>,
}

struct NaadfFirstHitPreview {
    hit: u32,
    color: vec3<f32>,
    distance: f32,
    normal: vec3<f32>,
    previous_world_position: vec3<f32>,
    material_id: u32,
}

struct NaadfEntityVolumeRecord {
    world_aabb_min_material_base: vec4<f32>,
    world_aabb_max_material_count: vec4<f32>,
    local_from_world_x: vec4<f32>,
    local_from_world_y: vec4<f32>,
    local_from_world_z: vec4<f32>,
    local_from_world_w: vec4<f32>,
    world_from_local_x: vec4<f32>,
    world_from_local_y: vec4<f32>,
    world_from_local_z: vec4<f32>,
    world_from_local_w: vec4<f32>,
    previous_world_from_local_x: vec4<f32>,
    previous_world_from_local_y: vec4<f32>,
    previous_world_from_local_z: vec4<f32>,
    previous_world_from_local_w: vec4<f32>,
    dimensions_occupied: vec4<f32>,
    voxel_size_local_origin_x: vec4<f32>,
    local_origin_yz_pad: vec4<f32>,
}

@group(3) @binding(16) var<uniform> naadf_first_hit_params: NaadfFirstHitParams;
@group(3) @binding(17) var naadf_first_hit_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(18) var naadf_first_hit_depth_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(19) var naadf_first_hit_normal_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(23) var naadf_first_hit_motion_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(20) var<storage, read> naadf_chunk_lookup_records: array<vec4<u32>>;
@group(3) @binding(21) var<storage, read> naadf_entity_volume_records: array<NaadfEntityVolumeRecord>;
@group(3) @binding(22) var<storage, read> naadf_entity_material_records: array<u32>;

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
    let terrain_preview = preview_naadf_first_hit_world(ray, naadf_first_hit_params.config.xyz);
    let entity_preview = preview_naadf_first_hit_entities(ray, naadf_first_hit_params.config.w);
    let preview = naadf_nearest_preview(terrain_preview, entity_preview);

    let miss_color = naadf_preview_miss_sky(ray_direction);
    let fogged_color = naadf_apply_preview_fog(preview.color, preview.distance);
    let color = select(miss_color, fogged_color, preview.hit != 0u);
    let alpha = select(0.0, 1.0, preview.hit != 0u);
    let depth = select(1.0, clamp(preview.distance / max(ray.max_distance, 0.0001), 0.0, 1.0), preview.hit != 0u);
    let normal = select(vec3<f32>(0.5), preview.normal * 0.5 + vec3<f32>(0.5), preview.hit != 0u);
    let motion = naadf_first_hit_motion(uv, ray, preview);
    let coord = vec2<i32>(id.xy);
    textureStore(
        naadf_first_hit_output,
        coord,
        vec4<f32>(color, alpha),
    );
    textureStore(naadf_first_hit_depth_output, coord, vec4<f32>(depth, 0.0, 0.0, 1.0));
    textureStore(naadf_first_hit_normal_output, coord, vec4<f32>(normal, 1.0));
    textureStore(naadf_first_hit_motion_output, coord, motion);
}

fn naadf_first_hit_motion(uv: vec2<f32>, ray: NaadfRay, preview: NaadfFirstHitPreview) -> vec4<f32> {
    if preview.hit == 0u {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    let previous_clip = naadf_first_hit_params.previous_clip_from_world *
        vec4<f32>(preview.previous_world_position, 1.0);
    if previous_clip.w <= 0.0001 {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    let previous_ndc = previous_clip.xy / previous_clip.w;
    let previous_uv = vec2<f32>(
        previous_ndc.x * 0.5 + 0.5,
        0.5 - previous_ndc.y * 0.5,
    );
    if any(previous_uv < vec2<f32>(0.0)) || any(previous_uv > vec2<f32>(1.0)) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    return vec4<f32>(uv - previous_uv, 1.0, 0.0);
}

fn preview_naadf_first_hit_world(ray: NaadfRay, config: vec3<u32>) -> NaadfFirstHitPreview {
    let max_steps = config.x;
    let chunk_count = config.y;
    let lookup_count = min(config.z, arrayLength(&naadf_chunk_lookup_records));
    var miss = NaadfFirstHitPreview(
        0u,
        vec3<f32>(0.0),
        ray.max_distance,
        vec3<f32>(0.0),
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
            let hit = preview_naadf_first_hit(ray, chunk_pos, chunk_index, max_steps);
            if hit.hit != 0u {
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

    return miss;
}

fn preview_naadf_first_hit_entities(ray: NaadfRay, entity_count: u32) -> NaadfFirstHitPreview {
    var best = NaadfFirstHitPreview(
        0u,
        vec3<f32>(0.0),
        ray.max_distance,
        vec3<f32>(0.0),
        vec3<f32>(0.0),
        0u,
    );
    let count = min(entity_count, arrayLength(&naadf_entity_volume_records));
    for (var entity_index = 0u; entity_index < count; entity_index = entity_index + 1u) {
        let hit = preview_naadf_entity_volume(ray, naadf_entity_volume_records[entity_index]);
        if hit.hit != 0u && (best.hit == 0u || hit.distance < best.distance) {
            best = hit;
        }
    }
    return best;
}

fn preview_naadf_entity_volume(ray: NaadfRay, record: NaadfEntityVolumeRecord) -> NaadfFirstHitPreview {
    if record.dimensions_occupied.w <= 0.0 {
        return naadf_first_hit_preview_miss(ray.max_distance);
    }

    let direction = normalize(ray.direction);
    let local_from_world = mat4x4<f32>(
        record.local_from_world_x,
        record.local_from_world_y,
        record.local_from_world_z,
        record.local_from_world_w,
    );
    let local_origin = (local_from_world * vec4<f32>(ray.origin, 1.0)).xyz;
    let local_end = (local_from_world * vec4<f32>(ray.origin + direction * ray.max_distance, 1.0)).xyz;
    let local_direction = local_end - local_origin;
    let local_volume_origin = vec3<f32>(
        record.voxel_size_local_origin_x.w,
        record.local_origin_yz_pad.x,
        record.local_origin_yz_pad.y,
    );
    let voxel_size = max(record.voxel_size_local_origin_x.xyz, vec3<f32>(0.000001));
    let dimensions = vec3<u32>(record.dimensions_occupied.xyz);
    let grid_origin = (local_origin - local_volume_origin) / voxel_size;
    let grid_direction = local_direction / voxel_size;
    let bounds = naadf_entity_ray_box(grid_origin, grid_direction, vec3<f32>(0.0), vec3<f32>(dimensions));
    if bounds.x > bounds.y || bounds.y < 0.0 || bounds.x > 1.0 {
        return naadf_first_hit_preview_miss(ray.max_distance);
    }

    var t = max(bounds.x, 0.0);
    let step = vec3<i32>(
        select(-1i, 1i, grid_direction.x >= 0.0),
        select(-1i, 1i, grid_direction.y >= 0.0),
        select(-1i, 1i, grid_direction.z >= 0.0),
    );
    var voxel = clamp(
        vec3<i32>(floor(grid_origin + grid_direction * t)),
        vec3<i32>(0),
        vec3<i32>(dimensions) - vec3<i32>(1),
    );
    let inv_direction = vec3<f32>(
        naadf_entity_safe_reciprocal(grid_direction.x),
        naadf_entity_safe_reciprocal(grid_direction.y),
        naadf_entity_safe_reciprocal(grid_direction.z),
    );
    var t_max = naadf_entity_next_grid_boundary_t(grid_origin, voxel, step, inv_direction);
    let t_delta = abs(inv_direction);
    var normal = vec3<f32>(0.0);
    let material_base = u32(record.world_aabb_min_material_base.w + 0.5);
    let material_count = u32(record.world_aabb_max_material_count.w + 0.5);

    for (var steps = 0u; steps < 4096u; steps = steps + 1u) {
        if t > bounds.y || t > 1.0 {
            break;
        }
        if any(voxel < vec3<i32>(0)) || any(voxel >= vec3<i32>(dimensions)) {
            break;
        }
        let local_voxel = vec3<u32>(voxel);
        let material_offset = naadf_entity_voxel_index(local_voxel, dimensions);
        if material_offset < material_count {
            let material_index = material_base + material_offset;
            var material_id = 0u;
            if material_index < arrayLength(&naadf_entity_material_records) {
                material_id = naadf_entity_material_records[material_index];
            }
            if material_id != 0u {
                let distance = clamp(t, 0.0, 1.0) * ray.max_distance;
                let world_normal = naadf_entity_world_normal(record, normal, -normalize(grid_direction));
                let local_hit = local_origin + local_direction * clamp(t, 0.0, 1.0);
                let previous_world_position = naadf_entity_previous_world_position(record, local_hit);
                return NaadfFirstHitPreview(
                    1u,
                    naadf_preview_shaded_color(material_id, world_normal),
                    distance,
                    world_normal,
                    previous_world_position,
                    material_id,
                );
            }
        }

        if t_max.x <= t_max.y && t_max.x <= t_max.z {
            t = t_max.x;
            t_max.x = t_max.x + t_delta.x;
            voxel.x = voxel.x + step.x;
            normal = vec3<f32>(f32(-step.x), 0.0, 0.0);
        } else if t_max.y <= t_max.z {
            t = t_max.y;
            t_max.y = t_max.y + t_delta.y;
            voxel.y = voxel.y + step.y;
            normal = vec3<f32>(0.0, f32(-step.y), 0.0);
        } else {
            t = t_max.z;
            t_max.z = t_max.z + t_delta.z;
            voxel.z = voxel.z + step.z;
            normal = vec3<f32>(0.0, 0.0, f32(-step.z));
        }
    }

    return naadf_first_hit_preview_miss(ray.max_distance);
}

fn naadf_first_hit_preview_miss(max_distance: f32) -> NaadfFirstHitPreview {
    return NaadfFirstHitPreview(
        0u,
        vec3<f32>(0.0),
        max_distance,
        vec3<f32>(0.0),
        vec3<f32>(0.0),
        0u,
    );
}

fn naadf_nearest_preview(a: NaadfFirstHitPreview, b: NaadfFirstHitPreview) -> NaadfFirstHitPreview {
    if a.hit == 0u {
        return b;
    }
    if b.hit == 0u {
        return a;
    }
    if b.distance < a.distance {
        return b;
    }
    return a;
}

fn naadf_entity_ray_box(origin: vec3<f32>, direction: vec3<f32>, min_bounds: vec3<f32>, max_bounds: vec3<f32>) -> vec2<f32> {
    let x = naadf_entity_ray_box_axis(origin.x, direction.x, min_bounds.x, max_bounds.x);
    let y = naadf_entity_ray_box_axis(origin.y, direction.y, min_bounds.y, max_bounds.y);
    let z = naadf_entity_ray_box_axis(origin.z, direction.z, min_bounds.z, max_bounds.z);
    return vec2<f32>(
        max(max(x.x, y.x), z.x),
        min(min(x.y, y.y), z.y),
    );
}

fn naadf_entity_ray_box_axis(origin: f32, direction: f32, min_bound: f32, max_bound: f32) -> vec2<f32> {
    if abs(direction) < 0.000001 {
        if origin < min_bound || origin > max_bound {
            return vec2<f32>(1.0, 0.0);
        }
        return vec2<f32>(-1000000000.0, 1000000000.0);
    }
    let inv_direction = 1.0 / direction;
    let t0 = (min_bound - origin) * inv_direction;
    let t1 = (max_bound - origin) * inv_direction;
    return vec2<f32>(min(t0, t1), max(t0, t1));
}

fn naadf_entity_safe_reciprocal(value: f32) -> f32 {
    let safe_value = select(select(-0.000001, 0.000001, value >= 0.0), value, abs(value) >= 0.000001);
    return 1.0 / safe_value;
}

fn naadf_entity_next_grid_boundary_t(
    origin: vec3<f32>,
    voxel: vec3<i32>,
    step: vec3<i32>,
    inv_direction: vec3<f32>,
) -> vec3<f32> {
    let next = vec3<f32>(
        select(f32(voxel.x), f32(voxel.x + 1i), step.x > 0i),
        select(f32(voxel.y), f32(voxel.y + 1i), step.y > 0i),
        select(f32(voxel.z), f32(voxel.z + 1i), step.z > 0i),
    );
    return (next - origin) * inv_direction;
}

fn naadf_entity_voxel_index(local: vec3<u32>, dimensions: vec3<u32>) -> u32 {
    return local.x + local.y * dimensions.x + local.z * dimensions.x * dimensions.y;
}

fn naadf_entity_world_normal(
    record: NaadfEntityVolumeRecord,
    local_normal: vec3<f32>,
    fallback_local_normal: vec3<f32>,
) -> vec3<f32> {
    let world_from_local = mat4x4<f32>(
        record.world_from_local_x,
        record.world_from_local_y,
        record.world_from_local_z,
        record.world_from_local_w,
    );
    let normal = select(local_normal, fallback_local_normal, length(local_normal) <= 0.000001);
    return normalize((world_from_local * vec4<f32>(normal, 0.0)).xyz);
}

fn naadf_entity_previous_world_position(record: NaadfEntityVolumeRecord, local_position: vec3<f32>) -> vec3<f32> {
    let previous_world_from_local = mat4x4<f32>(
        record.previous_world_from_local_x,
        record.previous_world_from_local_y,
        record.previous_world_from_local_z,
        record.previous_world_from_local_w,
    );
    return (previous_world_from_local * vec4<f32>(local_position, 1.0)).xyz;
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

fn naadf_apply_preview_fog(color: vec3<f32>, distance: f32) -> vec3<f32> {
    let fog_start = naadf_first_hit_params.fog_color_start.w;
    let fog_end = max(naadf_first_hit_params.fog_end_strength.x, fog_start + 0.001);
    let fog_strength = clamp(naadf_first_hit_params.fog_end_strength.y, 0.0, 2.0);
    let fog_t = clamp((distance - fog_start) / (fog_end - fog_start), 0.0, 1.0);
    return mix(
        color,
        naadf_first_hit_params.fog_color_start.xyz,
        clamp(fog_t * fog_strength, 0.0, 1.0),
    );
}

fn naadf_preview_miss_sky(ray_direction: vec3<f32>) -> vec3<f32> {
    let up = clamp(ray_direction.y * 0.5 + 0.5, 0.0, 1.0);
    let horizon = naadf_first_hit_params.fog_color_start.xyz;
    let zenith = mix(horizon, vec3<f32>(0.36, 0.50, 0.72), 0.65);
    let sun_direction = naadf_preview_sun_direction();
    let sun_amount = pow(max(dot(normalize(ray_direction), sun_direction), 0.0), 96.0);
    let sky = mix(horizon, zenith, up);
    return sky + vec3<f32>(1.0, 0.82, 0.55) * sun_amount * 0.45;
}

fn preview_naadf_first_hit(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_index: u32,
    max_steps: u32,
) -> NaadfFirstHitPreview {
    let hit = trace_naadf_chunk(ray, chunk_pos, chunk_index, max_steps);
    let world_pos = ray.origin + normalize(ray.direction) * hit.distance;
    return NaadfFirstHitPreview(
        hit.hit,
        naadf_preview_shaded_color(hit.material_id, hit.normal),
        hit.distance,
        hit.normal,
        world_pos,
        hit.material_id,
    );
}

fn naadf_preview_shaded_color(material_id: u32, normal: vec3<f32>) -> vec3<f32> {
    let albedo = naadf_preview_material_color(material_id);
    let sun_direction = naadf_preview_sun_direction();
    let sky_direction = vec3<f32>(0.0, 1.0, 0.0);
    let diffuse = max(dot(normalize(normal), sun_direction), 0.0);
    let sky = clamp(dot(normalize(normal), sky_direction) * 0.5 + 0.5, 0.0, 1.0);
    let ambient = mix(0.22, 0.42, sky);
    return albedo * (ambient + diffuse * 0.72);
}

fn naadf_preview_sun_direction() -> vec3<f32> {
    let sun = naadf_first_hit_params.sun_direction_pad.xyz;
    if dot(sun, sun) <= 0.000001 {
        return normalize(vec3<f32>(0.4, 0.8, 0.3));
    }
    return normalize(sun);
}

fn naadf_preview_material_color(material_id: u32) -> vec3<f32> {
    // Keep this table aligned with VoxelType in src/voxel/types.rs.
    if material_id == 1u {
        return vec3<f32>(0.28, 0.44, 0.18);
    }
    if material_id == 2u {
        return vec3<f32>(0.42, 0.38, 0.32);
    }
    if material_id == 3u {
        return vec3<f32>(0.46, 0.46, 0.43);
    }
    if material_id == 4u {
        return vec3<f32>(0.20, 0.20, 0.22);
    }
    if material_id == 5u {
        return vec3<f32>(0.72, 0.64, 0.42);
    }
    if material_id == 6u {
        return vec3<f32>(0.55, 0.42, 0.32);
    }
    if material_id == 7u {
        return vec3<f32>(0.18, 0.32, 0.76);
    }
    if material_id == 8u {
        return vec3<f32>(0.36, 0.23, 0.13);
    }
    if material_id == 9u {
        return vec3<f32>(0.16, 0.38, 0.12);
    }
    if material_id == 10u {
        return vec3<f32>(0.30, 0.30, 0.34);
    }
    if material_id == 11u {
        return vec3<f32>(0.40, 0.37, 0.32);
    }
    return vec3<f32>(0.82, 0.12, 0.72);
}
