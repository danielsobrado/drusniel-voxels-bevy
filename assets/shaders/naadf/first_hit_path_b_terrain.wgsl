#import "shaders/naadf/ray_trace.wgsl" NaadfHit, NaadfRay
#import "shaders/naadf/world_trace.wgsl" naadf_world_surface_normal, trace_naadf_world, trace_naadf_world_lod

struct NaadfFirstHitParams {
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    config: vec4<u32>,
    telemetry_config: vec4<u32>,
    local_light_config: vec4<u32>,
    fog_color_start: vec4<f32>,
    fog_end_strength: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    path_b_config: vec4<f32>,
    view_from_clip: mat4x4<f32>,
    previous_clip_from_world: mat4x4<f32>,
}

struct NaadfFirstHitPreview {
    hit: u32,
    color: vec3<f32>,
    distance: f32,
    normal: vec3<f32>,
    previous_world_position: vec3<f32>,
    material_id: u32,
    diagnostic_reason: f32,
}

@group(3) @binding(16) var<uniform> naadf_first_hit_params: NaadfFirstHitParams;
@group(3) @binding(17) var naadf_first_hit_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(18) var naadf_first_hit_depth_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(19) var naadf_first_hit_normal_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(23) var naadf_first_hit_motion_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(39) var naadf_terrain_albedo_array: texture_2d_array<f32>;
@group(3) @binding(40) var naadf_terrain_sampler: sampler;
@group(3) @binding(41) var naadf_first_hit_scene_depth: texture_depth_2d;

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
    let ray_max_distance = naadf_path_b_first_hit_max_distance(
        uv,
        vec2<i32>(id.xy),
        ray_direction,
        naadf_first_hit_params.camera_origin_max_distance.w,
    );
    let ray = NaadfRay(
        naadf_first_hit_params.camera_origin_max_distance.xyz,
        ray_direction,
        ray_max_distance,
        5u,
    );
    let cone_spread = (2.0 * fov_scale) / max(f32(output_size.y), 1.0);
    let terrain_preview = preview_naadf_first_hit_world(
        ray,
        naadf_first_hit_params.config.xyz,
        vec4<f32>(1.0, cone_spread, naadf_lod_threshold_jitter(id.xy), 0.0),
    );
    let preview = terrain_preview;

    let miss_color = naadf_preview_miss_sky(ray_direction);
    let fogged_color = naadf_apply_preview_fog(preview.color, preview.distance);
    let color = select(miss_color, fogged_color, preview.hit != 0u);
    let alpha = select(0.0, 1.0, preview.hit != 0u);
    let linear_view_depth = select(
        ray.max_distance,
        max(dot(normalize(ray.direction), normalize(naadf_first_hit_params.camera_forward_fov_y.xyz)) * preview.distance, 0.0),
        preview.hit != 0u,
    );
    let ray_distance = select(ray.max_distance, preview.distance, preview.hit != 0u);
    let diagnostic_reason = preview.diagnostic_reason;
    let normal = select(vec3<f32>(0.5), preview.normal * 0.5 + vec3<f32>(0.5), preview.hit != 0u);
    let motion = naadf_first_hit_motion(uv, ray, preview);
    let coord = vec2<i32>(id.xy);
    textureStore(
        naadf_first_hit_output,
        coord,
        vec4<f32>(color, alpha),
    );
    textureStore(
        naadf_first_hit_depth_output,
        coord,
        vec4<f32>(linear_view_depth, ray_distance, diagnostic_reason, alpha),
    );
    textureStore(naadf_first_hit_normal_output, coord, vec4<f32>(normal, 1.0));
    textureStore(naadf_first_hit_motion_output, coord, motion);
}

fn naadf_path_b_first_hit_max_distance(
    uv: vec2<f32>,
    coord: vec2<i32>,
    ray_direction: vec3<f32>,
    fallback_max_distance: f32,
) -> f32 {
    if naadf_first_hit_params.path_b_config.y <= 0.5 || naadf_first_hit_params.path_b_config.z <= 0.5 {
        return fallback_max_distance;
    }
    let depth_size = textureDimensions(naadf_first_hit_scene_depth);
    let depth_coord = clamp(coord, vec2<i32>(0), vec2<i32>(depth_size) - vec2<i32>(1));
    let scene_depth = textureLoad(naadf_first_hit_scene_depth, depth_coord, 0);
    if scene_depth <= 0.001 {
        return fallback_max_distance;
    }
    let ndc = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), scene_depth, 1.0);
    let view = naadf_first_hit_params.view_from_clip * ndc;
    let view_pos = view.xyz / max(view.w, 0.000001);
    let raster_linear_depth = max(-view_pos.z, 0.0);
    let view_depth_per_ray_unit = max(
        dot(normalize(ray_direction), normalize(naadf_first_hit_params.camera_forward_fov_y.xyz)),
        0.0001,
    );
    let depth_epsilon = max(naadf_first_hit_params.path_b_config.x, 0.0);
    let raster_ray_distance = max((raster_linear_depth - depth_epsilon) / view_depth_per_ray_unit, 0.001);
    return min(fallback_max_distance, raster_ray_distance);
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

fn naadf_lod_threshold_jitter(pixel: vec2<u32>) -> f32 {
    let seed = pixel.x * 1664525u + pixel.y * 1013904223u + naadf_first_hit_params.config.y;
    let hashed = ((seed >> 8u) ^ seed) & 255u;
    return (f32(hashed) / 255.0 - 0.5) * 0.35;
}

