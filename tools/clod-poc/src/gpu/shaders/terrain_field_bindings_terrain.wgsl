// Terrain mesh field bindings. Layout must match GpuChunkMesher.

@group(0) @binding(0) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(1) var<uniform> fieldParams : FieldParams;
