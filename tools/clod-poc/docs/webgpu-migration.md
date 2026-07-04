# clod-poc → WebGPURenderer migration

Document status: historical migration record. The current app path uses the renderer
backend abstraction and WebGPU post-process pipeline; this file remains useful for
module provenance and old code comments that cite the migration phases. For current
commands and status, use `tools/clod-poc/README.md`,
`docs/plans/bevy-clod-poc-parity-status.md`, and
`tools/clod-poc/docs/performance/`.

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
| Terrain | [src/material.ts](../src/material.ts), [src/terrain_shader.ts](../src/terrain_shader.ts), [src/gpu/terrain_node_material.ts](../src/gpu/terrain_node_material.ts) | WebGPU preview has default lighting, the app's generated procedural terrain texture arrays behind `?tex=1`, triplanar normal maps behind `?normal=1`, a closer procedural parity comparison behind `?texParity=1` (macro tint + camera-distance micro-normal fade), height-band blending, per-vertex paint blend (`paintSlots`/`paintWeights`), and screen-door LOD fades behind `?lodFade=1`. Still deferred: external PBR texture-slot imports, procedural roughness/debug modes, non-triplanar path, `dFdx/dFdy` normal-divergence debug. |
| Grass | [src/grass.ts](../src/grass.ts), [src/gpu/grass_node_material.ts](../src/gpu/grass_node_material.ts) | WebGPU preview has classic grass behind `?grass=1` and terrain-patch-v2 placement/near-mid tiers behind `?grass=1&grassMode=v2`. `?grassDebugAttrs=1` colors v2 grass from `aEdgeFade`/`aNormalY`; `?grassEdgeShape=1` applies a CPU-baked `aEdgeFade` height multiplier to avoid the WebGPU vertex-stage attribute-read failure. The v2 slope/distance dither/A2C shader fades are temporarily disabled while v2 visibility is validated. |
| Stones | [src/stones/stone_instances.ts](../src/stones/stone_instances.ts), [src/gpu/stone_node_material.ts](../src/gpu/stone_node_material.ts) | WebGPU preview port behind `?webgpu=1&stones=1`; reuses the existing scatter/grouping/LOD system with an injected TSL material. |
| Sky/env | [src/environment.ts](../src/environment.ts) | Sky dome shader, hooks `renderer` type. |
| Post-process | [src/postprocess.ts](../src/postprocess.ts), [src/gpu/webgpu_postprocess.ts](../src/gpu/webgpu_postprocess.ts) | WebGPU preview port behind `?webgpu=1&post=1`: `RenderPipeline` + `pass(scene,camera)` + TSL exposure/contrast/saturation/vignette. |

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
- Current preview status: classic grass is behind `?webgpu=1&grass=1`; terrain-patch-v2
  grass is behind `?webgpu=1&grass=1&grassMode=v2` with optional `grassA2C=1`. Stones are
  behind `?webgpu=1&stones=1` and reuse `StoneSystem`; the WebGL default still uses its
  original ShaderMaterial.
- **Gate:** grass density/fade/AA and stones match reference shots.

### Phase 4 — sky/env + post-process
- Port sky dome; replace PostProcessPipeline with the WebGPU post chain (exposure/contrast/
  saturation/vignette/tonemapping/colorspace). Retire the WebGL MSAA render target.
- Current preview status: sky is already on the isolated WebGPU path; postprocess is now
  available behind `?webgpu=1&post=1` for QA before it is made part of the full app path.
- **Gate:** full-scene parity; WebGPU becomes default, WebGL kept as fallback flag.

### Dig editing preview gate
- Current preview status: `?webgpu=1&dig=1` enables orbit-click sphere carving in the
  isolated WebGPU path. It uses `TerrainColliderSet` for targeting, `addDigEdit()` for the
  shared density overlay, synchronous `rebuildDirtyPages()` for the small preview worlds,
  and swaps geometry for changed nodes already realized in the scene.
- `?digOp=add&digMaterial=<slot>` is available as a QA-only painted deposit path. WebGPU
  terrain geometry now carries `paintSlots`/`paintWeights`, and the terrain NodeMaterial
  blends painted texture layers over natural height bands.
- Deferred: worker-backed rebuild scheduling, player-mode hold-to-dig, full brush UI,
  cube/cylinder controls, and grass patch refresh after edits.

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
