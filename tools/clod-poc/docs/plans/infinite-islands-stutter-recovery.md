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

## Session log (update as steps land)

- 2026-07-04: Analysis complete (this doc). Root causes A (harness `__name` +
  module-constant capture) and B (3 synchronous frame-path rebuilds)
  identified and verified in code. No fixes landed yet.
