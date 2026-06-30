# clod-poc per-pass GPU timing (TP-1)

Trustworthy per-pass GPU ms for the WebGPU path, so tree-perf work A/Bs against
real GPU numbers instead of the degenerate `renderer.info.render.timestamp` sum
(which under-reports to ~0.02 ms once the timestamp-query pool wraps).

## What landed

- `src/core/gpu_profiler.ts` — wraps the three WebGPU backend's
  `updateTimeStampUID` to remember a human label per timestamp uid (compute →
  `ComputeNode.name`; render → tagged render target / texture name / `screen`;
  shadow cascades → `shadow.c0..cN`), then on each resolve aggregates the newest
  complete frame's per-uid durations by label and prunes consumed entries.
- `src/core/gpu_pass_timing.ts` — main-app collector: resolves RENDER + COMPUTE
  timestamps every frame and fills a `passes` record. **Inert** (no-op `update()`,
  empty `passes`) unless the renderer was created with timestamp tracking.
- `EngineStatsTracker` (harness scenes `phase1`/`sanity`) now uses the profiler,
  so `__drusnielClod.stats.gpuPasses` and the HUD show per-pass ms.
- `renderer_backend.ts` sets `trackTimestamp` on the main-app WebGPU renderer,
  **gated** on the adapter exposing `timestamp-query`. Off ⇒ zero cost.
- The frame perf probe (`perf:main`) records `gpuPasses` per frame and the
  summary exposes `counters.gpuPassesAvg` (mean ms per pass label).

Labels you will see: `r.screen` (the main opaque/transparent scene pass —
trees + terrain share this target, so it is not split per object), `r.shadow.cN`
(per shadow cascade), `c.<computeName>` (each named compute dispatch, e.g. the
tree/grass/stone ring scatter), plus `render` / `compute` totals.

## Headed real-GPU A/B method

The harness `--freeze 1` + headless path is **SwiftShader** and renders zero
trees — its GPU timing is meaningless for trees. Always measure headed on the
real GPU:

1. Start the dev server directly (not through rtk):
   ```powershell
   npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
   ```
2. Launch headed Chromium with WebGPU, confirm the adapter is `nvidia`
   (`window.__drusnielClod.diag.vendor`), drive the orbit camera to the hero
   forest pose, and read `window.__drusnielClod.stats.gpuPasses` from the HUD
   (or the page) for live per-pass ms.
3. For a recorded A/B, run `perf:main` with `?perfProbe=1` and read
   `summary.json → counters.gpuPassesAvg`. Use the same world/pose/warmup/frames
   for baseline and change. Per CLAUDE.md, longer `--warmup 600` when WebGPU
   compute pipelines / indirect draws are involved.

## Headed real-GPU confirmation (2026-06-30, RTX 4080, Chrome, world 8 orbit)

Gating fix found during confirmation: clod's `probeWebGPU()` requests a
`high-performance` adapter, but three creates its device from a separate
`featureLevel:'compatibility'` adapter — so the probe's feature list is **not** a
reliable gate for `trackTimestamp`. Fixed by passing `trackTimestamp: true`
(three downgrades internally via `hasFeature`) and reading support from three's
actual post-init `renderer.backend.trackTimestamp`. The per-frame resolve is
gated on `?perfProbe=1` / `?gpuTiming=1` so normal play stays zero-cost.

Result — the profiler reads **real, distinct per-uid durations** (not the fake
0.02 ms global): e.g. `r.shadow.c2 ≈ 2.7–3.0 ms` while the other cascades read 0.
**Shadow-cascade attribution works and is directly usable for TP-8.**

**Known gap — the main-app color pass is not captured.** In the hero tree-perf
pose (471 near + 7640 total trees) the shadow cascades grow sensibly
(`c0+c1+c2 ≈ 6 ms`) but `r.screen` AND `r.rt#0` stay ~0.01 ms — drawing terrain +
7.6k trees cannot take 10 µs.

Root cause (diagnosed 2026-06-30, NOT a within-pass issue):
- The **profiler times offscreen color passes correctly.** In the harness
  `phase1-terrain` scene (which renders the scene to an offscreen target) the
  color pass shows up as `r.rt#0 ≈ 0.14–0.70 ms` — real, content-varying.
- The **main app's heavy color work goes through the swapchain/canvas pass**,
  whose `beginningOfPassWriteIndex`/`endOfPassWriteIndex` timestamps are
  unreliable on this Dawn/RTX stack (fixed ~0.01 ms regardless of content).

Inside-pass timestamp brackets are the **wrong fix** — the issue is the render
*context* (swapchain pass), not where timestamps sit within a pass.

## Fix that landed — isolated offscreen tree pass (`r.treeMain`)

`TreeSystem.renderIsolatedForTiming()` + `app/frame_loop/tree_timing_pass.ts`
render **just the tree meshes** (the tree root group, reparented into a throwaway
scene) into a tagged offscreen `RenderTarget` after the visible frame. Being
offscreen it times correctly; the profiler labels it `r.treeMain`. Gated on
`?gpuTiming=1`/`?perfProbe=1` + timestamp support; **zero cost in normal play**;
the visible frame is untouched (root is restored synchronously).

Confirmed RTX 4080, `scene=trees-perf` hero pose (471 near + 7640 total trees):
`r.treeMain ≈ 31 ms`, content-sensitive (vs the old fake ~0.01 ms). Caveat: trees
render against a **cleared depth buffer**, so this is the *isolated, unoccluded*
tree fragment cost — an **upper bound** (no terrain occlusion, no front-to-back
early-z between trees), which is why it can exceed the frame budget. That is the
right signal for the near-canopy overdraw the perf plan targets, and for TP-3/4/5
A/Bs the **relative** change in `r.treeMain` is what matters. (A future refinement
could pre-render terrain depth into the target for an occluded number.)

Trust, in order: `r.treeMain` (isolated tree fill), `r.shadow.c*` (per cascade),
`c.*` (compute). Treat `r.screen` as unreliable (swapchain).

## Caveats

- `r.screen` cannot isolate "tree main pass" from terrain (one render target),
  and currently under-reports (see above).
- Timestamps resolve async one frame behind; values shown are the last resolved
  frame. The collector skips overlapping resolves (a single in-flight resolve).
