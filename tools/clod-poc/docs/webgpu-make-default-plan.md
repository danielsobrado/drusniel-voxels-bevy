# clod-poc — make WebGPU the default app path

Document status: historical implementation plan. WebGPU is now the normal clod-poc app
path through `src/rendering/renderer_backend.ts`; keep this file only as background for
why the renderer abstraction, terrain material adapter, and WebGL fallback were staged.
Use `tools/clod-poc/README.md`, `docs/plans/bevy-clod-poc-parity-status.md`, and
`tools/clod-poc/docs/postfx-webgl-decommission-decision.md` for current operating state.

Companion to [webgpu-migration.md](webgpu-migration.md). That doc proved every surface
ports to WebGPU/TSL in the **isolated `?webgpu=1` preview**. This doc is the plan to land
those ports in the **real app** (`src/main.ts`) and retire the WebGL path.

## Current reality (start point)
- `?webgpu=1` runs [webgpu_preview.ts](../src/gpu/webgpu_preview.ts), which **short-circuits
  `main()`** and never touches the WebGL app. The app itself is still 100% `WebGLRenderer`.
- The preview is a slim viewer: own render loop, **synchronous main-thread build clamped to
  world 2–8**, no GUI/player-mode/import-export/debug overlays.
- WebGPU node materials already exist and are QA-able: terrain
  ([terrain_node_material.ts](../src/gpu/terrain_node_material.ts)), grass
  ([grass_node_material.ts](../src/gpu/grass_node_material.ts)), stones
  ([stone_node_material.ts](../src/gpu/stone_node_material.ts)), sky
  ([sky_node_material.ts](../src/gpu/sky_node_material.ts)), post
  ([webgpu_postprocess.ts](../src/gpu/webgpu_postprocess.ts)).
- The CLOD compute ([clod_error_px_compute.ts](../src/gpu/clod_error_px_compute.ts)) already
  accepts an injected device — Phase 5 is wiring, not a rewrite.

## The coupling that makes this hard (measured)
1. `main.ts` creates `new THREE.WebGLRenderer` and passes it into `PostProcessPipeline`,
   `SkyEnvironment`, and uses `renderer.capabilities.getMaxAnisotropy()` (3 sites). All
   WebGL-typed.
2. Terrain uses a GLSL `ShaderMaterial` whose `.uniforms.*` are poked from **dozens** of
   sites (colour, fade, dither, textures, normal-map, debug views, `colorByLod`). `NodeMaterial`
   has no `.uniforms`, so a naive swap breaks all of them.
3. Subsystems with ~41 call sites: `postProcess` (7), `skyEnvironment` (8), `grassSystem`
   (14), `stoneSystem` (12).
4. The worker build is **renderer-agnostic** (it builds meshes off-thread); rendering is
   decoupled. So the "world 2–8 / synchronous" preview limitation **disappears for free** once
   we render the app's worker-built meshes — no work needed there.

## Strategy
Flag-gate the real app on a `?webgpu=1` (or settings) backend switch, **WebGL stays default
until the final flip**. Land it in small, independently-verifiable phases. The decisive
prerequisite is a **terrain material adapter** so the dozens of uniform pokes go through one
setter interface that both backends implement — that refactor keeps WebGL working (so it's
verifiable on its own) and makes the backend swap a one-line material choice.

---

## Phase A — terrain material adapter (WebGL-only refactor, no behaviour change)
Introduce a `TerrainMaterialHandle` interface with the setters the app actually calls:
`setColor`, `setColorAdjust`, `setLighting`, `setFade(fade, fadeIn, dither)`,
`setTextures(...)`, `setDebugMode(normalColor|normalDivergence|flatUnlit|off)`,
`get material()`. Implement it for the existing `ShaderMaterial` (thin wrapper over the
current `mat.uniforms.*` writes). Refactor every `v.mat.uniforms.X.value = …` site in
`main.ts` to call the handle.
- **Risk:** low/mechanical but broad. **Gate:** WebGL app visually identical + tests green.
- Why first: it's the load-bearing change and it's verifiable entirely on WebGL.

## Phase B — renderer abstraction + boot app on WebGPU (terrain only)
- **Stop short-circuiting `main()` for the integrated path.** Keep `?webgpu=1`→preview as a
  shader QA sandbox if useful, but the integration uses a new flag `?renderer=webgpu|webgl`
  (default `webgl`) that selects a backend *inside the normal app* — same menus, project
  toolbar, debug overlay, terraform UI, player mode, app state, and worker.
