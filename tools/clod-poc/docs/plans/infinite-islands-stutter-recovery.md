# Infinite-islands stutter recovery — status + plan

Status: ANALYSIS COMPLETE, fixes in progress (see Session log at the bottom).
Scope: `tools/clod-poc` only. Solo, no sub-agents, no Rust/Bevy changes.
Predecessor: `infinite-islands-clod-root-streaming-handoff.md` (items 1–7 of that
doc were implemented last session; streamed roots are NOT the main problem now).

## Situation (2026-07-04)

The infinite-islands scene stutters so badly it is unplayable, and the
acceptance run `acceptance-runs/infinite-islands/2026-07-04T10-37-39` FAILED
with 5 failures. Two separate problems:

### A. The acceptance harness is broken (all 5 failures are ONE tooling bug)

Every scene failed with `page.evaluate: ReferenceError: __name is not defined`
before reading a single counter — the report's threshold failures are all
"missing or not numeric", not real gate failures. Two causes, both in the
settle path:

1. The runner executes `tools/infinite-islands-acceptance.ts` via **tsx**
   (`tools/run-infinite-islands-acceptance.mjs:106`), and tsx/esbuild
   `keepNames` wraps arrow functions inside `page.evaluate` closures in
   `__name(...)` helper calls that do not exist in the browser context.
   `tools/infinite_acceptance/page_settle.ts` has `const sleep = (ms) => ...`
   etc. inside its evaluate closure → instant ReferenceError.
2. Same closure also references module-scope constants (`MIN_SETTLE_MS`,
   `FRAME_SETTLE_MS`, `IN_PAGE_TIMEOUT_MS` at `page_settle.ts:32`) that are
   not serialized into the page — would be the next ReferenceError.

So nothing measured by acceptance since `page_settle.ts` was introduced is
trustworthy; the run dies at the first settle.

### B. Three real main-thread stalls (from the user's stats snapshot)

All three are the same anti-pattern: **full synchronous CPU rebuild on the
frame path, triggered by camera/snap movement**, budgeted by count (or not at
all), never by milliseconds. Same class of bug as the sun-light-cache 335 ms
stall previously fixed via resumable builds.

| Counter | Observed | Root cause |
| --- | --- | --- |
| `live_bubble_ms` | ~977 ms | GPU chunk mesher only exists with `?gpuMesh=1` (`src/app/bootstrap/terrain_view_startup.ts:406-409`). Neither acceptance URLs nor the manual URL pass it → `getGpuMesher()` is null → `ensureChunkGroupForPage` meshes all P×P chunks of a page **synchronously** via CPU `meshChunk` (`src/terrain/near_field/near_field_bubble_controller.ts:369-381`). Budget (`chunkGroupBuildBudget`, default 1 for infinite-islands) counts pages/frame, but one page ≈ 1 s. Sustained: every frame while filling/streaming the bubble. |
| `shadow_proxy_build_ms` | ~7726 ms | Streaming-centered shadow proxy: `updateFrame` calls `rebuildProxy(true)` **synchronously** whenever the snapped center changes (`src/shadows/shadowProxyController.ts:252-264`). `buildShadowProxyGeometry` samples gridRes² heights, each via `naadf.queryHeight(x,z,"shadow")` (full procedural stack, `src/shadows/shadowProxyValidation.ts:80-110`) + `computeVertexNormals`. One 7.7 s frame per snap crossing. |
| `far_shell_last_rebuild_ms` | ~1127 ms | Far shell in `"cpu"` height mode: `update()` calls `rebuildHeights()` **synchronously** when the rebase snap changes (`src/long-view/infiniteFarShell.ts:179`). Full (radial+1)×(angular+1) ring of `sampleBlendedHeightNormalMaterial`. GPU mode exists (`resolveHeightSamplingMode` picks "gpu" when atlas inputs exist, `src/long-view/infinite_far_shell_helpers.ts:10`) but this scene lands on "cpu". |

Interplay: at ~1 s/frame the camera "jumps" between frames, so snap
crossings fire repeatedly and the three stalls chain into multi-second
freezes.

## Fix plan (in order — each step is commit-sized and verifiable)

### 1. Fix the acceptance harness (unblocks all measurement) — DO FIRST
- `tools/infinite_acceptance/page_settle.ts`: make both evaluate closures
  self-contained — pass `{ settleFrames, minSettleMs, frameSettleMs,
  inPageTimeoutMs }` as the evaluate argument; no references to module scope.
- `tools/infinite-islands-acceptance.ts` (`runScene`, ~line 413): after
  `browser.newPage`, add
  `await page.addInitScript(() => { (globalThis as any).__name = (fn: unknown) => fn; });`
  so ANY tsx-transformed evaluate in the runner survives `keepNames`.
- Verify: typecheck; then a full acceptance run must produce per-scene
  `thresholds.values` (non-empty) even if gates fail.

### 2. Live bubble: kill the ~1 s synchronous page builds
- Root decision: the GPU mesher path is already async and correct — turn it
  on by default for infinite-islands (playable defaults + acceptance URLs,
  same mechanism as commit dc5749f7 "Apply playable defaults") while keeping
  `gpuMesh=0` as an explicit kill switch.
- CPU fallback still must not stall: slice `ensureChunkGroupForPage`'s CPU
  path so at most N chunks (or an ms budget ~3 ms) mesh per frame per page;
  page becomes `ready` when all chunks land (the entry already supports
  deferred `ready` — the GPU path uses it).
- Verify: manual URL without `gpuMesh` param → `live_bubble_ms` p95 ≤ ~3 ms
  while flying; acceptance walk scene keeps `live_bubble_ready_pages > 0`.

