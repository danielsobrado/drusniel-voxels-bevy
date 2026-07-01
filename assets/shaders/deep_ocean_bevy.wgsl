#import bevy_pbr::mesh_view_bindings::view
#import bevy_pbr::mesh_functions::get_world_from_local

struct DeepOceanUniforms {
    // x = time, y = surface y, z = outside-border start, w = level id
    time_surface_start_level: vec4<f32>,
    // xy = wind direction, z = wind speed, w = height scale
    wind_wave: vec4<f32>,
    // x = choppiness, y = coarse patch, z = fine patch, w = foam threshold
    wave_patch: vec4<f32>,
    // x = foam power, y = foam intensity, z/w = inner fade
    foam_fade: vec4<f32>,
    // x/y = outer fade, z = roughness, w = reserved
    fade_outer: vec4<f32>,
    // x = min x, y = max x, z = min z, w = max z
    bounds: vec4<f32>,
    deep_color: vec4<f32>,
    shallow_color: vec4<f32>,
    foam_color: vec4<f32>,
    fog_color: vec4<f32>,
    // x = fresnel power, y = fresnel strength, z = reflection strength, w = reflection distortion
    shading: vec4<f32>,
    // x = fog near, y = fog far, z = fog density, w = roughness
    fog: vec4<f32>,
    sun_direction: vec4<f32>,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: DeepOceanUniforms;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) wave_slope: vec2<f32>,
    @location(2) foam_value: f32,
};

fn ocean_wave(
    world_xz: vec2<f32>,
    direction: vec2<f32>,
    wavelength: f32,
    amplitude: f32,
    speed: f32,
    time_seconds: f32,
    choppiness: f32,
) -> vec4<f32> {
    let k = 6.28318530718 / max(wavelength, 0.001);
    let phase = dot(world_xz, direction) * k + time_seconds * speed;
    let sine_value = sin(phase);
    let cosine_value = cos(phase);
    let slope_scale = amplitude * k * max(choppiness, 0.0);
    return vec4<f32>(
        sine_value * amplitude,
        direction.x * cosine_value * slope_scale,
        direction.y * cosine_value * slope_scale,
        abs(cosine_value * slope_scale),
    );
}

fn deep_ocean_wave_sample(world_xz: vec2<f32>) -> vec4<f32> {
    let time_seconds = uniforms.time_surface_start_level.x;
    let wind_speed = uniforms.wind_wave.z;
    let height_scale = uniforms.wind_wave.w;
    let choppiness = uniforms.wave_patch.x;
    let coarse_patch = uniforms.wave_patch.y;
    let fine_patch = uniforms.wave_patch.z;
    let foam_threshold = uniforms.wave_patch.w;
    let foam_power = uniforms.foam_fade.x;
    let wind = normalize(uniforms.wind_wave.xy);
    let cross_wind = vec2<f32>(-wind.y, wind.x);
    let speed = sqrt(max(wind_speed, 0.01)) * 0.42;

    let swell_a = ocean_wave(world_xz, wind, coarse_patch, height_scale * 0.58, speed, time_seconds, choppiness * 0.32);
    let swell_b = ocean_wave(world_xz, normalize(wind * 0.78 + cross_wind * 0.22), coarse_patch * 0.57, height_scale * 0.31, speed * 1.17, time_seconds, choppiness * 0.42);
    let chop_a = ocean_wave(world_xz, normalize(wind * 0.61 - cross_wind * 0.39), fine_patch, height_scale * 0.12, speed * 2.35, time_seconds, choppiness);
    let chop_b = ocean_wave(world_xz, normalize(wind * 0.36 + cross_wind * 0.64), fine_patch * 0.53, height_scale * 0.07, speed * 3.1, time_seconds, choppiness * 0.78);
    let combined = swell_a + swell_b + chop_a + chop_b;
    let slope = length(combined.yz);
    let foam = pow(smoothstep(foam_threshold, 1.0, slope), max(foam_power, 0.001));
    return vec4<f32>(combined.x, combined.y, combined.z, foam);
}

fn outside_distance(world_xz: vec2<f32>) -> f32 {
    let dx = max(max(uniforms.bounds.x - world_xz.x, 0.0), world_xz.x - uniforms.bounds.y);
    let dz = max(max(uniforms.bounds.z - world_xz.y, 0.0), world_xz.y - uniforms.bounds.w);
    return length(vec2<f32>(dx, dz));
}

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;
    let model = get_world_from_local(vertex.instance_index);
    let base_world = (model * vec4<f32>(vertex.position, 1.0)).xyz;
    let wave = deep_ocean_wave_sample(base_world.xz);
    let world_position = vec3<f32>(
        base_world.x,
        uniforms.time_surface_start_level.y + wave.x,
        base_world.z,
    );

    out.world_position = world_position;
    out.wave_slope = wave.yz;
    out.foam_value = wave.w;
    out.clip_position = view.clip_from_world * vec4<f32>(world_position, 1.0);
    return out;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let outside = outside_distance(in.world_position.xz);
    let transition_end = max(uniforms.time_surface_start_level.z, 1.0);
    let transition_fade = max(transition_end * 0.5, 1.0);
    let border_alpha = smoothstep(transition_end, transition_end + transition_fade, outside);
    if border_alpha <= 0.001 {
        discard;
    }

    let camera_distance = distance(in.world_position.xz, view.world_position.xz);
    let outer_alpha = 1.0 - smoothstep(uniforms.fade_outer.x, uniforms.fade_outer.y, camera_distance);
    let alpha = border_alpha * outer_alpha;
    if alpha <= 0.001 {
        discard;
    }

    let normal = normalize(vec3<f32>(-in.wave_slope.x, 1.0, -in.wave_slope.y));
    let view_direction = normalize(view.world_position - in.world_position);
    let sun = normalize(uniforms.sun_direction.xyz);
    let fresnel = pow(
        1.0 - max(dot(view_direction, normal), 0.0),
        max(uniforms.shading.x, 0.001),
    ) * uniforms.shading.y;

    let shallow_mix = clamp(0.18 + normal.y * 0.14 + in.foam_value * 0.12, 0.0, 1.0);
    var color = mix(uniforms.deep_color.rgb, uniforms.shallow_color.rgb, shallow_mix);
    let reflected_sky = mix(uniforms.deep_color.rgb, uniforms.fog_color.rgb, fresnel * uniforms.shading.z);
    color = mix(color, reflected_sky, fresnel);

    let half_direction = normalize(sun + view_direction);
    let roughness = max(uniforms.fog.w, 0.01);
    let specular_power = mix(180.0, 18.0, roughness);
    let sun_specular = pow(max(dot(normal, half_direction), 0.0), specular_power);
    color += vec3<f32>(sun_specular * (0.35 + uniforms.shading.z * 0.65));

    let foam_mask = clamp(in.foam_value * uniforms.foam_fade.y, 0.0, 1.0);
    color = mix(color, uniforms.foam_color.rgb, foam_mask);

    let fog_linear = smoothstep(uniforms.fog.x, uniforms.fog.y, camera_distance);
    let fog_exponential = 1.0 - exp(-uniforms.fog.z * fog_linear * 2.0);
    color = mix(color, uniforms.fog_color.rgb, clamp(fog_exponential, 0.0, 1.0));

    return vec4<f32>(color, alpha);
}
