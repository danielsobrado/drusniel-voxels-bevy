// Stone scatter field bindings. Layout must match StoneGpuScatterCompute.

@group(0) @binding(5) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(6) var<uniform> fieldParams : FieldParams;
@group(0) @binding(7) var hydro_texture: texture_2d<f32>;
@group(0) @binding(8) var hydro_sampler: sampler;
