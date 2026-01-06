#import bevy_pbr::mesh_view_bindings
#import bevy_pbr::mesh_bindings
#import bevy_pbr::mesh_functions

struct TriplanarUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,
}

@group(2) @binding(0) var<uniform> uniforms: TriplanarUniforms;

// Texture Arrays
@group(2) @binding(1) var t_diffuse: texture_2d_array<f32>;
@group(2) @binding(2) var s_diffuse: sampler;
@group(2) @binding(3) var t_normal: texture_2d_array<f32>;
@group(2) @binding(4) var s_normal: sampler;

struct VertexInput {
    @builtin(vertex_index) vertex_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(6) color: vec4<f32>, // Using color.r for material index
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec4<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) material_index: i32,
    @location(4) ao: f32,
}

@vertex
fn vertex(vertex: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Standard mesh transform
    var world_from_local = mesh_functions::get_world_from_local(vertex.vertex_index);
    out.world_position = mesh_functions::mesh_position_local_to_world(world_from_local, vec4<f32>(vertex.position, 1.0));
    out.world_normal = mesh_functions::mesh_normal_local_to_world(vertex.normal, vertex.vertex_index);
    out.clip_position = mesh_functions::mesh_position_world_to_clip(out.world_position);
    
    out.uv = vertex.uv;
    
    // The material index is stored in the red channel of the vertex color
    // We assume the mesher puts the index there.
    // Index 0 = Grass, 1 = Dirt, 2 = Rock, 3 = Sand, etc.
    out.material_index = i32(vertex.color.a * 255.0 + 0.5); 
    out.ao = vertex.color.r;
    
    return out;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample texture array
    let layer = clamp(in.material_index, 0, 3);
    
    // Simple diffuse sample
    let diffuse = textureSample(t_diffuse, s_diffuse, in.uv, layer);
    
    // Apply lighting (simplified for custom shader, or we could use PBR)
    // For now, let's just return diffuse * lighting manually or try to hook into PBR structure?
    // Bevy's PBR functions are complex to construct manually without the full PBR input struct.
    // 
    // To properly support PBR with a custom material, we need to output the standard PBR components.
    // But since we are writing a complete shader replacement, we can do a simplified lighting.
    
    // Basic Directional Light approximation
    // (In real Bevy PBR, we would fill a PbrInput struct and call pbr_functions)
    
    let N = normalize(in.world_normal);
    let L = normalize(vec3<f32>(0.5, 1.0, 0.5)); // Arbitrary sun dir
    let NdotL = max(dot(N, L), 0.0);
    let ao = clamp(in.ao, 0.0, 1.0);
    let ambient = vec3<f32>(0.3, 0.3, 0.4) * ao;
    
    let lighting = ambient + vec3<f32>(1.0, 0.95, 0.8) * NdotL;
    
    return diffuse * vec4<f32>(lighting, 1.0) * 500.0;
}
