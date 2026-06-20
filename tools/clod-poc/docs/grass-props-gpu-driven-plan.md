# GPU-driven grass & props — implementation plan

Goal: make clod-poc grass (and later trees/pebbles/rocks) **fully GPU-driven — no CPU
per-frame scatter**, matching the LAAS reference in `docs/reference/fable5-world-demo`.
This kills the ~67 ms `grass+stones` frame spike, which is CPU patch scatter
(`generateGrassInstances` samples terrain at every footprint cell, sorts, slices, and
builds an `InstancedBufferGeometry` on the main thread).

This is a plan only. No code changes yet.

## Reference architecture (what we are matching)

From `src/vegetation/GroundRing.ts` and `src/gpu/passes/Scatter.ts`:

1. **Toroidal clipmap, zero uploads.** The compute dispatch grid *is* the instance-slot
   grid. Each slot maps to the world cell congruent to it (`mod GRID`) nearest the camera
   (`worldCell()` in GroundRing). Every per-instance parameter re-derives from
   `pcg2d(worldCell, salt)` (deterministic integer hash). A slot's content changes only
   when its world cell changes — **no candidate buffer, no per-frame upload, ever.**
2. **Per-frame GPU cull.** One thread per slot: sample terrain/biome/water/normal, density-
   thin toward the ring edge, frustum-test (6 planes passed as a uniform array), pick the
   LOD band, atomically append `(packed cell, groundY)` into compact lists.
3. **Indirect draws.** A tiny compute copies the atomic counts into an indirect-args buffer;
   meshes are `frustumCulled=false` and read transforms in the vertex shader from the compact
   list.
4. **Coverage-conserving continuous LOD.** Accept-probability thins smoothly with distance;
   survivors widen by `1/√thin` in the vertex stage → constant screen coverage, no density
   bands. Dither-crossfade (complementary IGN partition) between LOD layers.
5. **Overdraw control.** Depth-prepass twins (`depthFunc=EQUAL`); shading hoisted to the
   vertex stage via `varying()` for terms that vary at ≥ blade scale.
6. **CPU per frame is only:** copy camera pos → uniform, compute 6 frustum planes → uniform
   array, dispatch kernels, and an async counter readback ~every 90 frames for HUD only.

## What clod-poc already has (the gap is small)

- **GPU cull→compact→indirect pipeline already exists.** `src/gpu/shaders/grass_ring.compute.wgsl`
  (130 LOC) already has `clear_counters`, `grass_cull_fine`, `grass_cull_far`,
  `build_indirect_args`, atomic append into 4 tier regions, and 8 storage bindings (candidates,
  params, counters, indirect, 4 shared output attributes). Driver: `src/gpu/grass_ring_compute.ts`.
- **GPU terrain field already exists.** `src/gpu/shaders/terrain_field.wgsl` provides
  `surfaceHeightField(x,z)`, `densityField(x,y,z)` (with dig edits via `brushSdf`), and
  `densityGradient` → normal. CPU mirror: `src/gpu/terrain_field_core.ts`. This is the key
  enabler: the cull shader can evaluate height + normal on-GPU with no baked textures.
- **The single thing that violates "all GPU":** binding 0 of `grass_ring.compute.wgsl` is
  `candidates: array<Candidate>` — a CPU-built, uploaded buffer. `buildGrassGpuCandidateBuffer`
  (src/grass.ts) scans the whole world on the CPU, ranks, sorts, and uploads it
  (`device.queue.writeBuffer`, grass_ring_compute.ts:158). The cull kernels index it by
  `global_invocation_id`. Everything downstream of the candidate read is already correct.

So the core change is: **delete the uploaded candidate buffer; derive each slot's world cell
and terrain sample on-GPU inside the cull kernel.** Dispatch size becomes `GRID²` (slot grid)
instead of `candidateCount`.

## Phase 1 — grass ring becomes a true toroidal clipmap (no upload)

Files: `src/gpu/shaders/grass_ring.compute.wgsl`, `src/gpu/grass_ring_compute.ts`, `src/grass.ts`,
plus a new `src/gpu/shaders/clod_materials.wgsl` (or inline) for `materialWeights`.

1. **Add `materialWeights` to WGSL.** Port `terrain.ts materialWeights(y, normalY)` and the
   grass-mask logic from `sampleGrassTerrainSite` (slope/rock/snow/water-bank smoothsteps) to
   WGSL. ~20–30 lines of smoothsteps; the CPU version stays as the test oracle. Reuse
   `surfaceHeightField` / `densityGradient` from `terrain_field.wgsl` (already includable via the
   same shader-assembly path the mesher uses).
