// Dressing GPU authority field bindings. Layout must match DressingGpuCompute.
@group(0) @binding(7) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(8) var<uniform> fieldParams : FieldParams;
@group(0) @binding(10) var canonical_height_atlas: texture_2d<f32>;
@group(0) @binding(11) var canonical_height_residency: texture_2d<i32>;
@group(0) @binding(12) var<uniform> canonical_height_atlas_params: vec4<f32>;
