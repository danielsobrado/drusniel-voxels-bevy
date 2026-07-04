# Handoff: infinite-islands review + CLOD root streaming re-architecture

Status: review COMPLETE, re-architecture ~40% done (worker plumbing landed, wiring pending).
Scope: `tools/clod-poc` only. No Rust/Bevy changes. No sub-agents.

## Review verdict (validated against code on main, commit `8e38a561`)

Overall: the live bubble, colliders, water/hydrology, and vegetation work is
**directionally correct** for a browser PoC. Counters published from
`near_field_bubble_controller` / `terrain_frame_phase` / `vegetation_frame_phase`
are **real state**, not the old simulated `LiveVoxelChunkStreamer` values.
Typecheck passes; all 2157 tests pass.

Per-area findings:

1. **Streaming CLOD root slice (`src/terrain/streaming/clod_streaming_roots.ts`) — architecturally wrong, currently dormant.**
   - Builds run `buildLod0PageSource(...)` synchronously on the **main thread**
     behind `setTimeout(0)`. That is "off the update() call stack" but NOT off
     the frame path — a full 4×4-chunk Surface Nets page build (~10–40 ms)
     blocks whatever frame the macrotask lands on. Violates the CLOD invariant
     "page builds never run on the frame path". Only the count per frame is
     budgeted, not the milliseconds.
   - Default budget is **0** (`liveClodRootBudget` unset → no builds ever), so
     the shipped default is a counter-only no-op. The commit trail
     (`ac9cf37a` disable, `347b26ab` "enable by default") ended with: enabled
     flag on (planner/counters), builds off.
   - It re-extracts terrain from the SDF instead of deriving pages from live
     chunk meshes; radius is `state.bubbleRadius`, i.e. the exact footprint the
     live bubble already owns with raw chunks — inside the bubble it duplicates
     geometry; it does nothing for the real gap (bubble edge → far shell inner
     at 2048 m). LOD0-only can never scale to that annulus (~3200 pages).
   - Latent z-fight: bubble "owned" check hides page views only when the page
     center is `< bubbleRadius`, while chunk groups are built out to
     `radius + halfDiag`. In the rim band both the streamed page mesh and the
     raw chunk group would be visible — coincident triangles from the same SDF.
   - Verdict: **do not polish; re-architect to worker-built pages** (below).
     Its legitimate purposes: (a) fallback mesh while bubble chunk groups
     build outside the startup world, (b) persistent terrain behind/around the
     player. Both are served by async worker builds.

2. **Sticky bubble guard (`src/app/state/clod_state.ts` `preserveEnabledBubble`) — wrong mechanism.**
   `Object.defineProperty` makes `state.bubble` silently un-settable to false
   (GUI toggle, archives, runtime perf preset all no-op). The reason it exists:
   `applyScenePresets` (`src/app/state/index.ts:152`) and `applyClodPerfMode`
   (`src/app/bootstrap/info_panel_startup.ts:156`) set `bubble = false` for
   `clodPerf=1`, which acceptance URLs use. Replace with an explicit
   `liveBubblePinned: boolean` state field consulted by those two preset sites;
   delete the defineProperty trap; `liveBubble=0` and the GUI must both work.
   Update `src/app/state/clod_state.test.ts` (lines ~79–87 assert the sticky
   trap — rewrite to assert preset-respect + manual-disable-works).

3. **Acceptance gates — mostly real now, three problems.**
   (`tools/infinite_acceptance/thresholds.ts`)
   - Real and good: `live_bubble_required_pages > 0`, `live_bubble_ready_pages > 0`,
     `live_bubble_streamed_collider_pages > 0`, collider registrations > 0,
     hydrology non-repeat (detects the old wrap bug specifically), walk scene
     spawns the player at (2048, 2048) — genuinely outside the 1024 m startup
     world, so live streaming from nothing is actually exercised.
   - Fake: `>= 0` rules (`live_clod_stream_cached_pages`, `_built_this_frame`,
     `_evictions`, `live_bubble_collider_removals`) can never fail — theater.
   - Gap: the walk scene is a **stationary** spawn; nothing moves the player,
     so sustained movement (build churn, eviction, fast turn) is untested.
   - Gap: `live_clod_stream_cached_pages` stays 0 forever with default budget 0
     and nothing fails — "streamed CLOD roots" pass without a single page.

4. **Live bubble + colliders — sound.** Counters derive from actual
   `chunkGroups`; collider registration happens per chunk mesh on ready with
   stale-entry identity checks; eviction removes collider pages; capsule
   collision uses MeshBVH; procedural height fallback only when
   `pagesTested === 0`. One cleanup: the controller falls back to a
   `window.__drusnielTerrainColliders` global bridge — DI is trivial since
   `terrain_view_startup` already receives `terrainColliders` in its input;
   pass it at the `createNearFieldBubbleController` call
   (`src/app/bootstrap/terrain_view_startup.ts:437`) and delete both bridge
   sides (`src/app/bootstrap/renderer_startup.ts:90`, bubble's
   `exposedTerrainColliders`).

