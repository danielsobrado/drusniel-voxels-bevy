# Infinite-Islands 90 FPS Effort — Session Log 2026-07-11

Goal: `tools/clod-poc` `scene=infinite-islands` sustains **≥90 FPS during playable movement
with terrain streaming** (moving frame p95 ≤ 11.1 ms), with no quality reduction.
Reference bar: `docs/reference/fable5-world-demo` (4k×4k world, lazy streaming).

Status at end of session: **target not met** — moving frame p95 is ~24 ms — but the
burst class that dominated p99/max is largely eliminated, and measurement + gating are
now automated. Work is committed as `3854dc9c "fable improvements"` (on top of
`5e64c8b1 "fable 5 performance improvements 1"`); the hydrology GPU atlas follow-up
landed after this session as `96cbc67e "fable hydro 4b"`.

## Benchmark

`npm --prefix tools/clod-poc run perf:move -- --out perf-runs/<name>` — world 16, seed 1,
spawn (2048, 2048), 225 m route at 0.25 m/frame, acceptance-full streaming params at full
render scale. Dev server on 5180, never through rtk. ~4 min per run (~50 s convergence).
Runs referenced below live in `tools/clod-poc/perf-runs/`.

QA gate (new this session):

```powershell
npm --prefix tools/clod-poc run qa -- --config config/qa_perf_move.yaml --summary perf-runs/<run>/qa-summary.json
```

## A/B results (moving window)

| run | change under test | fps p5 | frame p50 | p95 | p99 | max | verdict |
|---|---|---:|---:|---:|---:|---:|---|
| `fable90-baseline-move2` | baseline at 5e64c8b1 | 29.8 | 10.1 | 34.2 | 107.4 | 737 | — |
| `fable90-after-1` | workers wired + un-budgeted view pre-warm (4/frame) | 35.3 | 8.4 | 29.7 | 64.0 | 737 | pre-warm burst moved into drain (otherMs max 92) |
| `fable90-after-2` | 3 ms-budgeted drain + `compileAsync` per pre-warmed mesh | **47.4** | 8.6 | **22.1** | 67.8 | 764 | **best — kept** |
| `fable90-after-3` | real-pass warm draws (`drawRange(0,0)` + culling off, 1 frame) | 41.0 | 8.7 | 24.8 | 70.7 | 731 | worse steady state, no spike reduction — **reverted** |
| `fable90-final` | confirmation of kept config | 44.8 | 8.8 | 24.1 | 68.3 | 781 | confirms after-2 within run variance |

Burst sources vs baseline (moving window max):

| phase | baseline | final | fix |
|---|---:|---:|---|
| waterMs | 253 | 9.4 | hydrology tile build worker **wired** (worker existed with zero callers) |
| selectionSub.views | 129 | 46 | view pre-warm queue; reduced, not eliminated (see below) |
| canopyMs | 45.6 | 1.3 | canopy worker (5e64c8b1), confirmed |
| vegetationTotalMs | 257 | 21 | hydrology worker (water sat in this bracket) |
| propsMs | 260 | 24 | same |
| farSumSunLightMs (avg) | 2.2 | 0.1 | sun-light worker (5e64c8b1), verified live this session |

Visual parity: checkpoint screenshots (cp-0…cp-100) sanity-pass in every run and
per-checkpoint mean luma is stable within 0.2 across all runs. Full suite 2716 tests
green, `vite build` green (both workers bundle as separate chunks), `tsc` green.

## What was done (committed in 3854dc9c)

1. **Hydrology tile worker client + wiring** — `src/water/hydrology_tile_worker_client.ts`
   (modeled on the sun-light client), `HydrologySystem.attachTileRemote/prefetchTiles/`
   `tileCoarseBypassCellSize`, per-frame `prefetchAround` from the water controller before
   the clipmap update, dispose path, and `hydrology_tile_worker_parity.test.ts` locking the
   worker's minimal-config sampler reconstruction bit-for-bit against the main-thread path.
