// Simple LOD shader - Minimal unlit material for distant props
// No normal maps, no PBR, just albedo + fog = very cheap fragment shader

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::view

struct SimpleLodUniforms {
    base_color: vec4<f32>,
    fog_start: f32,
    fog_end: f32,
    ambient: f32,
    _padding: f32,
    fog_color: vec4<f32>,
};

@group(2) @binding(0) var<uniform> uniforms: SimpleLodUniforms;
@group(2) @binding(1) var albedo_texture: texture_2d<f32>;
@group(2) @binding(2) var albedo_sampler: sampler;

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample albedo texture
    let albedo = textureSample(albedo_texture, albedo_sampler, in.uv);

    // Apply base color tint
    var color = albedo.rgb * uniforms.base_color.rgb;

    // Simple ambient lighting (no normals needed)
    color = color * uniforms.ambient;

    // Apply fog based on distance from camera
    let distance = length(view.world_position - in.world_position.xyz);
    let fog_range = max(uniforms.fog_end - uniforms.fog_start, 1.0);
    let fog_factor = clamp((distance - uniforms.fog_start) / fog_range, 0.0, 1.0);

    // Blend toward fog color
    let final_color = mix(color, uniforms.fog_color.rgb, fog_factor);

    return vec4<f32>(final_color, albedo.a);
}