- Backend layout: `src/rendering/{renderer_backend.ts, webgl_backend.ts, webgpu_backend.ts}`.
  `createAppRenderer(backend)` → `{ renderer: WebGLRenderer | WebGPURenderer, isWebGpu }`,
  with `await renderer.init()` on the WebGPU branch. Type `renderer` as the union.
- The **worker build is renderer-agnostic** — the integrated WebGPU path reuses the existing
  worker-backed build/rebuild and renders its meshes, so the preview's "sync, world ≤8" limit
  vanishes for free. No separate work item for build/world size.
- Replace the 3 `renderer.capabilities.getMaxAnisotropy()` calls with a `maxAnisotropy`
  computed once (`isWebGpu ? 16 : caps.getMaxAnisotropy()`).
- Under `?webgpu=1`: build `TerrainMaterialHandle` from `createTerrainNodeMaterial`
  (NodeMaterial impl of the Phase-A interface); **skip** post/sky/grass/stones (guard them
  `null`); render via `renderer.render(scene, camera)`.
- **Gate:** the real app (GUI, worker build at full world sizes, dig, player mode) renders
  terrain on WebGPU; WebGL unchanged. This is the milestone "the app runs on WebGPU."

## Phase C — subsystems backend-agnostic
- **Stones:** already injectable — pass the node material under WebGPU. (done-ish)
- **Grass:** give `GrassSystem` an injected-material option (mirror StoneSystem); feed the
  node grass material + instanced geometry builder. Close v2 fades/A2C (currently disabled).
- **Sky:** widen `SkyEnvironment` to accept either renderer, or swap to the node sky dome
  under WebGPU.
- **Post:** under WebGPU use `WebGpuPostProcessPipeline`; wire `setSize` into resize.
- **Gate:** full scene parity under `?webgpu=1` against WebGL reference shots.

## Phase D — feature-parity gaps
Terrain: external PBR texture-slot imports, procedural roughness/debug modes, non-triplanar
path, `dFdx` normal-divergence debug (or drop it under WebGPU). Dig: worker-backed rebuild
scheduling, player-mode hold-to-dig, brush UI, cube/cylinder, grass refresh after edits.
Terrain debug overlays must also work under WebGPU: the Alt+F7–F10 wireframe / normals /
iso-band / hole-probe / flat-unlit modes (see repo `CLAUDE.md`) drive terrain material state,
so they route through the Phase-A `setDebugMode` adapter.
- **Gate:** every GUI control + debug hotkey behaves the same on both backends.

## Phase E — Phase 5: one shared device for compute (the payoff)
Hand the WebGPURenderer's `GPUDevice` to `ClodErrorPxCompute.create(nodes, device)` instead
of `requestWebGpuDevice()`, so CLOD compute and rendering share one device/queue — the
original stutter fix. Optionally move the per-frame readback off the hot path.
- **Gate:** bench run vs WebGL baseline (frame-time consistency + `webgpu` stats);
  `bench_guard` within thresholds.

## Phase F — flip default + retire WebGL
Make WebGPU the default; keep `?webgl=1` as fallback for one cycle. After a clean visual +
bench pass, delete the WebGL `ShaderMaterial`s, `PostProcessPipeline`, and the WebGL branch
of the adapter.
- **Gate:** full visual-regression + bench sign-off, then removal.

---

## Ordering rationale
A before B: the adapter is what makes the swap safe and is verifiable on WebGL alone.
B before C: prove the renderer/loop/terrain on the real app before touching 4 subsystems.
E last-but-one: the compute device unification only matters once rendering owns a device.
WebGL stays default through E so every step is reversible by a flag.

## Risks / unknowns
- NodeMaterial pipeline-compile cost when the cut has many nodes (preview shares one material
  when LOD-fade is off; the app should do the same — per-view materials only when fading).
- `renderAsync`/`init` timing and `device.onuncapturederror` wiring (preview pattern reused).
- Alpha-to-coverage MSAA target config under WebGPU (grass v2) still unproven at app scale.
- I can't run browser/GPU — each gate needs the user's visual QA + bench (per the repo's
  perf workflow). No phase claims done without that.

## Definition of done
WebGPU is the default; WebGL removed; every GUI feature at parity; CLOD compute on the shared
device; a bench run that matches or beats the WebGL baseline with the stutter gone.
