// Tree ring field bindings. Layout is reserved to match the upcoming TreeGpuRingCompute.

@group(0) @binding(7) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(8) var<uniform> fieldParams : FieldParams;
