#import "shaders/naadf/ray_trace.wgsl" NaadfRay
#import "shaders/naadf/world_trace.wgsl" trace_naadf_world

struct NaadfGiTraceParams {
    enabled: u32,
    sample_count: u32,
    sky_strength: f32,
    bounce_strength: f32,
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    config: vec4<u32>,
}

@group(3) @binding(28) var<uniform> naadf_gi_params: NaadfGiTraceParams;
@group(3) @binding(29) var naadf_gi_source_color: texture_2d<f32>;
@group(3) @binding(30) var naadf_gi_source_depth: texture_2d<f32>;
@group(3) @binding(31) var naadf_gi_source_normal: texture_2d<f32>;
@group(3) @binding(32) var naadf_gi_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_gi_trace(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_gi_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let color = textureLoad(naadf_gi_source_color, coord, 0);
    if color.a <= 0.0 || naadf_gi_params.enabled == 0u || naadf_gi_params.sample_count == 0u {
        textureStore(naadf_gi_output, coord, color);
        return;
    }

    let depth = textureLoad(naadf_gi_source_depth, coord, 0).x;
    if depth >= 1.0 {
        textureStore(naadf_gi_output, coord, color);
        return;
    }

    let normal = normalize(textureLoad(naadf_gi_source_normal, coord, 0).xyz * 2.0 - vec3<f32>(1.0));
    let view_ray = naadf_gi_camera_ray(coord, output_size);
    let hit_position = naadf_gi_params.camera_origin_max_distance.xyz +
        view_ray * (depth * naadf_gi_params.camera_origin_max_distance.w);
    let origin = hit_position + normal * 0.08;
    let sample_count = min(naadf_gi_params.sample_count, 8u);
    var indirect = vec3<f32>(0.0);
    var traced = 0u;

    for (var sample_index = 0u; sample_index < sample_count; sample_index = sample_index + 1u) {
        let bounce_dir = naadf_cosine_hemisphere_direction(normal, coord, sample_index, naadf_gi_params.config.w);
        let ray = NaadfRay(origin, bounce_dir, 96.0, 1u);
        let hit = trace_naadf_world(
            ray,
            naadf_gi_params.config.x,
            naadf_gi_params.config.y,
            naadf_gi_params.config.z,
        );
        traced = traced + 1u;
        if hit.hit != 0u {
            let albedo = naadf_gi_material_color(hit.material_id);
            let sun_visibility = naadf_gi_sun_visibility(
                ray.origin + bounce_dir * max(hit.distance - 0.04, 0.0) + hit.normal * 0.08,
                hit.normal,
                naadf_gi_params.config.xyz,
            );
            let sun = max(dot(hit.normal, naadf_gi_sun_direction()), 0.0) * sun_visibility;
            indirect = indirect + albedo * (0.22 + sun * 0.65);
        } else {
            indirect = indirect + naadf_gi_sky_term(bounce_dir);
        }
    }

    let bounce = indirect / max(f32(traced), 1.0);
    let lit = color.xyz +
        bounce * naadf_gi_params.bounce_strength +
        naadf_gi_sky_term(normal) * naadf_gi_params.sky_strength * 0.35;
    textureStore(naadf_gi_output, coord, vec4<f32>(lit, color.a));
}

fn naadf_gi_sun_visibility(origin: vec3<f32>, normal: vec3<f32>, config: vec3<u32>) -> f32 {
    let sun_direction = naadf_gi_sun_direction();
    if dot(normal, sun_direction) <= 0.0 {
        return 0.0;
    }
    let ray = NaadfRay(origin, sun_direction, 80.0, 2u);
    let hit = trace_naadf_world(ray, config.x, config.y, config.z);
    return select(1.0, 0.0, hit.hit != 0u);
}

fn naadf_gi_camera_ray(coord: vec2<i32>, output_size: vec2<u32>) -> vec3<f32> {
    let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) / vec2<f32>(output_size);
    let ndc = uv * 2.0 - vec2<f32>(1.0);
    let fov_scale = tan(naadf_gi_params.camera_forward_fov_y.w * 0.5);
    return normalize(
        naadf_gi_params.camera_forward_fov_y.xyz +
        naadf_gi_params.camera_right_aspect.xyz * (ndc.x * naadf_gi_params.camera_right_aspect.w * fov_scale) +
        naadf_gi_params.camera_up_pad.xyz * (-ndc.y * fov_scale),
    );
}

fn naadf_cosine_hemisphere_direction(normal: vec3<f32>, coord: vec2<i32>, sample_index: u32, frame_index: u32) -> vec3<f32> {
    let seed = naadf_hash3(vec3<u32>(
        vec2<u32>(coord) ^ vec2<u32>(frame_index * 1664525u, frame_index * 1013904223u),
        sample_index ^ (frame_index * 747796405u),
    ));
    let r1 = seed.x;
    let r2 = seed.y;
    let phi = 6.2831853 * r1;
    let radius = sqrt(r2);
    let local = vec3<f32>(
        cos(phi) * radius,
        sin(phi) * radius,
        sqrt(max(0.0, 1.0 - r2)),
    );
    let up = normalize(normal);
    let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(up.y) > 0.95);
    let tangent = normalize(cross(helper, up));
    let bitangent = cross(up, tangent);
    return normalize(tangent * local.x + bitangent * local.y + up * local.z);
}

fn naadf_hash3(value: vec3<u32>) -> vec3<f32> {
    var state = value.x * 1664525u + value.y * 1013904223u + value.z * 747796405u + 2891336453u;
    state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    let a = (state >> 22u) ^ state;
    state = a * 1664525u + 1013904223u;
    state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    let b = (state >> 22u) ^ state;
    state = b * 1664525u + 1013904223u;
    state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    let c = (state >> 22u) ^ state;
    return vec3<f32>(
        f32(a & 0x00ffffffu),
        f32(b & 0x00ffffffu),
        f32(c & 0x00ffffffu),
    ) / f32(0x01000000u);
}

fn naadf_gi_sun_direction() -> vec3<f32> {
    let sun = naadf_gi_params.sun_direction_pad.xyz;
    if dot(sun, sun) <= 0.000001 {
        return normalize(vec3<f32>(0.4, 0.8, 0.3));
    }
    return normalize(sun);
}

fn naadf_gi_material_color(material_id: u32) -> vec3<f32> {
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

fn naadf_gi_sky_term(direction: vec3<f32>) -> vec3<f32> {
    let sky_visibility = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    return vec3<f32>(0.48, 0.58, 0.72) * sky_visibility;
}