### 3. Shadow proxy: never rebuild synchronously on the frame path
- Make the rebuild resumable/time-sliced (same pattern as the sun-tile fix):
  a build job samples rows with a per-frame ms budget (~2–3 ms), keeps the
  OLD mesh visible until the new geometry completes, then swaps.
- 7.7 s of total work sliced at 3 ms/frame would take ~40 s to converge, so
  also cut total cost: sample the far-summary field instead of per-vertex
  `naadf.queryHeight` where possible, and/or drop `gridRes` for streaming
  mode, and/or increase `rebuildSnapMeters`. Measure first (log gridRes,
  samples, ms) — pick the cheapest combination that keeps the horizon gate
  green (`horizon_hole_ratio = 0`).
- Add a counter for per-frame applied ms (`shadow_proxy_build_ms` stays
  total-build informational).
- Verify: fly across a snap boundary; no frame > ~20 ms attributable to the
  proxy; shadows still correct at the checkpoints.

### 4. Far shell: stop the 1.1 s CPU ring resample
- First choice: run this scene in GPU height mode (atlas already exists for
  the parity material path — check why `resolveHeightSamplingMode` gets no
  GPU inputs here; wire the far-summary GPU atlas in).
- If GPU mode can't be used, time-slice `rebuildHeights` (radial rows per
  frame, flush attributes once at the end, and only move the mesh to the new
  snapped center when the sliced build completes, so heights and position
  stay consistent).
- Verify: rebase snap crossing with no visible far-shell pop and no frame
  spike; `far_shell_last_rebuild_ms` may stay large (total) but per-frame
  cost bounded — add per-frame counter if sliced path chosen.

### 5. Re-run acceptance end-to-end and record numbers here
- `npm --prefix tools/clod-poc run accept:infinite-islands` (native Windows,
  real GPU; the runner starts its own Vite on 5173 — stop any dev server or
  set `CLOD_POC_REUSE_SERVER=1`).
- Record: pass/fail per gate, `frame_ms_p95`, `live_bubble_ms`,
  `shadow_proxy_build_ms`, `far_shell_last_rebuild_ms`, streamed-roots
  counters. Do NOT weaken any gate.

### Carried-over known limitations (unchanged from handoff doc)
- Streamed pages not in dig index; vegetation frozen to startup `lod0Nodes`;
  mid-field annulus (bubble→2048 m) still needs coarse-LOD worker pages;
  hydrology river jumps at 768 m basin borders; grass/stone clamps at
  `grass_gpu_ring.ts:142` / `stone_scatter_compute.ts:155` still unverified
  in browser.

## Test commands

```powershell
rtk npm --prefix tools/clod-poc run typecheck    # tsc — rtk OK
npm --prefix tools/clod-poc test                  # vitest — NEVER rtk
npm --prefix tools/clod-poc run build             # vite — NEVER rtk
npm --prefix tools/clod-poc run accept:infinite-islands
```

Manual QA URL (dev server): `?scene=infinite-islands&world=16&clodPerf=1&webgpuSelection=1&x=2048&z=2048&yaw=2.65`

## Hard rules (unchanged)
Never weaken acceptance gates; no heavy work on the frame path
(`setTimeout(0)` is not async); far shell stays visual-only; small commits
with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Important context discovered during analysis

- No acceptance run in the repo has EVER collected counters with the current
  settle path — every `walk-stats.json` checked contains only the `__name`
  ReferenceError. The user's quoted stall numbers came from the live HUD in
  manual play, not from acceptance artifacts.
- Manual play was already made workaround-playable by dc5749f7: with
  `scene=infinite-islands&x=..&z=..` (and not acceptance/fullLongView/biome
  debug), it defaults `liveBubble=0`, `liveBubbleRadius=96`, `shadowProxy=0`,
  `canopy=0`, `farShellCpuHeights=0`. So current manual URLs do NOT stutter
  from these systems; the FULL path (acceptance, or manual with those params
  set to 1) still has all three stalls. The goal of fixes 2–4 is to make the
  full path playable so the workaround defaults can be reverted.
- Acceptance stays on the full path only because its walk URL passes
  `proceduralDebug=biome` (guard added in b55a6070). Fragile: an acceptance
  URL without that param would silently get the manual workaround defaults.
  Consider `acceptance=1` on all acceptance URLs later.
- GPU chunk mesher arrives asynchronously (`GpuChunkMesher.create().then`),
  so even with `gpuMesh=1` the first bubble pages at startup take the
  synchronous CPU path — CPU slicing (step 2) is needed regardless.
- Live-bubble build budget: `liveBubbleBudget` query param, else 1 for
  infinite-islands (`resolveLiveBubbleBuildBudget`,
  `near_field_bubble_controller.ts:132`).
- Shadow proxy numbers (`config/long_view.yaml`): `grid_res: 512` → 513²
  ≈ 263k samples/rebuild at ~29 µs each (`naadf.queryHeight` procedural
  stack) ≈ 7.7 s; rebuild snap = `max(512, endM*0.25)` = 1024 m
  (`shadowProxyConfig.ts:68`). One 7.7 s frame per km travelled + one at
  boot. Fix 3 needs resumable slicing AND cheaper sampling (summary-field
  lookup or lower streaming gridRes) — 7.7 s sliced at 3 ms/frame alone
  would take ~43 s to converge, slower than the snap cadence when flying.
- Far shell mode resolution (`clod_poc_bootstrap.ts:245-331`):
  `useNaadfFarSummary` requires scene name `infinite-naadf-*`, so
  infinite-islands gets `heightSamplingMode: undefined` → no GPU atlas →
  `resolveHeightSamplingMode` → "cpu". GPU mode would need parity material +
  a far-summary GPU atlas, which only the NAADF integration exposes
  (`getFarSummaryGpuAtlasView`). Realistic fix 4 = time-slice the CPU
  `rebuildHeights` (or wire an atlas view into `farSummaryIntegration`
  later).

