// Blocky terrain shader - uses texture array for material sampling
// Uses Bevy's standard vertex shader to avoid binding conflicts

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::{pbr_fragment, pbr_functions, pbr_types}

const DEBUG_FORCE_ALBEDO: bool = false;
const DEBUG_ALBEDO_COLOR: vec4<f32> = vec4<f32>(1.0, 0.0, 1.0, 1.0);

// Material roughness - lower = shinier, brighter appearance
const BLOCKY_ROUGHNESS: f32 = 0.75;
// AO strength - 0.0 = ignore vertex AO (brighter), 1.0 = full vertex AO (darker shadows)
const AO_STRENGTH: f32 = 0.3;

struct BlockyUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: BlockyUniforms;

// Texture Array (12 layers: 4 materials * 3 faces each)
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var t_diffuse: texture_2d_array<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var s_diffuse: sampler;
// Normal texture bindings removed to fix conflict with Bevy's default vertex shader

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> @location(0) vec4<f32> {
    var pbr_input = pbr_fragment::pbr_input_from_vertex_output(in, is_front, true);

#ifdef VERTEX_COLORS
    let material_index = i32(in.color.a * 255.0 + 0.5);
    let vertex_ao = clamp(in.color.r, 0.0, 1.0);
#else
    let material_index = 0;
    let vertex_ao = 1.0;
#endif

    // Apply AO with controllable strength (0.0 = bright, 1.0 = full shadows)
    let ao = mix(1.0, vertex_ao, AO_STRENGTH);

    // Texture array layers:
    // Grass: 0=Top, 1=Side, 2=Bottom
    // Dirt:  3=Top, 4=Side, 5=Bottom
    // Rock:  6=Top, 7=Side, 8=Bottom
    // Sand:  9=Top, 10=Side, 11=Bottom
    let layer = clamp(material_index, 0, 11);
    let diffuse = textureSample(t_diffuse, s_diffuse, in.uv, layer) * uniforms.base_color;

    pbr_input.material.base_color = diffuse;
    pbr_input.material.perceptual_roughness = BLOCKY_ROUGHNESS;
    pbr_input.material.metallic = 0.0;
    pbr_input.N = normalize(pbr_input.world_normal);
    pbr_input.diffuse_occlusion = vec3<f32>(ao);
    pbr_input.specular_occlusion = ao;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_DOUBLE_SIDED_BIT;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_FOG_ENABLED_BIT;

    if (DEBUG_FORCE_ALBEDO) {
        pbr_input.material.base_color = DEBUG_ALBEDO_COLOR;
        pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT;
    }

    var color: vec4<f32>;
    if ((pbr_input.material.flags & pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT) == 0u) {
        color = pbr_functions::apply_pbr_lighting(pbr_input);
    } else {
        color = pbr_input.material.base_color;
    }

    color = pbr_functions::main_pass_post_lighting_processing(pbr_input, color);
    return color;
}
