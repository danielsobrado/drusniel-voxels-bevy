#import bevy_pbr::mesh_view_bindings::view

struct PropsUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    default_roughness: f32,
    fog_start: f32,
    fog_end: f32,
    aerial_strength: f32,
    _padding: f32,
    fog_color: vec4<f32>,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> props: PropsUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) i_model_0: vec4<f32>,
    @location(4) i_model_1: vec4<f32>,
    @location(5) i_model_2: vec4<f32>,
    @location(6) i_model_3: vec4<f32>,
#ifdef PROP_INSTANCE_TINT
    @location(7) i_tint: vec4<f32>,
#endif
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec4<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) uv_b: vec2<f32>,
    @location(4) world_tangent: vec4<f32>,
    @location(5) color: vec4<f32>,
    @location(8) tint: vec4<f32>,
};

@vertex
fn vertex(vertex: VertexInput) -> VertexOutput {
    let model = mat4x4<f32>(
        vertex.i_model_0,
        vertex.i_model_1,
        vertex.i_model_2,
        vertex.i_model_3
    );
    let world_position = model * vec4<f32>(vertex.position, 1.0);
    var out: VertexOutput;
    out.clip_position = view.clip_from_world * world_position;
    out.world_position = world_position;
    out.world_normal = normalize((model * vec4<f32>(vertex.normal, 0.0)).xyz);
#ifdef PROP_INSTANCE_TINT
    out.tint = vertex.i_tint;
#else
    out.tint = vec4<f32>(1.0);
#endif
    out.uv = vertex.uv;
    out.uv_b = vertex.uv;
    out.world_tangent = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    out.color = vertex.i_tint;
    return out;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    if (in.tint.a <= 0.01) {
        discard;
    }
    let world_pos = in.world_position.xyz;
    let normal = normalize(in.world_normal);
    let view_dir = normalize(view.world_position - world_pos);
    let light_dir = normalize(vec3<f32>(0.4, 0.8, 0.3));
    let half_dir = normalize(light_dir + view_dir);
    let roughness = clamp(props.default_roughness, 0.04, 1.0);
    let n_dot_l = max(dot(normal, light_dir), 0.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);
    let n_dot_h = max(dot(normal, half_dir), 0.0);
    let h_dot_v = max(dot(half_dir, view_dir), 0.0);
    let a = roughness * roughness;
    let a2 = a * a;
    let denom = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
    let d = a2 / max(3.14159265 * denom * denom, 0.001);
    let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    let g_v = n_dot_v / max(n_dot_v * (1.0 - k) + k, 0.001);
    let g_l = n_dot_l / max(n_dot_l * (1.0 - k) + k, 0.001);
    let f = vec3<f32>(0.04) + vec3<f32>(0.96) * pow(1.0 - h_dot_v, 5.0);
    let specular = (d * g_v * g_l * f) / max(4.0 * n_dot_v * n_dot_l, 0.001);
    let albedo = props.base_color.rgb * in.tint.rgb;
    let diffuse = (vec3<f32>(1.0) - f) * albedo / 3.14159265;
    var color = vec3<f32>(0.16, 0.18, 0.20) * albedo + (diffuse + specular) * vec3<f32>(1.0, 0.95, 0.9) * n_dot_l;
    let distance = length(view.world_position - world_pos);
    let fog_range = max(props.fog_end - props.fog_start, 1.0);
    let fog_factor = clamp((distance - props.fog_start) / fog_range, 0.0, 1.0) * props.aerial_strength;
    color = mix(color, props.fog_color.rgb, fog_factor);
    return vec4<f32>(color * view.exposure / 0.0010019079, props.base_color.a * in.tint.a);
}
