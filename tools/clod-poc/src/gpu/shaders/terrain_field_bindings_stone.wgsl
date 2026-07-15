// Stone scatter field bindings. Layout must match StoneGpuScatterCompute.

@group(0) @binding(5) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(6) var<uniform> fieldParams : FieldParams;
@group(0) @binding(7) var hydro_texture: texture_2d<f32>;
@group(0) @binding(8) var hydro_sampler: sampler;
@group(0) @binding(9) var hydro_atlas_texture: texture_2d<f32>;
@group(0) @binding(10) var canonical_height_atlas: texture_2d<f32>;
@group(0) @binding(11) var canonical_height_residency: texture_2d<i32>;
@group(0) @binding(12) var<uniform> canonical_height_atlas_params: vec4<f32>;
