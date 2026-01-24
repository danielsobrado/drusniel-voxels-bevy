#import bevy_pbr::{
    mesh_functions,
    forward_io::{Vertex, VertexOutput},
    pbr_fragment,
    pbr_functions,
    pbr_types,
}

const DEBUG_FORCE_ALBEDO: bool = false;
const DEBUG_ALBEDO_COLOR: vec4<f32> = vec4<f32>(1.0, 0.0, 1.0, 1.0);

struct TriplanarUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: TriplanarUniforms;

// Texture Arrays
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var t_diffuse: texture_2d_array<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var s_diffuse: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var t_normal: texture_2d_array<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var s_normal: sampler;

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;
    let world_from_local = mesh_functions::get_world_from_local(vertex.instance_index);

#ifdef VERTEX_NORMALS
    out.world_normal = mesh_functions::mesh_normal_local_to_world(vertex.normal, vertex.instance_index);
#endif

#ifdef VERTEX_POSITIONS
    out.world_position = mesh_functions::mesh_position_local_to_world(
        world_from_local,
        vec4<f32>(vertex.position, 1.0)
    );
    out.position = mesh_functions::mesh_position_local_to_clip(
        world_from_local,
        vec4<f32>(vertex.position, 1.0)
    );
#endif

#ifdef VERTEX_UVS_A
    out.uv = vertex.uv;
#endif

#ifdef VERTEX_COLORS
    out.color = vertex.color;
#endif

#ifdef VERTEX_OUTPUT_INSTANCE_INDEX
    out.instance_index = vertex.instance_index;
#endif

#ifdef VISIBILITY_RANGE_DITHER
    out.visibility_range_dither = mesh_functions::get_visibility_range_dither_level(
        vertex.instance_index,
        world_from_local[3]
    );
#endif

    return out;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> @location(0) vec4<f32> {
    var pbr_input = pbr_fragment::pbr_input_from_vertex_output(in, is_front, true);

#ifdef VERTEX_COLORS
    let material_index = i32(in.color.a * 255.0 + 0.5);
    let ao = clamp(in.color.r, 0.0, 1.0);
#else
    let material_index = 0;
    let ao = 1.0;
#endif

    // Texture array layers:
    // Grass: 0=Top, 1=Side, 2=Bottom
    // Dirt:  3=Top, 4=Side, 5=Bottom
    // Rock:  6=Top, 7=Side, 8=Bottom
    // Sand:  9=Top, 10=Side, 11=Bottom
    let layer = clamp(material_index, 0, 11);
    let diffuse = textureSample(t_diffuse, s_diffuse, in.uv, layer) * uniforms.base_color;

    pbr_input.material.base_color = diffuse;
    pbr_input.material.perceptual_roughness = 0.9;
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
