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
