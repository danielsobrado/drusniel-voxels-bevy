# GPU-Driven Frame Parity Plan — clod-poc vs fable5-world-demo (LAAS)

Date: 2026-07-17. Solo audit of the clod-poc performance architecture against the
reference demo (`docs/reference/fable5-world-demo`, github.com/Braffolk/fable5-world-demo):
what is already GPU-driven, where readbacks live, which bugs exist today, and the ordered
plan to reach the reference's GPU-driven level while keeping continents, the long map,
streaming, and the editable volumetric near field.

Boundary reminder (from `laas-cdlod-far-field-reference-plan.md`): LAAS is a 2.5D
heightfield renderer. Parity here means *frame architecture parity* (GPU culling,
compacted indirect draws, readback-free frame loop), never adopting its heightfield
representation for the near editable terrain (invariant I5: near bubble stays Surface Nets).

---

## 1. Audit: what clod-poc already has

### 1.1 GPU-driven paths (already at or above reference level)

| System | Mechanism | State |
|---|---|---|
| Grass / trees / understory / props / stones | Per-frame ring compute: frustum + terrain-visibility cull in WGSL, compacted instance buffers, GPU-written indirect args, drawn via `geometry.setIndirect` | ✅ fully GPU-driven; CPU never sees counts (counter readback is debug-gated, slot-ring, 90-frame interval) |
| Tree shadows | Per-cascade GPU shadow caster lists + shadow indirect args | ✅ beyond reference |
| Hydrology / authority data for placement | Streaming atlas textures, dirty-rect `writeTexture`, sampled inside placement computes ("without readback" by design) | ✅ |
| Terrain page meshing (streamed roots) | GPU mesher (`liveClodRootGpuMesher=1`, continent default) → GPU-resident vertex/index pool, external-buffer three geometry (`webgpu_external_buffer_geometry.ts`), per-meshlet `drawIndexedIndirect` | ✅ resident; only per-page *count* readback at build |
| Post-processing | Hillaire aerial, volumetric clouds + cloud shadows, froxel volumetrics, GTAO, contact shadows, SS bounce, god rays, auto-exposure, bloom, color script, half-res MRT, dynamic resolution | ✅ matches/exceeds reference (TAA stage exists behind flag; excluded from locked scope) |
| Shadows | 4-cascade CSM @2048 with caster layers | ✅ (reference adds PCSS — optional polish) |

### 1.2 NOT GPU-driven yet (the actual gap)

1. **Terrain CLOD selection is CPU.** `selectCut` walks the quadtree every frame
   (mitigated by the selection cut cache + camera bucketing). The WebGPU error_px
   compute ([clod_error_px_compute.ts](../../tools/clod-poc/src/gpu/clod_error_px_compute.ts))
   only *feeds* the CPU cut through a latency-tolerant error map, and the default
   readback mode is `off` — so with `webgpuSelection=1` the dispatch result is discarded.