2. **Render-view pre-warm queue** — `frame_loop_startup.ts`: `onNodesBuilt` queues applied
   stream pages; a 3 ms-budgeted drain (≥1 node/frame, ≤ `maxPrefetchCreatesPerFrame`)
   creates their render views ahead of the root switch, plus `renderer.compileAsync(mesh,
   camera, scene)` per pre-warmed mesh (WebGPU only, fail-safe guarded).
3. **Per-frame bookkeeping** — gated the previously unconditional LRU sort in
   `streamed_near_field_bubble_controller.ts`; single-pass stats there; narrowed the
   `clod_streaming_roots.ts` probe-counter microtask double-write to probe-active frames
   and only the four contested totals; dirty-flag cache for the per-level workerP95 sorts.
4. **QA integration** — `perf-move.ts` emits `qa-summary.json` (WebQaSummary shape);
   `config/qa_perf_move.yaml` gates the 90fps criterion, burst maxes (water/views/canopy),
   streaming-exercised/convergence checks, and checkpoint screenshot probes. Verified
   end-to-end; it currently fails honestly on: static p95 13.6 > 11.1, moving p95
   24.1 > 11.1, views burst 45.9 > 15.
5. **Mystery resolved** — the baseline run's empty checkpoints section was a `--shots 0`
   invocation, not a tool bug.

## Lessons learnt

- **Wiring beats existence.** The hydrology worker files were committed but dead code —
  `attachRemote`/`prefetchAround` had zero callers. Grep for call sites before assuming a
  committed subsystem is active.
- **A budget can just move a burst.** The un-budgeted pre-warm drain turned one 129 ms
  switch burst into repeated 90 ms drain frames; the 3 ms budget then let the queue lag so
  switches caught unwarmed views again (46–67 ms). Budgeting throughput-bound work only
  helps if per-item cost is small — one L1 root view costs 10–25 ms to materialize, so the
  real fix is structural (shared materials / cheaper creation), not scheduling.
- **The first-draw pipeline-compile hypothesis failed twice.** Both `compileAsync` per
  mesh and one-frame real-pass warm draws (`drawRange(0,0)` + `frustumCulled=false`) left
  the renderMs spikes (~780 ms at movement start, 300/190/86 ms at root switches)
  completely unchanged. Stop guessing; only a DevTools performance trace + GPU timestamps
  can attribute these (GC inside the render bracket, Dawn-internal sync, and GPU-mesher
  interplay are the remaining suspects).
- **Warm draws are not free.** `frustumCulled=false` for one frame per created view raised
  static renderMs p95 from 3.8 to 7.0 ms. Revert experiments that don't pay for themselves,
  even if the idea was principled.
- **Attribution discipline:** after-2's win (p5 35→47) is attributable to the *pair*
  (budgeted drain + compileAsync); compileAsync alone showed no spike benefit. It should be
  A/B'd out (or flag-gated) in the next session for a clean attribution.
- **Know your brackets.** `propsRestMs` ≈ `farSummaryMs` — "props ~8 ms p95" is mostly the
  far-summary/far-shell bracket, not vegetation props (grass/trees/stones are each ≤0.4 ms
  avg). Optimizing "props" means optimizing the far shell.
- **The move-start 780 ms spike is a camera-rotation effect**: the route driver snaps yaw
  ~180°, revealing a hemisphere of never-drawn content in one frame. Any fix must handle
  first-visibility of *startup* content, not just streamed pages.
- **rtk mangles git output intermittently** (empty `status`/`diff`); verify tree state via
  file content. Also: never run vitest concurrently with a perf:move measurement.
- **Measure static too.** Two of the three failing QA gates are about the static window —
  pre-warm/streaming churn during "static" measurement is real cost.

## Remaining p95 anatomy (moving window, final run)

- farSummary/farShell: ~6 ms p95, ~21 ms max (CPU shell rebuild + full-buffer flush).
- renderMs: ~5 ms p95 steady, plus unexplained 60–780 ms outliers (p99 ~57).
- vegetation: ~2.8 ms p95; selection wrapper (streaming update + prewarm drain): ~8 ms p95.
- selectionSub.views: ~0 p95 but 46 ms max at switches that outrun the pre-warm queue.