fn preview_naadf_first_hit_world(
    ray: NaadfRay,
    config: vec3<u32>,
    cone_config: vec4<f32>,
) -> NaadfFirstHitPreview {
    let hit = trace_naadf_world_lod(ray, config.x, config.y, config.z, cone_config);
    naadf_record_first_hit_telemetry(hit);
    if hit.hit == 0u {
        return naadf_first_hit_preview_miss(
            ray.max_distance,
            naadf_first_hit_diagnostic_reason(hit.miss_reason),
        );
    }
    return preview_naadf_first_hit_from_hit(ray, hit, config);
}

fn naadf_record_first_hit_telemetry(hit: NaadfHit) {
}

fn naadf_first_hit_preview_miss(max_distance: f32, diagnostic_reason: f32) -> NaadfFirstHitPreview {
    return NaadfFirstHitPreview(
        0u,
        vec3<f32>(0.0),
        max_distance,
        vec3<f32>(0.0),
        vec3<f32>(0.0),
        0u,
        diagnostic_reason,
    );
}

fn preview_naadf_first_hit_from_hit(ray: NaadfRay, hit: NaadfHit, config: vec3<u32>) -> NaadfFirstHitPreview {
    let world_pos = ray.origin + normalize(ray.direction) * hit.distance;
    let normal = naadf_world_surface_normal(hit, config.y, config.z);
    let texture_lod = naadf_texture_lod_for_hit(hit.distance);
    let albedo = naadf_preview_textured_albedo(hit.material_id, world_pos, normal, texture_lod);
    let base_color = naadf_preview_shaded_color_with_albedo(albedo, normal);
    return NaadfFirstHitPreview(
        hit.hit,
        base_color + naadf_preview_local_light_color(albedo, world_pos, normal, config),
        hit.distance,
        normal,
        world_pos,
        hit.material_id,
        0.0,
    );
}

fn naadf_first_hit_diagnostic_reason(miss_reason: u32) -> f32 {
    if miss_reason == 2u || miss_reason == 3u {
        return 3.0;
    }
    if miss_reason == 5u {
        return 2.0;
    }
    return 1.0;
}

fn naadf_texture_lod_for_hit(distance: f32) -> f32 {
    let spread = tan(naadf_first_hit_params.camera_forward_fov_y.w * 0.5) / 360.0;
    return clamp(log2(max(1.0 + distance * spread, 1.0)), 0.0, 8.0);
}

fn naadf_preview_textured_albedo(
    material_id: u32,
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
    texture_lod: f32,
) -> vec3<f32> {
    let weights = naadf_triplanar_weights(world_normal);
    let uv_yz = world_pos.yz / 2.0;
    let uv_xz = world_pos.xz / 2.0;
    let uv_xy = world_pos.xy / 2.0;
    let layer_x = naadf_blocky_array_layer(material_id, vec3<f32>(sign(world_normal.x), 0.0, 0.0));
    let layer_y = naadf_blocky_array_layer(material_id, vec3<f32>(0.0, sign(world_normal.y), 0.0));
    let layer_z = naadf_blocky_array_layer(material_id, vec3<f32>(0.0, 0.0, sign(world_normal.z)));
    return textureSampleLevel(naadf_terrain_albedo_array, naadf_terrain_sampler, uv_yz, layer_x, texture_lod).rgb * weights.x +
        textureSampleLevel(naadf_terrain_albedo_array, naadf_terrain_sampler, uv_xz, layer_y, texture_lod).rgb * weights.y +
        textureSampleLevel(naadf_terrain_albedo_array, naadf_terrain_sampler, uv_xy, layer_z, texture_lod).rgb * weights.z;
}

fn naadf_triplanar_weights(world_normal: vec3<f32>) -> vec3<f32> {
    let normal_abs = abs(world_normal);
    let sharp = pow(normal_abs, vec3<f32>(4.0));
    return sharp / max(sharp.x + sharp.y + sharp.z, 0.001);
}

fn naadf_blocky_array_layer(material_id: u32, normal: vec3<f32>) -> i32 {
    let base = naadf_blocky_material_base(material_id);
    if normal.y > 0.5 {
        return i32(base);
    }
    if normal.y < -0.5 {
        return i32(base + 2u);
    }
    return i32(base + 1u);
}

fn naadf_blocky_material_base(material_id: u32) -> u32 {
    if material_id == 1u || material_id == 9u {
        return 0u;
    }
    if material_id == 2u || material_id == 6u || material_id == 8u {
        return 3u;
    }
    if material_id == 3u || material_id == 4u || material_id == 10u || material_id == 11u {
        return 6u;
    }
    if material_id == 5u {
        return 9u;
    }
    return 0u;
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

fn naadf_preview_shaded_color(material_id: u32, normal: vec3<f32>) -> vec3<f32> {
    let albedo = naadf_preview_material_color(material_id);
    return naadf_preview_shaded_color_with_albedo(albedo, normal);
}

fn naadf_preview_shaded_color_with_albedo(albedo: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    let sun_direction = naadf_preview_sun_direction();
    let sky_direction = vec3<f32>(0.0, 1.0, 0.0);
    let diffuse = max(dot(normalize(normal), sun_direction), 0.0);
    let sky = clamp(dot(normalize(normal), sky_direction) * 0.5 + 0.5, 0.0, 1.0);
    let ambient = mix(0.22, 0.42, sky);
    return albedo * (ambient + diffuse * 0.72);
}

fn naadf_preview_local_light_color(
    albedo: vec3<f32>,
    world_pos: vec3<f32>,
    normal: vec3<f32>,
    trace_config: vec3<u32>,
) -> vec3<f32> {
    return vec3<f32>(0.0);
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