2. **No per-frame terrain meshlet culling.** `buildMeshlets` builds meshlet headers,
   bounds, AND a full BVH-style hierarchy on GPU per page
   ([gpu_clod_page_pipeline.ts:683](../../tools/clod-poc/src/terrain/streaming/gpu_clod_page_pipeline.ts#L683)),
   but the indirect args are written **once** at build with every meshlet enabled
   (`instanceCount=1`, [gpu_clod_page_compute_shaders.ts:477](../../tools/clod-poc/src/terrain/streaming/gpu_clod_page_compute_shaders.ts#L477)).
   The hierarchy/bounds buffers are resident VRAM that no pass ever binds afterwards.
   Culling is page-granular only, on CPU via three.js bounding spheres. The reference
   demo compacts draws per frame on GPU.
3. **Far field is CPU-sampled.** Far clipmap + far summary refills sample heights on
   the CPU (steady ~2-3 ms band, the top steady cost after render — see
   `docs/perf/fable90-infinite-islands-2026-07-12.md`).
4. **Water clipmap is CPU-sampled.** `waterClipmap` refills run `field.sample` on CPU.
5. **Near-field bubble GPU mesher round-trips.** `gpu_chunk_mesher.ts` reads back the
   full mesh (positions/normals/materials/indices) and re-uploads through three.js —
   a double transfer per chunk build. Only colliders genuinely need CPU-side data.

### 1.3 Readback inventory (answer to "is it all GPU driven, readbacks?")

**The default frame loop is readback-free.** Every `mapAsync` site is gated:

| Site | Trigger | Blocking? |
|---|---|---|
| Ring compute counters (grass/tree/understory/prop/stone) | debug flags, slot-ring, ≥90-frame interval | no (async slots) |
| `GpuTimestampRecorder` | `?gpuTiming/perfProbe`, 30-frame interval, 2 slots | no |
| CLOD error_px map | `?webgpuReadback=async\|once` only | no (6-frame max age) |
| GPU meshers (page pipeline, resident, single) | per page **build** (counts only on resident path) | awaits inside async build lane, not the frame |
| `gpu_chunk_mesher` (bubble) | per chunk build — **full mesh** readback | build lane; double transfer |
| Impostor/foliage atlas bakes, terrain texture probe, far-summary builder, erosion GPU | one-shot / build / diagnostic | acceptable |
| `tree_renderer_gpu_sync` (`onSubmittedWorkDone`) | one-shot impostor bake ordering | acceptable |

So the readback *policy* is already at reference level; the gap is that selection and
terrain-draw *decisions* stay CPU-side rather than the frame being readback-driven.

### 1.4 Perf tricks & tooling inventory (keep; several are ahead of the reference)

- CPU loop: selection cut cache, stats-sync throttle, budgeted forest lighting/sun-light,
  material recycle pool + idle reserve, view prewarm + `compileAsync`, material cache-key
  memo patch ([three_patches.ts](../../tools/clod-poc/src/rendering/three_patches.ts)),
  allocation-free far-summary sampling, node-label early-out, workers (clod mesher,
  colliders, hydrology tiles, canopy, sun-light).
- Renderer: shared device, `trackTimestamp:false`, frame-latency knob, fail-loud
  uncaptured-error counter + device-loss recovery, dynamic resolution.
- Harness: `perf:main`, `perf:move` (onset/steady split, cpuprofile, QA gate),
  `perf:p0` + gates, `battery`, shot harness + `__drusnielClod` hooks, acceptance suites
  (infinite-islands reuse profile, continent short/coast/revisit, unified-streaming long
  route, soaks), postfx perf gate/matrix, GPU pass timings, micro-benches and probes.

---

## 2. Bugs found (2026-07-17, on main @ 89def4f0)

1. **10 failing tests on main** (`npm --prefix tools/clod-poc test`):
   - `src/app/rpg_density_world_mode.test.ts` (2): rpg-village / rpg-player-base now
     classify `farOwner = "infinite_far_shell"`, tests expect `"far_clipmap"`.
     Decide: intended reclassification (update tests) or regression in continent-backed
     scene wiring (fix code). Continent-backed scenes falling back to the shell would
     resurrect the "shell rebuild waste" cost class fixed on 2026-07-11.
   - `src/gpu/understory_ring_compute.test.ts` (1): `understoryRingGroupCapacity()`
     returns 1000, expected 2000. Capacity = `gpu.maxVisible / UNDERSTORY_RING_GROUP_COUNT`;
     the recent "understory fixes" work doubled the group count (class × tier) without
     doubling `maxVisible` — per-group capacity silently halved. Decide: raise
     `maxVisible` or accept the halving and fix the test. This changes visible-instance
     clamping in the field, not just the test.
   - `src/qa/rpg_density_scene_composition.test.ts` (7): `localStorage is not defined` —
     test environment gap (needs the jsdom env or a storage stub in `test-setup.ts`).
2. **`webgpuReadback=once` never delivers post-edit maps.**
   `buildClodErrorDispatchOptions` re-requests a readback when the node version changes,
   but `resolveClodErrorGpuMap` only checks `readbackOnceConsumed`, so the re-read map is
   never consumed ([webgpu_selection_parity.ts:115](../../tools/clod-poc/src/diagnostics/webgpu_selection_parity.ts#L115)).
3. **Dead GPU work in the documented perf scenario.** With `webgpuSelection=1` and
   default readback `off`, `maybeDispatchWebGpuSelection` dispatches every
   `dispatchIntervalFrames` (2) even with a static camera, because `gpuMap` is always
   null ([clod_selection_controller.ts:257](../../tools/clod-poc/src/terrain/selection/clod_selection_controller.ts#L257)).
   The CLAUDE.md scenario `?world=16&clodPerf=1&webgpuSelection=1` therefore measures
   pure overhead with zero consumer.
4. **Dead VRAM per resident page.** Meshlet hierarchy headers + bounds
   (`hierarchyNodeCount * 32` bytes/page) are built, retained, and never bound by any
   later pass (see §1.2.2). Either wire the cull pass (§3 P1) or stop allocating them.
5. Minor: `tools/tmp-water-verify.ts` (committed temp script);
   `guardedAdd` in [renderer_backend.ts](../../tools/clod-poc/src/rendering/renderer_backend.ts)
   traverses every added subtree twice (before and after `add`).

---

## 3. Plan (ordered; each step has a measurable gate)

Measurement contract for every step (per CLAUDE.md): perf harness A/B on the same
scene/world/warmup/frames, report `frameMs` p50/p95, `renderMs` p95, moved counters; run
`accept:infinite-islands -- --reuse`, `accept:continent-short`, and
`accept:unified-streaming-long-route` before declaring a step done. Never conclude from
FPS alone. Suite + typecheck + build green.

### P0 — Restore a green baseline (blocker for honest A/Bs)
Fix the three failing-test clusters in §2.1 (each needs the intended-vs-regression
decision first), delete/relocate `tmp-water-verify.ts`.
Gate: `npm --prefix tools/clod-poc test` green on main.

### P1 — Wire the terrain meshlet cull pass (the core GPU-driven gap)
The expensive 90% exists (meshlets, bounds, hierarchy, indirect buffer, indirect draw
path). Add the missing per-frame compute:
- New pass over resident pages' meshlet bounds: frustum test (camera planes uniform)
  → write `indexCount` or `0` into the existing per-meshlet indirect slots. Start
  leaf-only (bounds array), use the hierarchy later if leaf-only dispatch cost shows up.
- Batch: one dispatch for all resident pages (global meshlet table) rather than
  per-page passes, to keep encoder overhead flat as the continent streams.
- Keep CPU page-level culling as the coarse pre-filter (it already exists via three.js).
- Cone/backface and HZB occlusion are follow-ups, not part of this step.
Gate: `trianglesRendered` / `renderMs` p95 drop at grazing/terrain-hugging poses on the
infinite-islands route; zero visual diff on the shot battery (`freeze` poses);
no new readbacks (indirect stays GPU-only).
Fallback risk: three.js multi-`drawIndexedIndirect` per page may already be
draw-submission-bound; if the A/B is flat, the win moves to P2 (fewer, bigger indirect
batches), not more culling.

### P2 — Merge terrain draw submission
Today each resident page is a three.js mesh (one renderObject each, meshlet indirect
offsets inside). Reference-level GPU-driven means few draw submissions total:
- Consolidate resident pages sharing the material into one geometry view over the pooled
  vertex/index buffers with a shared indirect buffer (the pool already exists), so the
  scene-graph cost and per-object uniform churn stop scaling with streamed-in page count.
- This also shrinks the L1 "views burst" (10-25 ms per root switch) since new pages
  become indirect-slot updates, not new meshes/materials — completing what the material
  recycle pool started.
Gate: `selectionSub.views` burst max on the perf:move route; scene `renderObject`
count flat while streaming; steady `renderMs` p95.

### P3 — Retire dead selection dispatch; promote the async error map
- Default `webgpuReadback` to `async` **when** `webgpuSelection=1` (readback is slot-ring,
  6-frame-tolerant, parity-tested; today's default burns the dispatch). Fix the `once`
  consumption bug (§2.2) while touching it.
- Skip dispatch entirely when the camera bucket is unchanged and no edit occurred
  (reuse the selection cut cache key).
- Full GPU cut selection (GPU-written page draw list) is explicitly **deferred**: the
  cut cache already makes CPU selection cheap in steady state; re-evaluate only if
  selection reappears in the p95 profile after P1/P2.
Gate: `selectionSub.dispatch` ≈ 0 when static; `selectionSource=webgpu` in the opt-in
scenario; parity stats stay `ok`.

### P4 — GPU-displace the far band
Far clipmap refill: replace CPU height sampling with a vertex-stage sample of the far
summary data (upload the summary as a texture once per region change, displace in the
terrain-far material — same pattern the reference uses for its whole terrain, applied
only to the non-editable far band, respecting the I5 boundary).
Gate: `farSumClipmapMs`/`farSumShellMoveMs` avg ≈ 0, max spike gone (was ~2-3 ms avg,
~21 max); coast/continent acceptance unchanged.

### P5 — GPU water clipmap
Same treatment for `waterClipmap`: heights/flow from the hydrology atlas texture
(already GPU-resident, §1.1) in the water vertex stage; CPU keeps only body-mask
bookkeeping. Water is currently mid-diagnosis (see
`water-rivers-diagnosis-2026-07-17` note) — sequence this after that lands.
Gate: `water_clipmap_field_samples` → 0 per frame steady; water shot set byte-stable.

### P6 — Resident near-field bubble meshing (kill the last big readback)
Move the bubble chunks onto the resident-pool path used by streamed roots: GPU mesh →
resident buffers + count readback only; colliders keep their own worker-built CPU mesh
from the voxel field (they never needed the render mesh). Deletes the full-mesh
readback + re-upload double transfer on every edit remesh.
Gate: edit-burst frame p95 during dig stress; `gpu_mesher_lane_busy_bubble` unchanged;
collider parity tests green.

### P7 — Movement-onset PSO stall (the known ~300-700 ms native block)
Classified as D3D12 PSO compilation at first pipeline use (see
`fable90-infinite-islands-effort` notes; both precompile attempts inconclusive).
With P2's material consolidation the variant count drops, which is the structural fix.
Then re-run the frozen-build A/B (N≥3, idle machine) for `sceneCompileWarm`.
Gate: worst `renderMs` frame at movement onset on perf:move, N≥3 runs.

### P8 — Lock it in the harness
- Acceptance counter gate: `webgpu_uncaptured_errors == 0` and default-profile readback
  counters (`readbackFrames`, ring `skippedDispatches`) == 0 in the reuse profile.
- Gate `renderMs` p95 (not just `frameMs`, which stops at render end — known anatomy).
- Add the meshlet-cull counters (culled/total meshlets) to stats + perf:move summary.

## 4. Explicit non-goals
- Adopting LAAS heightfield terrain for the near field (I5).
- TAA, collapse, sailing (locked out of scope 2026-07-16).
- PCSS / irradiance probes: clod-poc's CSM + contact shadows + forest lighting are the
  chosen equivalents; revisit only after P1-P6 land.