## Next steps (agreed plan)

An external review proposed a P0–P6 sequence; assessment and the merged plan:

1. **Baseline hygiene (P0, agree with amendments).** The review claims a source-state
   mismatch ("compileAsync was reported reverted but is still in main") — that is a
   misreading: the *warm-draw* experiment was reverted; compileAsync was deliberately kept
   as part of the best-measured config. But its recommendations stand on their own merits:
   put `compileAsync` behind a flag and A/B it out for clean attribution, and stamp
   `summary.json` with git SHA, full query params, backend, resolution, and device.
2. **Worst-frame correlation + one Chromium trace (P1, agree).** `perf-move` already emits
   top-12 worst frames with all numeric fields; extend to top-N by `renderMs` and
   `selectionSub.views`, and capture a DevTools trace spanning movement start and a root
   switch. **This must precede any further render-spike work** — two failed hypotheses is
   enough.
3. **GPU-displaced far shell for infinite-islands (P2, agree — biggest steady win).**
   The CPU shell rebuild + full attribute flush is the largest steady p95 item (~6 ms) and
   a 21 ms burst source. `InfiniteFarShell` reportedly already supports atlas-driven GPU
   displacement but the atlas is gated to `infinite-naadf-*` scenes; expose a GPU atlas
   view from far-summary integration and keep summaries GPU-resident (no readback→re-upload
   round trip). Gate on the existing visual-parity harness. The `96cbc67e` hydrology-atlas
   commit is already moving this direction for placement compute.
4. **Structural view materialization fix (P3, agree).** Transition-safe shared terrain
   material (per-view fade/morph as per-object uniforms, one pipeline) makes material
   prewarming unnecessary; dedupe + prioritize the pre-warm queue (predicted cut >
   transition roots > neighbours), replace `shift()` with a cursor. Target:
   `selectionSub.views` max ≤ 5–15 ms, zero new materials on a normal root switch.
5. **Budget stacking (P4, agree in principle, stage it).** Pre-warm 3 ms + shell 2 ms +
   far-summary ~6 ms deadlines can stack in one frame. Before building a full
   `FrameWorkScheduler`, try the cheap version: one shared soft deadline handed to the
   existing budgeted systems. Promote to a real scheduler only if data shows starvation.