5. **Hydrology — reasonable PoC.** `sampleInfiniteHydrology` is deterministic
   world-coordinate hash-based lakes/ponds/rivers; `HydrologySystem.sample`
   uses the finite grid inside `[0..worldCells]`, procedural outside; no wrap.
   Known wart: river direction is per-768 m basin, so channels can jump at
   basin borders (visual artifact, acceptable for now). The per-frame
   diagnostic (2 samples) is cheap. **The worker had the same finite-grid bug**
   (`installHydrologyTerrain` clamps to grid edge) — fixed for the new
   stream-roots path in the landed commit, deliberately NOT fixed for the
   startup build path to keep cached startup page geometry byte-stable.

6. **Vegetation/water shaders — spot-checked OK, two suspicious residual clamps.**
   Ring unclamp is scene-gated (`vegetationRingCenter(..., unbounded)`), water
   shaders share the `uWorldBounds.x > 0 && uWorldBounds.y > 0` finite-only
   discard convention across WebGPU full/perf + WebGL (locked by
   `water_shader_bounds.test.ts`). BUT verify in the browser:
   `src/grass/grass_gpu_ring.ts:142` clamps blade positions to
   `[0, worldCells]`, and `src/gpu/stone_scatter_compute.ts:155` clamps the
   scatter center to `[0, worldCells]`. If those code paths are live for
   infinite-islands, grass/stones will pin to the startup world edge at the
   (2048, 2048) spawn. Check what worldCells value each receives (it may be a
   ring-local size, which would be fine) before "fixing".

7. **Per-frame garbage (minor):** `terrain_frame_phase.ts` `infiniteIslandsScene()`
   allocates a `URLSearchParams` every frame — cache the boolean at module
   scope (location.search is static per page load).

## Already landed (this session)

Commit `Add off-thread buildStreamRoots worker path for streamed CLOD roots`:
- `src/clod_worker_protocol.ts`: `buildStreamRoots` request,
  `streamRootsBuilt` response, `rehydrateStandaloneNodes()`.
- `src/clod_worker_runtime.ts`: `installHydrologyTerrain(terrain, { boundedToStartupWorld })`
  — outside `[0..worldCells]` returns `baseSurfaceHeight` (parity with
  main-thread `HydrologySystem.terrainHeight`).
- `src/clod_worker.ts`: `handleBuildStreamRoots` — builds LOD0 pages with
  `{ finite: false }` bounds **in the worker**, swaps the bounded hydrology
  override for the request duration only, transfers buffers back. Errors if
  called before `build` completes. Streamed pages are NOT in the dig index
  (TODO noted: out-of-world digs only affect live chunks).
- `src/clod_worker_client.ts`: `buildStreamRoots(coords) → { nodes, buildMs }`
  with full error/reject bookkeeping.

Typecheck clean; protocol/client tests pass (15/15). The old synchronous
main-thread builder in `clod_streaming_roots.ts` is still present and unused
by the new path — removing it is the next step.

## Remaining work, in order

1. **Rewrite `src/terrain/streaming/clod_streaming_roots.ts` (async provider).**
   - Delete `scheduleBuild`/`defaultBuildScheduler`/`buildNode` (the sync path)
     and the `buildLod0PageSource` import.
   - New dep: `buildPages: ((coords) => Promise<{ nodes: readonly ClodPageNode[]; buildMs: number }>) | null`.
     `null` → planner-only (counters, no builds).
   - Dispatch at most one in-flight batch: when `pending.size === 0`, take up
     to `buildBudgetPagesPerFrame` uncached/unfailed required coords (nearest
     first — planner already sorts) and call `buildPages`. On resolve, for each
     node still wanted (`active && requiredNow.has(id) && !cached.has(id)`):
     push to `roots` + `allNodes`, cache, then ONE `onNodesBuilt(nodes)` +
     `onRootsChanged()` per batch. On reject: mark batch coords failed,
     `console.warn` once. Accumulate applied count + worker `buildMs` and
     report them on the next `update()` (existing counter pattern).
   - Change `DEFAULT_BUILD_BUDGET_PAGES_PER_FRAME` 0 → 1 (safe now: builds are
     off-thread; main-thread cost is one geometry upload + `patchNodes` per
     page).
   - Add to stats: `pendingPages`, `buildBudget` (needed for the acceptance
     gate below).
   - Rewrite `clod_streaming_roots.test.ts` with a fake async `buildPages`
     (deferred promises): budget batch size, apply-on-resolve, stale discard
     after center moves, eviction removes from roots/allNodes, planner-only
     when `buildPages: null`, failure marks failed.