## Session log (update as steps land)

- 2026-07-04: Analysis complete (this doc). Root causes A (harness `__name` +
  module-constant capture) and B (3 synchronous frame-path rebuilds)
  identified and verified in code.
- 2026-07-04: Step 1 LANDED (commit b649a758) — `page_settle.ts` evaluate is
  self-contained; runner defines `__name` via string init script. Typecheck
  clean. Acceptance re-run started to get the first real baseline numbers.
- 2026-07-04: Step 2 design settled (not yet implemented): (a) default
  `gpuMesh` ON for `scene=infinite-islands` in `terrain_view_startup.ts:406`
  (`gpuMesh=0` kill switch); (b) replace the synchronous CPU page build in
  `ensureChunkGroupForPage` with a per-entry pending-chunk queue drained in
  `update()` under an ms budget (~6 ms, ≥1 chunk progress per frame when
  pending), entry becomes `ready` when the queue drains (same deferred-ready
  contract the GPU path already uses).
- 2026-07-04: FIRST REAL BASELINE (run `2026-07-04T11-04-15`, harness fix
  verified — all counters collected in all 5 scenes). Walk scene:
  `frame_ms_p95 8.4` (gate 8), `frame_ms_p99 9.9`, `frame_ms_avg 37.6`
  (a few catastrophic frames dominate the mean), `live_bubble_ms 0.1`
  with 47/47 pages ready (bubble steady-state is HEALTHY — the 977 ms
  reading was the fill window), `shadow_proxy_build_ms 5785`,
  `far_shell_last_rebuild_ms 1010`, `live_clod_stream_cached_pages 4`
  (worker streamed-roots path works). Freeze scenes fail hard:
  `frame_ms_p95` 792–1331 ms (sample window dominated by boot stalls).
  NEW real failure everywhere: `far_summary_tiles_missing` 107–124 of
  ~117–133 required (tiles starve; only 9 ready in walk).
  RE-PRIORITIZED: fix 3 (shadow proxy) is now step 2; far shell is step 3;
  far-summary tile starvation investigation is step 4; live-bubble CPU
  slicing + gpuMesh default demoted to hardening (step 5).
- 2026-07-04: SHADOW PROXY FIX LANDED (commit 6dfd0c03). Streaming rebuilds
  are an incremental job (`createShadowProxyGeometryJob`) stepped from
  `updateFrame`/`rebuildIfNeeded` with `build_budget_ms` (default 2 ms) at
  `stream_grid_res` (default 160 vs full 512); old mesh renders until swap;
  fd-normals replace computeVertexNormals; new `shadow_proxy_building`
  counter. Sandbox (non-streaming) path unchanged/synchronous. Controller
  tests drain the sliced boot build deterministically (job completes in ≤2
  steps at test grid sizes). Typecheck + full suite green (2188 tests; one
  order-dependent controller test fixed). NOT yet re-measured in acceptance.
  NEXT: far shell CPU rebuild time-slicing (same pattern), then far-summary
  tile starvation, then acceptance re-run.
- 2026-07-04: FAR SHELL FIX LANDED (commit 833adfe1). First reposition stays
  synchronous (spawn correctness before settle); later snap crossings
  resample in place under `cpuRebuildBudgetMs` (default 2 ms) with
  flush-on-completion so partial samples never render. `minStepVerts=256`
  keeps test-sized shells single-call. Typecheck + FULL suite green
  (2188/2188). NEXT: investigate far_summary_tiles_missing starvation
  (107–124 missing in every scene), then acceptance re-run to measure.
- 2026-07-04: SECOND MEASURED RUN (`2026-07-04T11-33-59`) showed the shadow
  proxy fix DID NOT ENGAGE: `shadow_proxy_build_ms 5075` still full-grid,
  because `infinite-islands` was missing from `STREAMING_LONG_VIEW_SCENES`
  (`src/shadows/longViewScene.ts`) → `streamingCentered=false` → the
  synchronous non-streaming path (and world-center coverage — wrong for a
  player outside the startup world). Tile diagnosis: `buildSomeTiles` is
  already deadline-sliced (`stepFarSummaryTileBuild`, budget
  `maxBuildMsPerFrame` = 2 ms, 1 tile/call), but infinite-islands throttled
  builds to every 30th frame (`INFINITE_ISLANDS_BUILD_INTERVAL_FRAMES`) —
  exactly 9 tiles ready in every scene. Also found: the far shell builds its
  boot heights from procedural fallbacks (`far_summary_fallback_samples`
  522k; zero tiles ready at boot) and nothing refreshed it when tiles later
  committed.
