# Handover: infinite-islands stutter recovery (continue here)

Written 2026-07-04. Self-contained context for a fresh session. The living
status/session log is `infinite-islands-stutter-recovery.md` (same folder) —
keep updating THAT doc as you work. The older
`infinite-islands-clod-root-streaming-handoff.md` is background only; its
items 1–7 were implemented in a previous session and streamed CLOD roots are
healthy — do not re-litigate.

## Constraints (unchanged, hard)

- `tools/clod-poc` only. No Rust/Bevy changes. Solo — no sub-agents.
- Token-frugal: no broad discovery; read targeted files only.
- NEVER weaken acceptance gates (`tools/infinite_acceptance/thresholds.ts`).
- No heavy work on the main thread frame path; `setTimeout(0)` is not async.
- Small commits ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- rtk is OK ONLY for `tsc` typecheck. NEVER run vitest / vite build / dev
  server / acceptance through rtk (they fail with phantom errors).

## What this effort is

The infinite-islands scene (browser PoC, WebGPU, three.js) stuttered
unplayably and its acceptance suite failed. Root causes were synchronous
CPU rebuilds on the frame path plus a broken acceptance harness. Five
commits landed this session (all on `main`, all typecheck + full-suite
green — 2188 tests):

1. `b649a758` — acceptance harness fix. tsx/esbuild `keepNames` injected
   `__name(...)` into `page.evaluate` closures → every scene died with
   ReferenceError, zero counters ever collected. Fixed via string-form
   `addInitScript` defining `globalThis.__name` + self-contained settle
   closure (`tools/infinite_acceptance/page_settle.ts`,
   `tools/infinite-islands-acceptance.ts`).
2. `6dfd0c03` — shadow proxy: streaming rebuilds became an incremental job
   (`src/shadows/shadowProxyGeometry.ts` `createShadowProxyGeometryJob`,
   stepped from `updateFrame`/`rebuildIfNeeded` in
   `src/shadows/shadowProxyController.ts`) with `build_budget_ms` (default
   2 ms) on `stream_grid_res` (default 160 vs full 512); old mesh renders
   until swap; fd-normals replace computeVertexNormals.
3. `833adfe1` — far shell (`src/long-view/infiniteFarShell.ts`): CPU height
   rebuilds sliced under `cpuRebuildBudgetMs` (2 ms) after the FIRST
   reposition (first stays sync for spawn correctness); flush only on
   completion.
