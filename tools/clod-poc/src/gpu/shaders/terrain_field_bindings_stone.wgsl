// Stone scatter field bindings. Layout must match StoneGpuScatterCompute.

@group(0) @binding(5) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(6) var<uniform> fieldParams : FieldParams;
