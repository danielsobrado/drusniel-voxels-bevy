# clod-poc → WebGPURenderer migration

Goal: run clod-poc on a single renderer-owned device (Three.js `WebGPURenderer` +
TSL/NodeMaterial), matching the `docs/reference/fable5-world-demo` pattern, so GPU
compute (CLOD error_px today, more later) shares one device/queue with rendering instead
of a separate WebGPU device contending with a WebGL context.

Why: the per-frame `mapAsync` readback from a *standalone* WebGPU device while THREE
renders on WebGL is the structural source of CLOD-web stutter. fable5 keeps GPU outputs
on the GPU (one build-time readback only) because those outputs feed GPU consumers.

## Hard constraint that shapes everything

`WebGPURenderer` does **not** run raw GLSL `ShaderMaterial`. Every custom surface must be
re-authored as `NodeMaterial`/TSL. That is the bulk of the work. Each port changes pixels,
and visual QA runs in a real browser/GPU — so each material is its own QA-gated phase, not
a big-bang.

## Surface inventory (what must be ported)

| Surface | File | Notes / risk |
|---|---|---|
| Terrain | [src/material.ts](../src/material.ts), [src/terrain_shader.ts](../src/terrain_shader.ts) | ~290-line fragment shader. `sampler2DArray` (DataArrayTexture) albedo+normal, triplanar, per-vertex paint blend (paintSlots/paintWeights attrs), dithered LOD cross-fade (`discard`), `dFdx/dFdy` normal-divergence debug, hemi+spec lighting, world-space normals. Highest effort. |
| Grass | [src/grass.ts](../src/grass.ts) | ~930 lines, `InstancedBufferGeometry` + custom instance attrs (aOffset/aHeight/aRotY/aPhase/aColorMix/aEdgeFade/aNormalY), wind vertex animation, 2 shader modes, **alpha-to-coverage** (needs MSAA target) + ordered-dither fallback. |
| Stones | [src/stones/stone_instances.ts](../src/stones/stone_instances.ts) | Instanced, smaller GLSL surface. |
| Sky/env | [src/environment.ts](../src/environment.ts) | Sky dome shader, hooks `renderer` type. |
| Post-process | [src/postprocess.ts](../src/postprocess.ts) | Offscreen `WebGLRenderTarget` @ 4× MSAA + fullscreen copy/output passes (exposure/contrast/saturation/vignette), `tonemapping_fragment`/`colorspace_fragment` chunks. Replaced by the WebGPU post pipeline (PostProcessing/`pass`). |

Renderer plumbing: `THREE.WebGLRenderer` created in [src/main.ts](../src/main.ts) (~L464),
render loop at `setAnimationLoop` (~L3174) drives `postProcess.render(scene, camera)`.
`PostProcessPipeline` and `SkyEnvironment` are typed to `WebGLRenderer` and need widening.

## Phases (each ends at a QA gate the user runs)

### Phase 0 — three.js upgrade ✅ DONE (this branch)
- three `0.169 → 0.184.0`, `@types/three → ^0.184.1` (matches fable5).
- Only breakage: `Texture.image` is now typed `{}` → narrowed at the two `buildDataArray`
  call sites in main.ts.
- **Gate:** typecheck ✅, build ✅, rendering-adjacent tests ✅. **User QA: run the WebGL
  app on 0.184 and confirm visuals/behaviour unchanged before any renderer work.**
  `http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1`

### Phase 1 — WebGPURenderer + TSL spike (de-risk)
- Standalone, disposable bring-up behind `?webgpuSpike=1`: `WebGPURenderer` (`three/webgpu`)
  + a TSL `NodeMaterial` rendering a known geometry, with `await renderer.init()` and the
  `renderAsync` loop. Proves the toolchain works in *our* Vite + three-0.184 setup and frame
  timing is sane. Does not touch the real app path.
- **Gate:** spike renders + holds frame rate in the user's browser/GPU.

### Phase 2 — renderer abstraction + terrain port
- `createRenderer(useWebGpu)` factory; widen `PostProcessPipeline`/`SkyEnvironment` renderer
  types. Under `?webgpu=1`: WebGPURenderer path, WebGL stays default.
- Port terrain to a NodeMaterial (texture-array sampling, triplanar, paint blend, LOD dither,
  world-normal lighting). Other surfaces may be absent under `?webgpu=1` until their phase.
- **Gate:** terrain matches WebGL reference shots (use the bench screenshot checkpoints).

### Phase 3 — grass + stones
- Instanced NodeMaterials with instance attributes via TSL; reproduce wind animation and the
  alpha-to-coverage / dither fade (WebGPU MSAA target).
- **Gate:** grass density/fade/AA and stones match reference shots.

### Phase 4 — sky/env + post-process
- Port sky dome; replace PostProcessPipeline with the WebGPU post chain (exposure/contrast/
  saturation/vignette/tonemapping/colorspace). Retire the WebGL MSAA render target.
- **Gate:** full-scene parity; WebGPU becomes default, WebGL kept as fallback flag.

### Phase 5 — single shared device for compute (the payoff)
- Hand the renderer-owned `GPUDevice` to `ClodErrorPxCompute.create(nodes, device)` (already
  supports an injected device) instead of `requestWebGpuDevice()`. One device/queue for
  compute + render.
- Optional stretch: move the per-frame readback off the hot path (decision-mask readback or
  GPU-side selection) now that compute and render share a device.
- **Gate:** re-run the bench scene; compare frame-time consistency + `webgpu` stats vs the
  WebGL baseline.

## Known gotchas to resolve during the ports
- `dFdx/dFdy` (terrain normal-divergence debug) → TSL `dFdx`/`dFdy` nodes or drop the debug view under WebGPU.
- `sampler2DArray`/`DataArrayTexture` sampling in TSL (`texture(...).depth` layer index).
- Alpha-to-coverage requires an MSAA-configured WebGPU target; confirm support path.
- World-space normals: terrain meshes carry world normals (no normalMatrix) — replicate, don't let a stock material re-derive view normals.
- `renderAsync` vs sync `render`; first-frame `await renderer.init()`.
- `tonemapping_fragment`/`colorspace_fragment` GLSL chunks have no WebGPU equivalent — use renderer tone-mapping/output-color-space + TSL.

## Rollback
WebGL path stays the default through Phase 4; every phase is behind a flag and on this
branch. Reverting is dropping the branch or the flag.
