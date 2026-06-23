// Understory ring field bindings. Layout must match UnderstoryGpuRingCompute.

@group(0) @binding(7) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(8) var<uniform> fieldParams : FieldParams;