2. **Wire it (`src/app/bootstrap/ui/frame_loop_startup.ts:236`).**
   - `buildPages: async (coords) => await input.clodWorker.buildStreamRoots(coords)`
     (clodWorker is on `ctx.input`; terrain_edit_startup already uses it).
   - Optional `liveClodRootRadius` query param (default `state.bubbleRadius`).
   - Mirror the two new counters: `live_clod_stream_pending_pages`,
     `live_clod_stream_build_budget`.

3. **Bubble rim ownership fix (`near_field_bubble_controller.ts`).**
   In the view loop, change the "owned" distance check from
   `< input.bubbleRadius` to `<= input.bubbleRadius + halfDiag` (same
   `pageSize * Math.SQRT2 * 0.5` margin as `requiredStreamingPageCoords`), so
   every page with a ready chunk group hides its page-view mesh. Without this,
   worker-built streamed pages z-fight with raw chunks in the rim band.

4. **Sticky guard replacement** (finding 2 above): `liveBubblePinned` field;
   guard the two preset sites; delete `preserveEnabledBubble`; fix
   `clod_state.test.ts`.

5. **Collider DI** (finding 4): pass `terrainColliders` into the bubble
   controller at `terrain_view_startup.ts:437`; delete both global-bridge
   sides.

6. **Thresholds (`tools/infinite_acceptance/thresholds.ts` + its two tests).**
   - Add `live_clod_stream_pending_pages`, `live_clod_stream_build_budget` to
     `REQUIRED_COUNTERS`.
   - Delete the vacuous `>= 0` rules (`_cached_pages`, `_built_this_frame`,
     `_evictions`, `live_bubble_collider_removals`). Keep the keys in
     `REQUIRED_COUNTERS` (presence still enforced).
   - Extend `ThresholdRule.pass` to `(value, values) => boolean` and add the
     real gate: `live_clod_stream_cached_pages` passes iff
     `value > 0 || values["live_clod_stream_build_budget"] === 0 || values["live_clod_stream_required_pages"] === 0`.
     With the new default budget 1 and all five acceptance scenes positioned
     outside the startup world, this genuinely requires worker-built pages.
   - Update `thresholds.test.ts` (it currently asserts cached=0 passes) and
     `thresholds_validation.test.ts` fixture values.
   - Do NOT relax any existing gate.

7. **Frame-phase scene-check caching** (finding 7): one-line lazy module cache.

8. **Follow-up (separate pass, plan only):** coarse-LOD (2/3) worker-built
   pages for the 200–2048 m annulus; vegetation `lod0Nodes` are startup-frozen
   (streamed pages grow no grass/trees — GPU rings cover near field, far
   vegetation is out of scope); verify finding 6's grass/stone clamps in the
   browser at the outside spawn.

## How to test

```powershell
# from repo root
rtk npm --prefix tools/clod-poc run typecheck          # tsc — rtk OK
npm --prefix tools/clod-poc test                        # vitest — NEVER rtk
npm --prefix tools/clod-poc run build                   # vite — NEVER rtk

# targeted while iterating (much faster than the full suite):
cd tools/clod-poc
npx vitest run src/terrain/streaming/clod_streaming_roots.test.ts src/app/state/clod_state.test.ts src/terrain/near_field/near_field_bubble_controller.test.ts src/clod_worker_protocol.test.ts src/clod_worker_client.test.ts tools/infinite_acceptance/thresholds.test.ts tools/infinite_acceptance/thresholds_validation.test.ts

# acceptance (needs the dev server on 5173, native Windows shell, real GPU):
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1   # default port 5173
npm --prefix tools/clod-poc run accept:infinite-islands
```

Manual QA (dev server on 5180 with `--port 5180 --strictPort`):

- Baseline: `?scene=infinite-islands&world=16&clodPerf=1&webgpuSelection=1`
- Outside spawn (the case that matters): add `&x=2048&z=2048&yaw=2.65`
  — expect live chunks under the player, worker-built white LOD0 pages
  filling the bubble ring as you fly outward, no rim flicker (fix 3), no
  fall-through, and `live_clod_stream_cached_pages > 0` in
  `window.__drusnielClod.stats.counters`.
- Kill switches: `&liveBubble=0` (acceptance must FAIL on live bubble gates),
  `&liveClodRootBudget=1` (now = default), GUI "enable (raw chunks)" toggle
  must actually disable the bubble after fix 4.
- Frame budget: acceptance gate stays `frame_ms_p95 <= 8`. Watch
  `live_clod_stream_build_ms` — it is worker time, informational; the
  main-thread symptom to watch is `selectionUpdateMs` / `clodApplyMs` spikes
  when pages apply.

## Hard constraints (unchanged)

No sub-agents; no broad discovery; no Rust/Bevy changes; no renderer
replacement; never weaken acceptance gates; no heavy work on the frame path
(main thread IS the frame path — `setTimeout(0)` does not count as async);
far shell stays visual-only; deterministic world-coordinate seeding only;
no new global mutable bridges.