2. **Add `pcg2d(cell, salt)` to WGSL** (port from Scatter.ts:120) and a `worldCell(slot, grid,
   cell, camXZ)` helper (port from GroundRing `worldCell`). Replace the existing sin/hash if any.
3. **Rewrite the cull kernels** so `index = global_invocation_id` is a *slot*, not a candidate:
   - derive `wc = worldCell(slot, GRID, CELL, params.center)`,
   - `wpos = (wc + pcg2d(wc,salt)) * CELL`; `dist = |wpos.xz - cam.xz|`; early-out past radius,
   - `h = surfaceHeightField(wpos)`, `n = normalize(densityGradient(wpos.x,h,wpos.y))`,
   - `mask = grassMask(h, n.y, wpos)`; `thin = grass_thin(dist)`; accept via `pcg2d(wc,salt2) < mask*edge*thin`,
   - frustum-test (new `planes: array<vec4>,6` uniform), then atomic-append `(packed wc, h)` —
     boundary-band slots append to both adjacent tiers (complementary dither).
   - Keep `build_indirect_args` as-is.
4. **Replace `Candidate` binding** with packed `cells: array<u32>` + `heights: array<f32>` output
   (or keep the existing 4 shared output attrs but store `(wc, h)` rather than full transforms;
   the vertex shader re-derives the transform from `wc` like GroundRing `fetchRing`). Removes the
   candidate buffer and its upload entirely. Net storage bindings drop, not rise.
5. **Vertex shader** (grass_node_material.ts ring path): fetch `(wc, h)` from the compact list,
   re-derive position/yaw/scale from `pcg2d(wc,salt)`, widen by `1/√thin`, apply wind. Hoist
   per-cell shading to `varying()`.
6. **Drive it per frame** in `GrassSystem.update()`: write camera + frustum-plane uniforms,
   dispatch `[clear, cull_fine, cull_far, indirect]`. No `buildGrassGpuCandidateBuffer`, no
   per-frame readback (move stats readback to ~every 90 frames, HUD-only). Delete the
   `RING_REFRESH_CELLS` early-out — the clipmap makes refresh free.
7. **Make `webgpu-ring-v1` the default** once parity holds; delete `terrain-patch-v2`'s CPU
   scatter path (and `generateGrassInstances`/`buildGrassGpuCandidateBuffer`) after.

## Phase 2 — depth prepass + continuous LOD polish

- Add depth-prepass twins for the near/mid grass layers (port `VegPrepass.depthPrepassTwin`;
  needs the `@invariant` clip-space patch — `installPositionInvariance`).
- Confirm coverage-conserving thinning (width = `1/√thin`) and complementary IGN dither match
  the reference so there are no density rings.

## Phase 3 — props (trees / pebbles / rocks) via boot scatter

- Port `Scatter.ts` pattern: one boot-time compute per class, one thread per candidate cell,
  density-gated by clod's material/biome + slope + water, `pcg2d` placement, atomic-append to
  storage buffers, **counts read back once**. Replace the current CPU stone system.
- Near-field pebbles/litter can ride the same toroidal ring as grass (GroundRing's debris lists)
  rather than boot scatter, if camera-local density is wanted.

## Risk / correctness notes

- **Grass must sit on the rendered surface.** The cull samples `surfaceHeightField` (LOD0
  analytic height). Where the live mesh is welded/snapped at page seams, blades may float a few
  cm. Mitigate by sampling the same field the LOD0 mesher uses (it already does) and accepting
  sub-cm error, or snapping `h` to the page mesh in a later pass.
- **`firstInstance`/indirect offset correctness** (the open item from the last grass review)
  still needs a WebGPU smoke check that each tier reads its own compact region — fold into the
  Phase 1 verification.
- **WGSL has no `bool` uniform** — keep toggles as 0/1 numeric uniforms (already enforced by
  `src/gpu/node_material_uniforms.test.ts`).
- **Headless limits:** WGSL build/dispatch can't run in vitest (no device). Cover on CPU: the
  ported `pcg2d`, `worldCell`, `grassMask`, and `grass_thin` get unit tests against their CPU
  oracles (terrain_field_core / sampleGrassTerrainSite). The browser smoke check (counts > 0,
  per-tier regions distinct, no upload, flat frame time while walking) is the user-run gate.

## Definition of done

- No `device.queue.writeBuffer` of candidate data per frame; no `buildGrassGpuCandidateBuffer`.
- `GrassSystem.update()` does only uniform writes + kernel dispatch (+ throttled stats readback).
- Walking shows flat frame time (no `grass+stones` spike) under `?profile=1`.
- `webgpu-ring-v1` is the default; CPU patch path removed.
- Visual parity with the reference's meadow density/LOD/wind, judged in-browser by the user.