6. **Props (P5, mostly collapses into #3 above/#P2).** `propsRestMs` is the far-summary
   bracket; vegetation subphases are already tiny in this scene. The review's GPU-prop-ring
   and CPU-fallback optimizations are valid but belong behind worst-frame evidence.
7. **Renderer stalls as a separate defect (P6, agree).** Classify via the trace from #2
   (GC vs upload vs pipeline vs Dawn/device wait) before touching code.

### On "move as much as possible to GPU first"

Qualified yes. The specific GPU moves that eliminate per-frame CPU geometry writes and
full-buffer uploads (far shell displacement, GPU-resident far-summary/hydrology atlases,
vegetation placement compute — already underway in `96cbc67e`) are the right direction and
the biggest steady-state lever. But "as much as possible" is not the criterion — the
worst-frame data is. Two caveats: (a) the 300–780 ms outliers survived two GPU-side
warm-up strategies and may be GC or driver behavior that GPU migration won't touch — trace
first; (b) every GPU migration changes the visual pipeline and must pass the checkpoint
parity + QA gates, so they should land one at a time, each with its own perf:move A/B.
GPU-first as a strategy: yes for the far shell and derived caches; no as a substitute for
attribution.

## Continuation (same day, evening session)

Executed steps 1–2 of the plan above, plus one structural fix. Work is in the tree on top
of `96cbc67e` (uncommitted); the user's water-clipmap WIP is in flight in the same tree.

**Done:**

- `perf-move` now stamps `gitSha`/`gitDirty`/viewport into `summary.json`, ranks worst
  frames by `frameMs`, `renderMs`, and `selectionSub.views` (correlated forensics), and
  `--cpuprofile 1` captures a V8 profile over the moving window (`moving.cpuprofile`).
- `?viewPrewarmCompile=0` flag gates the compileAsync half of view pre-warm.
- **Far-shell waste eliminated**: in `farClipmapMode=replace` (the perf/acceptance config)
  the `InfiniteFarShell` mesh is hidden and out of the scene, yet its sliced CPU rebuild
  ran every frame (~2.6ms avg / 21ms max moving). The bootstrap now skips shell refresh +
  update while the mesh is not visible. Note `farSumShellMs` is an overloaded bucket —
  `frame_loop_startup.ts:438` also times `farClipmapController.update` and
  `farShellController.moveTo` into it; the residual ~2ms avg / 19.6ms max is the far
  clipmap. Splitting the keys is a cheap follow-up.
- **Render spike classified** (`fable90-b2-compile-on/moving.cpuprofile`): the movement-
  start spike is one contiguous **~386ms native `(program)` block** — not JS, not GC (GC is
  358ms diffuse, no long block). Best hypothesis: D3D12 driver PSO compilation at first
  pipeline *use* in a submit — which explains why JS-level `compileAsync` and 0-count warm
  draws never removed it, and why the compileAsync *prewarm* still helps (Dawn's async
  pipeline path compiles driver PSOs off-thread before first use).
- Profile also shows the largest JS cost while moving is the far-summary/clipmap sampling
  cluster (`sampleSummaryInto` etc., ~12% of the window) — the confirmed steady-state
  target for the GPU-displacement work.
- Whole-scene `renderer.compileAsync(scene, camera)` at ~frame 600 implemented as
  **opt-in** `?sceneCompileWarm=1` (see below for why it is not default).

**Benchmark integrity lessons (hard-earned tonight):**

- Never edit source while a perf run is in flight against the dev server — HMR reloads the
  page mid-run and wedges the benchmark. When the tree is being live-edited, benchmark a
  frozen `vite build` + `vite preview` instead.
- Local preview needs `vite build --base /`: the default build bakes the GitHub Pages base
  `/drusniel-voxels-web/` while `vite preview` serves `/`, so asset requests fall into the
  SPA fallback (HTML served as the main JS chunk; app never boots, silently).
- **Check the machine is idle before trusting a run.** The frozen-build A/B triple
  (`fable90-b2-compile-on` / `-off` / `-scenewarm`) is invalid: runs 2 and 3 degraded
  nearly identically (fps p5 ~13, p95 ~76–78 vs run 1's 21.9/45.8) despite testing
  *opposite* flags — concurrent builds/edits from another session dominated the machine.
  Two opposite-flag runs degrading identically = ambient interference; discard both.
- Consequently `compileAsync` stays default-ON on the strength of the earlier
  quiet-conditions delta (after-1 → after-2: fps p5 35.3 → 47.4), and `sceneCompileWarm`
  stays opt-in until a clean A/B on an idle machine.

**Queued for the next quiet-machine window:**

1. Re-run the A/B triple (compile on/off, scene-warm on) on an idle machine, frozen build.
2. If scene-warm kills the movement-start spike, make it default and re-check the QA gate.
3. Split `farSumShellMs` into `farSumClipmapMs` / `farSumShellMs` / `farSumShellMoveMs`.
4. GPU-displace/optimize the far clipmap sampling path (the ~12% JS cluster) — the real P2.

## How to resume

- Bench + gate commands at the top of this doc; baseline for the next A/B should be a
  fresh run at the current SHA (hydro-atlas and water-clipmap work landed after
  `fable90-final`, so old runs are no longer comparable).
- Session memory: `fable90-infinite-islands-effort` (auto-memory) mirrors this state.
- Do not redo: hydrology/sun-light/canopy workers, pre-warm queue, bookkeeping fixes,
  QA harness — all verified. Do not retry `compileAsync`-style precompilation or
  zero-draw-range warm draws for the render spikes.