- 2026-07-04: THIRD FIX BATCH LANDED (commit after 833adfe1): added
  `infinite-islands` to `STREAMING_LONG_VIEW_SCENES` (sliced camera-centered
  proxy engages; the set gates ONLY the proxy's `streamingCentered`);
  removed the 30-frame tile-build throttle (default interval 1 everywhere,
  `farSummaryBuildInterval` query override kept); added
  `InfiniteFarShell.requestHeightRefresh()` (sliced, no-op before first
  build) driven from the bootstrap far-summary frame phase when
  `cache.hasNewCommitsSince()` at most every 120 frames. Typecheck + full
  suite green (2188/2188). Acceptance re-run in progress.
- 2026-07-04: THIRD MEASURED RUN (`2026-07-04T11-52-11`). Walk scene:
  `far_summary_tiles_missing 0` (119/119 ready — tile gate PASSES),
  `shadow_proxy_build_ms 5075→1925` (sliced stream grid, converged),
  `far_shell_last_rebuild_ms 1010→365`. Walk now fails ONLY
  `frame_ms_p95 9.1` (gate 8; rolling 120-frame window, includes sliced
  convergence frames). Freeze scenes still fail hard (p95 1087–2126,
  tiles_missing ~107): their stats snapshot revealed the recurring offender
  — `live_bubble_ms 1399` — live-bubble pages were STILL being built
  synchronously on CPU (~1.4 s/page, no `gpuMesh` param → no GPU mesher),
  recurring through the whole sample window while the bubble filled
  (47 pages × ~1.4 s ≫ settle window). `frame_ms_p95` is computed over the
  last 120 frames (`long_view_frame_diagnostics.ts`, `PHASE0_P95_WINDOW`).
  Also noted: freeze-scene `far_shell_last_rebuild_ms 1804` is TOTAL
  accumulated sliced CPU (not a frame stall).
- 2026-07-04: STEP 5 LANDED (commit after the wiring batch): `gpuMesh`
  defaults ON for infinite-islands (`gpuMesh=0` kill switch) in
  `terrain_view_startup.ts`, and the bubble's CPU fallback path now queues
  chunks per page (`cpuPendingBuilds`) and drains them in `update()` under
  `CPU_CHUNK_MESH_BUDGET_MS = 6` with deferred-ready semantics — no page
  ever meshes synchronously. Full suite green (2188/2188). Decisive
  acceptance run in progress.
- 2026-07-04 (new session): DECISIVE RUN `2026-07-04T12-11-49` was
  INTERRUPTED — walk, biome-near, biome-horizon, final-near stats exist on
  disk but no final-horizon and no `report.json`. Partial stats confirm
  step 5 engaged everywhere: walk `frame_ms_p95 6.1` (gate 8 — PASSES,
  was 9.1), `live_bubble_ms 0`, tiles 122/122, `shadow_proxy_building 0`
  (`shadow_proxy_build_ms 1938` accumulated). Biome-near:
  `frame_ms_p95 30.4` (was 1087–2126), `live_bubble_ms 0` (was 1399),
  tiles 124/124 ready — but `live_bubble_ready_pages 2/52` with 37 still
  building at snapshot time, i.e. the sample window closed mid-convergence
  (handover item 1: settle window). Full acceptance re-run launched with
  `CLOD_POC_REUSE_SERVER=1` against the leftover Vite on 5173.
- 2026-07-04: FOURTH MEASURED RUN (`2026-07-04T12-19-20`, complete, all 5
  scenes + report.json). 8 failures, ALL convergence-window sampling:
  freeze scenes fail only `frame_ms_p95` 30.3–30.8 (was 1087–2126 — the
  stutter itself is gone; the 180-frame sample starts 30 warmup frames in,
  mid-convergence) plus biome-near `far_summary_tiles_missing 4` (still
  draining). Walk: `frame_ms_p95 14.9` (run-to-run variance vs 6.1 in
  12-11-49) + `live_bubble_ready_pages 0` + `live_bubble_streamed_collider
  _pages 0` — snapshot lands mid-refill after the movement route because
  the GPU-meshed bubble no longer becomes ready by stalling frames (the
  old sync path implicitly guaranteed ready>0 at snapshot).
  ALSO CHECKED (handover item 3): no threshold gates `shadow_proxy_build_ms`
  or `far_shell_last_rebuild_ms` — accumulated-total semantics need no gate
  change, documentation only (this entry is that documentation).
- 2026-07-04: MEASUREMENT FIX LANDED in the harness (not gates):
  `waitForConvergence()` in `tools/infinite-islands-acceptance.ts` polls
  `far_summary_tiles_missing===0`, live-bubble quiet
  (`required===0 || (building===0 && ready>0)`), and
  `shadow_proxy_building!==1` every 500 ms until quiet 3 consecutive polls
  (cap 120 s, proceed + log on timeout), called after warmup AND after the
  walk movement route so the sampled 120-frame p95 window is steady state.
  Thresholds untouched. Typecheck green. Acceptance re-run in progress.
- 2026-07-04: Resumed from handover and reviewed this session log. Next
  action is to inspect the newest acceptance run newer than
  `2026-07-04T12-19-20` before deciding whether to re-run acceptance.
- 2026-07-04: Found newer acceptance directory
  `2026-07-04T12-28-04`, but it has no `report.json`, so the background
  acceptance run is incomplete and cannot be used as the decisive result.
- 2026-07-04: Inspected incomplete run contents: walk, biome-near,
  biome-horizon, and final-near artifacts exist; final-horizon and the
  top-level report are missing. Port `5173` is occupied by an existing Vite
  server, so the next acceptance run should use `CLOD_POC_REUSE_SERVER=1`.
- 2026-07-04: Started fresh acceptance run with
  `CLOD_POC_REUSE_SERVER=1`; run directory is
  `2026-07-04T12-40-58`, reusing Vite at `http://127.0.0.1:5173/`.
- 2026-07-04: Run `2026-07-04T12-40-58` is invalid as a performance
  signal: all five scenes failed with zero threshold values. Walk timed out
  while still `building world (0.5)` after repeated module fetch failures;
  the other scenes hit `page.goto net::ERR_CONNECTION_REFUSED`. This points
  to the stale reused Vite server, not to acceptance gates.
- 2026-07-04: Rechecked port `5173` after the invalid run; no listener
  remained, so the next acceptance run can start and own a clean Vite
  server without `CLOD_POC_REUSE_SERVER`.
- 2026-07-04: Started clean acceptance run without server reuse; Vite
  started on `http://127.0.0.1:5173/` and the run directory is
  `2026-07-04T12-44-35`.
- 2026-07-04: During run `2026-07-04T12-44-35`, the first walk convergence
  wait logged `converged after 33.7s`. Later silence is not a dead run:
  `walk-movement.json` was written and Vite remains listening, so the run is
  past movement and still waiting/sampling.
- 2026-07-04: Same run: walk post-route convergence timed out after 120 s
  with snapshot `{tilesMissing:0,bubbleBuilding:0,bubbleReady:0,
  bubbleRequired:43,proxyBuilding:0}`. This will need walk counter
  inspection after the run completes; it is not a freeze-scene stutter
  signature.
- 2026-07-04: Clean run `2026-07-04T12-44-35` completed with 4 failures.
  Convergence engaged for freeze scenes (`biome-near` 42.6 s,
  `biome-horizon` 31.7 s, `final-near` 59.7 s, `final-horizon` 58.6 s).
  Stutter gates are largely fixed: walk `frame_ms_p95=5.9`,
  `far_summary_tiles_missing=0`, `live_bubble_ms=0`. Remaining failures:
  walk `live_bubble_ready_pages=0` and
  `live_bubble_probe_collider_removals_total=0`; biome-near
  `frame_ms_p95=9.0`; final-near `frame_ms_p95=8.1`. Horizon scenes passed.
- 2026-07-04: Investigated walk failures. Movement samples did observe
  ready live-bubble pages (`maxReady=2`) and builds (`liveBuiltDelta=47`),
  but the final post-route snapshot had required pages with no ready page
  entries. Implemented a targeted live-bubble source fix: build
  streaming-required page coords before render-view bubble pages so the
  acceptance-required set cannot starve, and mirror probe evictions using
  only collider-bearing evictions so the collider-removal gate is tied to
  pages that actually registered colliders. Thresholds unchanged.
- 2026-07-04: Typecheck passed after the live-bubble prioritization/probe
  counter fix (`rtk npm --prefix tools/clod-poc run typecheck`).
- 2026-07-04: Started clean post-fix acceptance run
  `2026-07-04T13-03-18` with the harness-owned Vite server on
  `http://127.0.0.1:5173/`.
- 2026-07-04: In run `2026-07-04T13-03-18`, initial walk convergence
  settled after 37.0 s, but post-route convergence still timed out after
  120 s with `{tilesMissing:0,bubbleBuilding:0,bubbleReady:0,
  bubbleRequired:46,proxyBuilding:0}`. The priority change did not fix the
  final ready-page counter; inspect artifacts after completion.
- 2026-07-04: User supplied review of the live-bubble follow-up and asked
  to fix issues before acceptance. Stopped the in-progress
  `2026-07-04T13-03-18` acceptance/Vite processes; that run is intentionally
  incomplete and should not be used as a signal.
- 2026-07-04: Checked current `main` after external commits. The review
  fixes are already present: collider removals are mirrored by delta,
  public `live_bubble_evictions_total` stays cumulative, probe evictions
  count only collider-bearing page evictions, missing required pages count
  as building, and `live_bubble_streamed_collider_pages` now counts pages
  rather than chunk colliders. Targeted tests exist in
  `near_field_bubble_controller.test.ts` and `terrain_frame_phase.test.ts`.
- 2026-07-04: Typecheck failed in the new tests only:
  `terrain_frame_phase.test.ts` used partial `EngineStats`/`Location`
  shapes, and `near_field_bubble_controller.test.ts` indexed an inferred
  empty tuple. Patching test types narrowly before rerunning.
- 2026-07-04: Patched the new tests only: the fake hook stats now satisfy
  `EngineStats`, the fake location is explicitly cast, and the mesher mock
  call is cast before indexing.
- 2026-07-04: Typecheck is now clean after completing the hook test stub and
  installing it via `Object.defineProperty(globalThis, "window", ...)`.
- 2026-07-04: Focused Vitest run passed directly (no `rtk`):
  `near_field_bubble_controller.test.ts` and
  `terrain_frame_phase.test.ts`, 2 files / 11 tests.
- 2026-07-04: Started fresh acceptance run `2026-07-04T13-16-00` with a
  harness-owned Vite server on `http://127.0.0.1:5173/`.
- 2026-07-04: User supplied another review before `13-16-00` completed.
  Stopped the run after its initial walk convergence (`56.3s`); this run is
  intentionally incomplete. Next fix: ready-but-empty required pages should
  count as ready, and convergence diagnostics should include failed pages.
- 2026-07-04: Applied review follow-ups without changing thresholds:
  finished required pages now count as ready even when they have no geometry
  children; the convergence wait snapshot includes `live_bubble_failed_pages`
  and requires zero failed pages before quiet; acceptance URLs now pass
  `acceptance=1`; and the live-bubble probe baselines collider removals from
  the current mirrored counter so first-frame removal deltas are counted.
  Added focused tests for empty finished pages and first-frame probe removal
  deltas.
- 2026-07-04: Typecheck passed after the review follow-ups
  (`rtk npm --prefix tools/clod-poc run typecheck`).
- 2026-07-04: Focused Vitest passed directly after the review follow-ups:
  `near_field_bubble_controller.test.ts` and
  `terrain_frame_phase.test.ts`, 2 files / 12 tests.
- 2026-07-04: Started fresh acceptance run `2026-07-04T13-21-11` after
  stopping a leftover Playwright Chromium from the aborted run.
- 2026-07-04: In run `2026-07-04T13-21-11`, walk initial convergence
  settled after 41.8 s and post-route convergence now settled after 12.8 s
  instead of timing out. The empty-ready-page fix addressed the bad
  `required>0/building=0/ready=0` wait shape.
- 2026-07-04: Run `2026-07-04T13-21-11` completed with 5 failures, all
  `frame_ms_p95` only. Counter health is now good: every scene has
  `far_summary_tiles_missing=0`, `live_bubble_ready_pages=required`,
  `live_bubble_building_pages=0`, `live_bubble_failed_pages=0`, and positive
  streamed collider pages. p95 values: walk 8.3, biome-near 10.1,
  biome-horizon 9.3, final-near 10.5, final-horizon 9.6. Next step per
  handover: profile with `perfProbe=1` before touching budgets.
- 2026-07-04: First perf probe
  `perf-runs/infinite-islands-13-21-p95-profile` completed, but it sampled
  convergence rather than steady state: frame p95 56.8, top phase
  `longViewDiagnosticsMs` p95 60.2 / `farSummaryMs` p95 51.3, render p95
  only 3.2. Rerunning with longer warmup before interpreting p95.
- 2026-07-04: Steady perf probe
  `perf-runs/infinite-islands-13-21-steady-profile` completed with
  `perfWarmup=1800`: frame p50 4.0 / p95 6.0, render p95 1.5,
  selection p95 0.1, bubble p95 0.1, props p95 4.6. Broad buckets show
  `longViewDiagnosticsMs` p95 31.1 and `farSummaryMs` p95 2.8, but broad
  buckets are overlapping/instrumentation buckets and should not be added to
  frame time. This suggests steady headless can meet the 8 ms walk budget;
  next check is why acceptance `frame_ms_p95` remains 8.3-10.5.
- 2026-07-04: Found acceptance p95 measurement issue: URLs now pass
  `acceptance=1`, but `profile_every_frame:false` meant stats sync still
  ran sparsely (`statsSyncRuns=501`, `statsSyncSkips=1301` in walk), so
  `frame_ms_p95` was a sparse diagnostic sample instead of a full rolling
  frame window. Changed `StatsSyncThrottle` so `acceptanceActive` forces
  `profile` sampling every frame; normal/manual behavior remains gated by
  config.
- 2026-07-04: Typecheck passed after the acceptance stats-sync fix, and
  focused Vitest passed directly for `near_field_bubble_controller.test.ts`,
  `terrain_frame_phase.test.ts`, and `stats_sync_throttle.test.ts`
  (3 files / 24 tests).
- 2026-07-04: User relayed another review. Current status: `acceptance=1`
  is already explicit on acceptance URLs. Remaining live-bubble GPU
  scheduler/cancellation and GPU-failure CPU fallback risks are real
  hardening items, but the next decision point is the post-stats-sync
  acceptance run: if it passes, log them as follow-ups; if post-route
  building/ready regresses or p95 spikes, address the relevant path next.
- 2026-07-04: Started post-stats-sync acceptance run
  `2026-07-04T13-47-53`; walk URL includes explicit `acceptance=1`.
- 2026-07-04: User asked to act on the latest review before acceptance.
  Stopped the active `2026-07-04T13-47-53` run during walk; this run is
  intentionally incomplete. Next changes target live-bubble GPU queue
  starvation/cancellation and GPU-failure fallback hardening.
- 2026-07-04: Implemented live-bubble GPU hardening. GPU-backed page
  creation now registers a pending chunk job instead of immediately
  enqueueing all page chunks into the serialized `GpuChunkMesher`; `update()`
  dispatches a small number of current chunks per frame, sorted by most
  recently touched page, and stale completions are ignored if the page/job
  was evicted. GPU chunk failures no longer run synchronous CPU fallback in
  the promise completion; the page finishes failed once its dispatched GPU
  chunks settle. Also wrapped `GpuChunkMesher` phase-2 readback buffers in
  `try/finally` cleanup so temporary buffers are destroyed on map/readback
  errors. Updated focused live-bubble tests for incremental dispatch.
- 2026-07-04: Verification after GPU hardening: typecheck passed
  (`rtk npm --prefix tools/clod-poc run typecheck`), and focused Vitest
  passed directly for `near_field_bubble_controller.test.ts`,
  `terrain_frame_phase.test.ts`, and `stats_sync_throttle.test.ts`
  (3 files / 25 tests).
- 2026-07-04: Started fresh post-hardening acceptance run
  `2026-07-04T13-52-52`; walk URL includes explicit `acceptance=1`.
- 2026-07-04: In run `2026-07-04T13-52-52`, walk initial convergence
  settled after 34.7 s and post-route convergence settled after 13.4 s.
  Incremental GPU dispatch did not regress the route refill wait.
- 2026-07-04: Run `2026-07-04T13-52-52` completed with 3 failures, all
  `frame_ms_p95` only: walk 10.0, biome-near 8.8, biome-horizon 8.8.
  Final-near passed at 5.1 and final-horizon passed at 7.9. All live-bubble
  and far-summary counters are healthy. Raw stats confirm acceptance
  stats-sync is now every frame (`statsSkips=0`, reason `profile`), so the
  remaining p95 issue is not convergence or missing counters; next check is
  whether forcing the heavier stats-sync phase every frame is itself adding
  measurement overhead.
- 2026-07-04: Corrected the stats-sync diagnosis: `frame_ms_p95` is updated
  by long-view diagnostics after render, not by the throttled stats-sync
  phase. Forcing full stats-sync every frame added acceptance overhead, so
  that change and its test were reverted. Keep `acceptance=1`; do not force
  UI/stat presenter sync every frame.
- 2026-07-04: Continued after newer commits `75a69e84`/`ab3d2fed` landed.
  Focused final-horizon perf probe
  `perf-runs/infinite-islands-14-08-final-horizon-profile-short` was clean
  (frame p50 3.1 ms, p95 3.7 ms, render p95 0.7 ms, selection/bubble p95
  0.1 ms), so the earlier `14-08-56` final-horizon p95=8.7 looked like
  run variance rather than a steady bottleneck.
- 2026-07-04: Acceptance run `2026-07-04T14-32-36` failed with a different
  shape: `walk` and `biome-near` timed out waiting for 30 rendered frames,
  while rendered later scenes had 52 ready live-bubble pages but zero
  collider pages/registrations. Good runs had 2-3 collider pages and 32-48
  registrations. Updated `waitForConvergence()` to remove the unreliable
  live-CLOD stream quiet predicate (stream counters are zero even in good
  runs) and require live-bubble collider pages/registrations when required
  pages are present. Thresholds unchanged.
- 2026-07-04: Typecheck passed and focused Vitest passed directly for
  `near_field_bubble_controller.test.ts`, `terrain_frame_phase.test.ts`, and
  `stats_sync_throttle.test.ts` (3 files / 27 tests) after the convergence
  predicate edit.
- 2026-07-04: Acceptance run `2026-07-04T14-46-20` then failed all five
  scenes with `timed out waiting for 30 rendered frame(s)`. Screenshots were
  valid PNGs, but stats and phase0 reports were only error stubs, so the app
  was drawable while the 30-frame settle hook did not resolve before the
  helper's 2.4 s fallback. Updated `page_settle.ts` to keep the same frame
  counts and global 30 s cap, but allow short rendered-frame waits up to
  10 s before timing out.
- 2026-07-04: Typecheck passed after the `page_settle.ts` rendered-frame
  timeout adjustment (`rtk npm --prefix tools/clod-poc run typecheck`).
- 2026-07-04: Started acceptance rerun
  `acceptance-runs/infinite-islands/2026-07-04T14-56-49` with the corrected
  convergence predicate and longer short-settle timeout.
- 2026-07-04: Stopped run `2026-07-04T14-56-49` after the walk convergence
  timeout revealed it was using the reverted stream-quiet predicate. The
  source on disk had reverted to the stream fields, while `page_settle.ts`
  already retained the 10 s short-settle timeout in `HEAD`. Reapply the
  convergence predicate before rerunning acceptance.
- 2026-07-04: Reapplied the convergence predicate in
  `tools/infinite-islands-acceptance.ts`: remove live-CLOD stream quiet
  gating and require live-bubble collider pages/registrations when
  live-bubble required pages are present. Verified the diff only touches that
  predicate.
- 2026-07-04: Typecheck passed after reapplying the convergence predicate
  (`rtk npm --prefix tools/clod-poc run typecheck`).
- 2026-07-04: Started acceptance rerun
  `acceptance-runs/infinite-islands/2026-07-04T15-02-29` after verifying the
  corrected convergence predicate in source.
- 2026-07-04: Stopped run `2026-07-04T15-02-29` after the walk convergence
  timeout produced the intended collider-focused snapshot:
  `tilesMissing=0`, `tilesBuilding=0`, `bubbleBuilding=0`,
  `bubbleReady=52`, `bubbleRequired=52`, `bubbleFailed=0`,
  `bubbleColliderPages=0`, `bubbleColliderRegistrations=0`,
  `proxyBuilding=0`. This confirms the remaining failure is live-bubble
  pages becoming ready without any collider-producing chunks.
- 2026-07-04: Next controller fix: when the GPU mesher returns an empty
  chunk for a live-bubble page, enqueue that chunk for the existing sliced CPU
  build path and do not mark the page ready until CPU confirmation drains.
  This keeps true empty pages valid, but prevents a GPU all-empty result from
  satisfying convergence as ready-without-colliders.
- 2026-07-04: Implemented the targeted GPU-empty confirmation path for
  live-bubble pages when `terrainColliders` is present. GPU-empty chunks are
  queued onto the existing CPU pending chunk path, GPU completion waits for
  pending CPU fallback chunks, and CPU fallback completion waits for any
  remaining GPU job before marking the page ready. Added a focused test that
  GPU-empty chunks become collider registrations via sliced CPU fallback.
- 2026-07-04: Verification after GPU-empty confirmation path: typecheck
  passed, and focused Vitest passed directly for
  `near_field_bubble_controller.test.ts`, `terrain_frame_phase.test.ts`, and
  `stats_sync_throttle.test.ts` (3 files / 28 tests).
- 2026-07-04: Started acceptance rerun
  `acceptance-runs/infinite-islands/2026-07-04T15-09-40` after the
  GPU-empty CPU confirmation fix.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `walk: converged after 79.9s`, confirming the collider-readiness predicate
  can now be satisfied after GPU-empty CPU confirmation.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `walk:post-route: converged after 80.7s` and advanced to `biome-near`.
  Route refill is slower with CPU confirmation, but no longer stuck at zero
  live-bubble colliders.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `biome-near: converged after 74.8s` and advanced to `biome-horizon`.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `biome-horizon: converged after 77.7s`.
- 2026-07-04: Run `2026-07-04T15-09-40` advanced to `final-near`.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `final-near: converged after 74.7s`.
- 2026-07-04: Run `2026-07-04T15-09-40` advanced to `final-horizon`.
- 2026-07-04: Run `2026-07-04T15-09-40` reported
  `final-horizon: converged after 73.8s`; awaiting final report.
- 2026-07-04: Run `2026-07-04T15-09-40` failed with 2 remaining
  `frame_ms_p95` misses only: walk 8.3 ms and final-horizon 8.8 ms
  (gate 8 ms). All readiness counters are healthy: far-summary
  missing/building 0, live-bubble required pages ready, building/failed 0,
  and collider pages/registrations present (walk 64/2304, freeze scenes
  52/832). Next step is perf profiling before touching budgets.
- 2026-07-04: Verified the current `HEAD` contains the relevant harness and
  controller changes (`bubbleColliderPages` convergence, 10 s short-settle
  timeout, and `enqueueCpuChunkBuild` GPU-empty confirmation). Worktree is
  only the session log.
- 2026-07-04: Port 5180 was already in use, so started a separate clod-poc
  dev server on `http://127.0.0.1:5181/` for focused perf probes.
- 2026-07-04: First final-horizon `perfProbe=1` attempt used a 5000-frame
  warmup, but the page restarted during warmup and the probe was stopped
  before producing a summary. Avoid editing files while the next probe runs
  to reduce Vite reload interference.
- 2026-07-04: Focused `perfProbe=1` profiles did not reproduce the remaining
  acceptance p95 failures. Final-horizon
  `perf-runs/infinite-islands-15-09-final-horizon-profile-short` reported
  frame p50 3.2 ms, p95 4.3 ms, render p95 0.9 ms, selection/bubble p95
  0.1 ms. Walk post-route
  `perf-runs/infinite-islands-15-09-walk-post-route-profile-short` reported
  frame p50 5.5 ms, p95 6.1 ms, render p95 3.1 ms, selection p95 0.2 ms,
  bubble p95 0.1 ms. Top broad bucket in both was long-view diagnostics,
  which is diagnostic overhead and not additive to frame p95. Rerun
  acceptance once for variance before changing code or budgets.
- 2026-07-04: Pulled latest `main` after commits `8ec5945f`, `4a74b4d6`,
  and `b6205231`; `rtk git pull --rebase --autostash` reported up-to-date.
  Worktree is still only this session log.
- 2026-07-04: Typecheck failed after latest pull in
  `src/player/player_edit_authority.ts` on tuple-vs-object narrowing for
  edit authority point parsing (`TS2345` at lines 136-146). Next step: fix
  the narrow type guard without changing behavior.
- 2026-07-04: Added an explicit `PlayerEditAuthorityTuple` type guard in
  `src/player/player_edit_authority.ts` so build commit/preview targets
  narrow correctly before tuple-to-point conversion. Runtime behavior
  unchanged.
- 2026-07-04: Typecheck passed after the player edit authority type guard
  fix (`rtk npm --prefix tools/clod-poc run typecheck`).
- 2026-07-04: Requested focused Vitest selection passed directly (no `rtk`):
  `src/player`, `src/construction`, `src/app/frame_loop`,
  `src/app/bootstrap/ui`, `src/app/bootstrap/runtime`,
  `src/terrain/editing`, and `src/terrain/near_field` (17 files /
  113 tests).
- 2026-07-04: Started acceptance run
  `acceptance-runs/infinite-islands/2026-07-04T17-03-46`; stopped it after
  multiple convergence timeouts showed the same live-bubble failure shape:
  far-summary/build queues quiet, but required live-bubble pages terminally
  failed with `bubbleReady=0`, `bubbleFailed=36-49`, and
  `bubbleColliderPages=0` / `bubbleColliderRegistrations=0`. User identified
  the likely cause: all-empty GPU pages in live streaming are being retried
  and terminal-failed instead of becoming valid-empty/ready.
- 2026-07-04: Latest `main` now includes `cbae14aa Treat empty live bubble
  pages as valid`, plus the retry counter mirror. Before rerunning local
  validation, add the small pending convergence improvement so
  `waitForConvergence()` also waits for `live_bubble_gpu_retry_pages===0`.
- 2026-07-05: Pulled latest `main` with `59ce9261`/`5d42c175`; run
  `2026-07-05T03-06-18` now converges all scenes but fails 10 threshold
  checks because live-bubble reports every required page ready as
  `valid_empty` with `live_bubble_streamed_collider_pages=0` and
  `live_bubble_collider_registrations=0`. Code review found the likely
  cause: live-bubble correctly marks out-of-finite-world page bounds as
  `finite:false`, but `GpuChunkMesher` drops that flag and the WGSL still
  clips quads against finite `cellsX/cellsZ`, producing empty GPU chunks at
  `x=2048,z=2048`.
- 2026-07-05: Patched the GPU live-bubble mesher contract to carry a
  `finiteWorld` bit through `packMeshParams()` into
  `terrain_field_entry.wgsl`; the WGSL perimeter clip now only applies when
  the world is finite. Added host-side coverage for `finite:false` packing
  and surface-nets parity outside finite bounds while preserving finite-world
  clipping.
- 2026-07-05: Local validation passed for the finite-world GPU mesher fix:
  `rtk npm --prefix tools/clod-poc run typecheck` and direct Vitest for
  `src/gpu/gpu_mesh_buffers.test.ts`, `src/gpu/surface_nets_core.test.ts`,
  and `src/terrain/near_field/near_field_bubble_controller.test.ts`
  (3 files / 28 tests).

## Remaining known risks / next steps if gates still fail

1. Walk `frame_ms_p95` 9.1 vs 8: steady state was 8.4 on this machine even
   BEFORE slicing (headless Chromium; possibly SwiftShader — frame times
   may not reflect a real GPU). If it still fails after step 5: profile the
   steady 8.4 ms frame (perfProbe=1) before touching budgets; do NOT weaken
   the gate.
2. Freeze scenes: expect tiles + p95 to improve dramatically once the
   bubble no longer stalls (tile builds get real frames). If tiles still
   miss: check whether the settle safety cap (15 s in page_settle.ts) cuts
   the 180-frame sample short.
3. Manual playable defaults (dc5749f7) still disable liveBubble/shadowProxy/
   farShellCpuHeights for manual play — once acceptance is green, consider
   re-enabling them by default and deleting the workaround.
4. Carried-over items from the handoff doc (dig index for streamed pages,
   vegetation on streamed pages, mid-field coarse-LOD annulus, river basin
   jumps, grass/stone clamps) are unchanged.
