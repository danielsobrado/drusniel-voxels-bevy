// Vitest runs in the Node environment, where the browser global `self` does not
// exist. `three/webgpu` (three.webgpu.js) reads `self.GPUShaderStage` at module
// top-level, so any suite that transitively imports it (grass.ts,
// rendering/renderer_backend.ts, …) throws `ReferenceError: self is not defined`
// at import time. Point `self` at `globalThis` so those modules load; WebGPU is
// never actually exercised headlessly, the lib just falls back to its literal
// shader-stage constants when `self.GPUShaderStage` is undefined.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}