4. `b687e5cb` — wiring: added `infinite-islands` to
   `STREAMING_LONG_VIEW_SCENES` (`src/shadows/longViewScene.ts`) so the
   sliced camera-centered proxy path actually engages (it gates ONLY the
   proxy's `streamingCentered`); removed the legacy 30-frame far-summary
   tile build throttle (`src/far-summary/integration.ts` — builds are
   already deadline-sliced by `maxBuildMsPerFrame` 2 ms, 1 tile/call);
   added `InfiniteFarShell.requestHeightRefresh()` driven from
   `clod_poc_bootstrap.ts` when `farSummaryIntegration.cache
   .hasNewCommitsSince()` (≤ every 120 frames) because the shell boots from
   procedural fallbacks before any tiles are ready.
5. `15edb037` — live bubble: GPU chunk mesher now defaults ON for
   infinite-islands (`gpuMesh=0` kill switch,
   `src/app/bootstrap/terrain_view_startup.ts` ~line 406), and the CPU
   fallback in `src/terrain/near_field/near_field_bubble_controller.ts`
   queues chunks per page (`cpuPendingBuilds`) drained in `update()` under
   `CPU_CHUNK_MESH_BUDGET_MS = 6` with deferred-ready — a page never meshes
   synchronously (was ~1.4 s/page in freeze scenes).

## Measured progression (walk scene counters)

| Counter | run 11-04-15 (baseline) | run 11-33-59 | run 11-52-11 |
| --- | --- | --- | --- |
| frame_ms_p95 (gate ≤8) | 8.4 | 9.1* | 9.1 |
| frame_ms_avg | 37.6 | 38.7 | 38.7 |
| live_bubble_ms | 0.1 | 0 | 0 |
| shadow_proxy_build_ms | 5785 | 5075 (fix not engaged) | 1925 (sliced, converged) |
| far_shell_last_rebuild_ms | 1010 | 1070 | 365 |
| far_summary_tiles_missing | 107 | 109 | **0** (119/119 ready) |

*Freeze scenes (biome-near/horizon, final-near/horizon) still failed p95
(1087–2126 ms) and tiles (~107 missing) in run 11-52-11 because
`live_bubble_ms = 1399` — synchronous CPU page builds recurred through
their whole sample window. Commit `15edb037` targets exactly that; the
decisive acceptance run `2026-07-04T12-11-49` was IN PROGRESS when this
handover was written.

## FIRST ACTION in the new session

Read `tools/clod-poc/acceptance-runs/infinite-islands/2026-07-04T12-11-49/report.json`
(and per-scene `*-stats.json`). If that run is missing/incomplete, re-run:

```powershell
npm --prefix tools/clod-poc run accept:infinite-islands   # NO rtk; starts its own Vite on 5173
```

(Stop any dev server on 5173 first, or set `CLOD_POC_REUSE_SERVER=1`.)
Record the numbers in the session log of
`infinite-islands-stutter-recovery.md`, then work the remaining items.

## Remaining work, in order

1. **Freeze scenes** — expect big improvement from `15edb037` (bubble no
   longer stalls → tile builds get real frames). If tiles still miss:
   the in-page settle safety cap is 15 s
   (`tools/infinite_acceptance/page_settle.ts` `IN_PAGE_TIMEOUT_MS`) and can
   cut the 180-frame sample short; `frame_ms_p95` is a rolling 120-frame
   window (`src/phase0/long_view_frame_diagnostics.ts`
   `PHASE0_P95_WINDOW`). Extending settle so the sampled window is truly
   post-convergence is a measurement fix, not gate weakening.
2. **Walk `frame_ms_p95` 9.1 vs gate 8.** Steady state was already 8.4
   before any slicing; sliced work adds ≤2 ms during convergence windows.
   Profile the steady frame with `&perfProbe=1` before touching budgets
   (bubbleMs/selectionMs/propsMs/otherMs breakdown exists —
   `src/app/frame_loop/render_phase.ts`). Note: acceptance runs headless
   Chromium (`--enable-unsafe-webgpu`) — possibly SwiftShader, so frame
   times are CPU-rendered and machine-bound. Do NOT weaken the gate; if the
   machine can't do 8 ms headless, say so in the report with evidence.
3. **Interpretation change to document/check:** `shadow_proxy_build_ms` and
   `far_shell_last_rebuild_ms` are now ACCUMULATED totals of sliced work,
   not single-frame stalls. `shadow_proxy_building` (0/1) reports in-flight
   proxy builds. If any threshold/test assumes they are single-frame costs,
   fix the interpretation, not the gate.
4. **Revert the manual-play workaround** once acceptance is green:
   `applyManualInfiniteIslandsDefaults` in
   `src/app/bootstrap/clod_poc_bootstrap.ts` (from `dc5749f7`) forces
   `liveBubble=0&shadowProxy=0&canopy=0&farShellCpuHeights=0` for manual
   URLs with `x`/`z`. The whole point of this effort is that the full path
   is now playable — re-enable and verify manually at
   `?scene=infinite-islands&world=16&clodPerf=1&webgpuSelection=1&x=2048&z=2048&yaw=2.65`
   (dev server: `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort`).
   Watch `live_bubble_ms`, `shadow_proxy_building`, HUD stutter while
   flying. Also note acceptance stays on the full path only via the
   `proceduralDebug=biome` guard (`b55a6070`) — consider `acceptance=1` on
   all acceptance URLs instead (fragile string coupling).
5. **Carried-over scope (separate passes, from the old handoff doc):**
   streamed pages not in dig index; vegetation frozen to startup
   `lod0Nodes`; mid-field coarse-LOD annulus (bubble edge → 2048 m);
   hydrology river jumps at 768 m basin borders; verify grass/stone clamps
   (`src/grass/grass_gpu_ring.ts:142`, `src/gpu/stone_scatter_compute.ts:155`)
   in the browser at the outside spawn.

## Test commands

```powershell
rtk npm --prefix tools/clod-poc run typecheck    # tsc — rtk OK
npm --prefix tools/clod-poc test                  # vitest — NEVER rtk
npm --prefix tools/clod-poc run build             # vite — NEVER rtk
npm --prefix tools/clod-poc run accept:infinite-islands
# targeted while iterating:
cd tools/clod-poc
npx vitest run src/shadows src/long-view src/far-summary src/terrain/near_field
```

## Gotchas that cost time this session

- PowerShell 5.1 here: no `&&`; `Set-Location` persists between tool calls
  (use absolute paths).
- Acceptance scene stats come from `window.__drusnielClod.stats.counters`;
  `freeze=1` freezes ONLY CLOD selection — the frame loop and far-summary
  phase still run.
- The controller/shell tests rely on small grids completing a sliced build
  in ≤2 steps — keep minimum-progress-per-step guarantees
  (`BUDGET_CHECK_INTERVAL` 64 samples, `minStepVerts` 256) if refactoring.
- One shadow controller test is order-dependent under full-suite CPU load;
  it drains the boot build via `rebuildIfNeeded()` before asserting — keep
  that pattern.
