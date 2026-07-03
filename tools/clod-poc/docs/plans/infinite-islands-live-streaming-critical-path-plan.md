# Infinite Islands — Live Streaming Critical Path Plan

Status: PLAN ONLY (no runtime code changed in this pass).
Scope: `tools/clod-poc` only. Scene: `scene=infinite-islands` (`phase0` key `infinite_islands`).

Goal: make `infinite-islands` a real moving gameplay prototype — the player walks/fly-cams
forward indefinitely, live playable terrain generates around them, the far shell stays a
distant visual ring, and biomes/water/vegetation vary along the route, with the perf
critical path measured (not guessed).

---

## 1. Current architecture summary

Ownership model (inner to outer), as resolved by
`src/streaming/streaming_ownership.ts` from `config/infinite_streaming_phase0.yaml`:

| Ring | Owner | Source today | Radius (config) |
|---|---|---|---|
| Live playable | Raw Surface Nets chunk groups from `near_field_bubble_controller.ts` (GPU mesher, CPU fallback) | Built on demand per page; can build outside finite world via `{ finite: false }` bounds | `streaming.live_radius_m: 200` (but state default uses `near_field.radius_chunks * chunk_size` = 6 × 16 = **96 m**, and `bubble: false`) |
| Visual CLOD | `ClodSelectionController` over pages from `clodWorker.buildWorld(WORLD, WORLD, …)` in `world_build_startup.ts` | **Finite startup build.** `world=16` pages × 64 m/page = **1024 m total** (≈512 m from center) | `streaming.clod_radius_m: 2048` — config claims 2048 m, reality is ≤512 m |
| Far shell | `InfiniteFarShell` (recenters with camera; heights from far-summary tiles sampling `ProceduralWorldSource` analytically) | Infinite-capable; legacy far shell controller disabled when active | inner = page-aligned `clod_radius_m` = 2048 m, outer = `target_future_visible_m` = 8192 m |
| Optional far height sources | far-summary integration / NAADF | far-summary active for `infinite-islands` (not a NAADF scene) | n/a |

Diagnostics / acceptance:

- `src/phase0/long_view_frame_diagnostics.ts` publishes counters into
  `window.__drusnielClod.stats.counters` and `window.__drusnielPhase0Report`.
- **Critical caveat:** the streaming counters come from `TerrainOwnershipRuntime` /
  `LiveVoxelChunkStreamer` (`src/stream/`), which is a *simulation*: `update()` marks every
  required chunk as instantly loaded (`live_voxel_chunk_streamer.ts:57`). The coverage
  oracle then reports `missing_live_chunks_in_required_radius == 0` regardless of what the
  scene actually contains. Acceptance verifies plan geometry, not real meshes.
- `npm run accept:infinite-islands` (`tools/infinite-islands-acceptance.ts`) drives 5
  Playwright captures (1 moving scripted "walk" + 4 frozen cams) and gates on
  `tools/infinite_acceptance/thresholds.ts` (p95 ≤ 8 ms, hole/overlap counters == 0, etc.).

Movement today is the phase0 *scripted camera* (`speed_mps: 24`, 160 s, turning), not
player mode. `terrain_frame_phase.ts` uses `player.position` as bubble center only in
playing mode, else `controls.target`.

## 2. Root cause hypothesis

Ranked by confidence, with evidence:

1. **The live bubble is off by default.** `clod_state.ts:85` sets `bubble: false` for all
   scenes; nothing in the bootstrap turns it on for `infinite-islands`. So no live raw
   chunks are ever built and the only playable surface is the finite startup CLOD world.
2. **Bubble radius ≠ ownership radius.** `bubbleRadius` default is
   `near_field.radius_chunks × chunk_size` = 96 m, not `streaming.live_radius_m` = 200 m.
   Even with the bubble enabled, live coverage is half the claimed ownership ring.
3. **The CLOD ring is a fiction beyond ~512 m.** `world_build_startup.ts` builds a one-shot
   `16×16`-page world (1024 m across). `clod_radius_m: 2048` in ownership math and far
   shell inner (2048 m) assume CLOD coverage that does not exist. Once the camera/player
   leaves the startup world (~512 m from center at 24 m/s ≈ **21 seconds in**), the ground
   between the live bubble edge and the far shell inner ring (2048 m) is *empty*: the next
   visible surface is the far shell. This is exactly the reported symptom.
4. **Acceptance can't see the problem.** Counters that should catch it
   (`missing_live_chunks_in_required_radius`, `missing_clod_pages_in_required_radius`,
   gap/overlap cells) are computed from the auto-loading simulator, not from actual scene
   content, so they pass while the world visibly runs out.
5. **Prop/vegetation ring clamps to the startup world.** `terrain_frame_phase.ts:78-82`
   clamps `ringCenter` to `[2, worldCells-2]` = `[2, 1022]`. Moving past the world edge
   pins grass/tree/stone rings at the boundary.
6. **Water/hydrology is finite.** `HydrologySystem.build(…, worldCells, …)` builds a
   1024-m grid at startup and installs a global terrain-surface override
   (`setTerrainSurfaceOverride((x,z) => hydrologySystem.terrainHeight(x,z))`). Behaviour of
   that override outside the grid must be verified — if it clamps, live chunks built
   outside the world would mesh with wrong heights (must verify in Phase B before trusting
   live-chunk heights outside the startup world).
7. Biome texture streaming (`biome_texture_streaming_manager`) already follows the world
   camera and samples `worldSource.sampleBiome(x,z)` in world coordinates — likely OK, but
   window-swap churn while moving must be measured (counter exists:
   `terrainTextureWindowSwaps`).

## 3. Desired runtime behavior

- In player mode (and scripted-walk acceptance), live raw chunks generate around the moving
  center; the bubble center is `player.position` (already the case when playing).
- Live radius comes from `phase0.streaming.live_radius_m` (200 m), overridable by query.
- Visual CLOD coverage extends to `phase0.streaming.clod_radius_m` around the *current*
  center — short-term via an honest reduced radius (see Phase C decision), long-term via
  streamed CLOD pages.
- Far shell inner stays at/beyond the real CLOD outer edge and is never the playable or
  next-visible mid-field surface. Never collidable.
- Terrain materials/biomes, water, vegetation, stones, understory all sample deterministic
  world coordinates (seed + x/z); rings follow the player without clamping to startup
  `worldCells`.
- Missing chunks/pages are allowed only as temporary *hidden* fallback (CLOD page or far
  shell shows through underneath); never visible holes, never a fall-through.
- Ownership priority (live > CLOD > far shell) holds at every frame; counters report the
  *actual* scene state, not a simulation.

## 4. Minimal implementation phases

### Phase A — infinite-islands enables the live bubble by default

Files: `src/app/state/clod_state.ts`, `src/app/bootstrap/clod_poc_bootstrap.ts` (or
`post_renderer_startup.ts` where state is created), `src/app/bootstrap/query_context.ts`,
`src/app/frame_loop/terrain_frame_phase.ts`, `src/ui/gui/terrain_material_gui.ts` (GUI
reflects state; no logic change expected).

- Add to `createClodSliceState` input: optional `liveBubbleDefault?: { enabled: boolean; radiusM: number }`.
  Bootstrap passes it only when `queryScene === "infinite-islands"` (scene-specific; other
  scenes unchanged), with `radiusM = streamingOwnership.liveRadiusM`.
- Query overrides (parsed in `query_context.ts`, YAML stays the source of defaults):
  - `liveBubble=0|1` — force bubble off/on for any scene.
  - `liveBubbleRadius=<m>` — override radius in meters.
- Guardrail: warn and clamp if `liveBubbleRadius > streaming.clod_radius_m / 2`.
- Build throttling already exists (`chunkGroupBuildBudget`, default 1 page/frame from
  `runtime_config.ts`). Keep default 1; make it query-overridable (`liveBubbleBudget=<n>`)
  for the low-budget acceptance case.
- Verify: page load with `?scene=infinite-islands` shows red-tinted (tint on) raw chunk
  groups around the start point; `liveBubble=0` restores today's behavior. Unit test:
  state defaults for the scene.

### Phase B — robust live generation while moving

Files: `src/terrain/near_field/near_field_bubble_controller.ts`,
`src/app/frame_loop/terrain_frame_phase.ts`, `src/terrain/terrain_collider.ts`,
`src/player_controller.ts` (read first; smallest change wins),
`src/phase0/long_view_frame_diagnostics.ts` (publish counters).

- **Counters (real, from the controller — not the simulator):** extend
  `NearFieldBubbleStats` and publish as:
  `live_bubble_required_pages`, `live_bubble_ready_pages`, `live_bubble_building_pages`,
  `live_bubble_failed_pages`, `live_bubble_built_this_frame`, `live_bubble_ms`,
  `live_bubble_evictions`.
- **Prioritized build order:** `requiredStreamingPageCoords` already sorts
  nearest-first; additionally bias by movement direction (player velocity) so pages ahead
  of the player build before pages behind. Keep it a sort-key tweak, not a scheduler.
- **Collider readiness / no fall-through:**
  1. Inspect how `TerrainColliderSet` gets meshes today (startup CLOD pages vs live
     chunks). Register ready bubble chunk groups with the collider set; unregister on
     eviction.
  2. Fallback ladder while a page is building: (a) keep the old collider/mesh if this is a
     rebuild; (b) use the CLOD page mesh collision if one exists at that coord; (c) if
     neither exists (outside startup world), use analytic
     `worldSource.sampleHeight(x,z)` as a height floor for the player — deterministic and
     always available. Never let the player integrate gravity through unloaded ground.
- **No sync spikes:** GPU mesher path is already async per chunk; the CPU fallback
  (`meshChunk`) is synchronous — cap CPU-fallback chunks per frame (share the same budget)
  instead of meshing a whole failed page in one frame.
- Eviction already exists (distance × 2.5 + LRU cap 64); count evictions into
  `live_bubble_evictions`.

### Phase C — visual CLOD streaming decision

Honest assessment of the three options:

1. **Short-term (choose this first):** keep the finite startup CLOD build. Reconcile the
   config lie instead: for `infinite-islands`, compute the *effective* CLOD radius from
   what is actually built and (a) raise the live bubble radius override for this scene if
   desired, (b) let the far shell inner ring follow the effective radius so there is no
   empty mid-field ring — far shell inner must equal real CLOD coverage edge (page-aligned
   ~512 m for world=16), not the aspirational 2048 m. Far shell remains visual-only; the
   playable surface is the live bubble. This is achievable in days, unblocks gameplay
   feel, and keeps every hard constraint.
2. **Better (next):** stream CLOD pages around the moving player using the existing
   `clodWorker` page-build path + cache (`initClodCacheContext`): a small async queue that
   requests LOD1-3 pages for the annulus `[live_radius, clod_radius]` around the current
   center, applies at most N page-swaps per frame, and evicts behind the player. Reuses
   worker meshing and the page material path; the selection controller needs to accept a
   mutable node set. This is the real fix for "player never reaches the far shell" at
   2048 m scale; estimate: the largest single work item in this plan.
3. **Best later:** full stale/fallback ownership with budgeted apply and prefetch by
   velocity (`preload_seconds` already exists in config). Only after (2) is stable.

Plan commits to **1 now, 2 as a separate follow-up phase** after Phases A-B-D-E land and
acceptance is green. Do not start (2) in the same pass as (1).

### Phase D — biomes, water, vegetation while moving

Files (inspect first, change minimally): `src/app/frame_loop/terrain_frame_phase.ts`
(ring clamp), `src/runtime/vegetation/{vegetation,grass,tree,stone,understory}_startup.ts`
(ring center plumbing + any `worldCells` clamps), `src/water/hydrologySystem.ts` /
`src/water/waterField.ts` / `src/runtime/water_weather/water_startup.ts` (finite-grid
audit), `src/textures/biome_texture_streaming_manager.ts` (verify only).

- **Ring clamp:** remove the `[2, worldCells-2]` clamp for `infinite-islands` (make the
  clamp conditional on `worldSource.metadata.bounds` being finite, or scene flag). Grass /
  tree / stone / understory rings then follow `grassCenter` = player position.
- **Deterministic scatter:** verify each vegetation ring seeds placement from world-space
  cell coordinates (the GPU ring/clipmap path is already world-space per the grass/tree
  design). Anything seeded from page-local indices or startup node lists must be switched
  to world-cell hashing. No `Math.random()` on the placement path.
- **Biomes:** `worldSource.sampleBiome(x,z)` is world-coordinate and infinite-capable;
  biome texture streaming already recenters on the camera — add its swap count to the
  acceptance capture and verify swaps happen while moving (expect ≥1 across 1 km+ routes).
- **Water:** two-step, mirroring the memory note that carving must reach whatever samples
  heights:
  1. Verify what `hydrologySystem.terrainHeight(x,z)` returns outside its grid. If it
     clamps, restrict the surface override to the grid bounds and fall back to
     `baseSurfaceHeight` outside, so live chunks outside the startup world are correct
     (consistent with far shell heights from `worldSource`).
  2. Rivers/lakes beyond the startup world are OUT of scope for this pass; ocean/coast via
     `worldSource.oceanMask` (island rim at `worldRadiusM: 8192`, sea level 18) is already
     infinite and gives the required "water visible on route" without new systems. Note in
     acceptance which water source satisfied the gate.

### Phase E — performance critical path

Measure with the existing perf harness (CLAUDE.md deterministic process; dev server NOT
under rtk) plus the acceptance p95 gates. Expected hot paths and their measurement points:

| Hot path | Instrument | Budget (acceptance mode) |
|---|---|---|
| Live chunk meshing (GPU + CPU fallback) | `live_bubble_ms`, `live_bubble_built_this_frame` | ≤ 1 page-group start/frame; `live_bubble_ms` p95 ≤ 2 ms; CPU-fallback chunks ≤ budget |
| Geometry create/dispose churn | count creates+disposes per frame in bubble controller | no unbounded growth; evictions bounded by LRU cap |
| Material churn | existing `materialChurnDiagnostics` | 0 new materials/frame at steady state (bubble reuses per-chunk materials — check; pool if it allocates per chunk) |
| Collider updates | new `collider_update_ms` counter | budgeted, nearest-first; ≤ 1 ms/frame p95 |
| Vegetation rebuilds | existing grass/tree dispatch counters (`gpu_grass_dispatch_ms`, `gpu_tree_dispatch_ms`) | no full-ring rebuild on recenters; deltas only |
| Water/hydrology updates | `farSum*Ms` subphases already split | no per-frame hydrology work outside grid |
| Far summary / far shell | `farSumTilesMs`, `farSumShellMs`, `far_shell_last_rebuild_ms` | tile builds budgeted (existing `longViewRebuildBudget`) |
| Texture window swaps | `terrainTextureWindowSwaps` + `farSumBiomeStreamMs` | swap is async-amortized; no > 8 ms spike frame attributable to swap |
| Debug readbacks | assert readback mode off in acceptance URLs | 0 readbacks in gameplay/acceptance |

Frame budget: keep the existing acceptance gate `frame_ms_p95 <= 8` and add
`frame_ms_p99` reporting (already captured) with a soft gate ≤ 16 ms. Any change claiming
a perf win must show before/after `perf-runs/<run>/summary.json` per repo policy.

## 5. Acceptance tests

Base: `npm run accept:infinite-islands` (keep all existing scenes and gates; add, don't
relax). New movement scene specs in `tools/infinite-islands-acceptance.ts` (or a sibling
`infinite-islands-walk-acceptance.ts` if file size demands a split), driven by query
params so they stay deterministic (`seed=1`, scripted camera or query-spawned player with
scripted input):

| Scene | Setup | Notes |
|---|---|---|
| `walk-1km` | player/scripted, 24 m/s until 1 km from spawn | leaves startup world (~512 m) — the key regression case |
| `walk-4km` | same, 4 km | long-route variety + memory/leak watch |
| `walk-biome-transition` | route chosen (seed-fixed) to cross ≥ 2 biome regions | asserts biome/material change counters |
| `walk-river-crossing` | route crossing a carved river inside the startup world (or coast crossing outside) | water visible + no fall-through in water |
| `walk-fast-turn` | 90°/s turn while moving | eviction/rebuild churn behind the player |
| `walk-high-speed` | 2× speed (48 m/s) | build budget starvation behavior: hidden fallback, no holes |
| `walk-low-build-budget` | `liveBubbleBudget=1` (or lower via query) + high speed | worst case: fallback ladder must hold |

Each capture records: screenshot, stats JSON, phase0 report JSON, player/camera position,
the seven `live_bubble_*` counters, `camera_to_far_shell_center_m` and far-shell
inner/outer, missing-terrain counters, `frame_ms_p95`/`p99`, page errors, image sanity.

Pass gates (added to `thresholds.ts`; existing rules stay):

- No visible terrain holes: image sanity + `horizon_hole_ratio == 0` and the *real*
  (non-simulated) missing counters == 0 after warmup.
- Far shell never playable: player Y must track live-chunk/analytic ground within
  tolerance, and distance from player to far shell inner ring > 0 at all samples.
- `live_bubble_ready_pages / live_bubble_required_pages ≥ 0.95` after warmup;
  `live_bubble_failed_pages == 0`.
- Priority ownership counters == 0 (overlaps/unowned), now computed from real scene state.
- `frame_ms_p95 <= 8` (unchanged).
- No fall-through: min player Y over run > (sampled ground − player height − epsilon).
- ≥ N biome/material observations on long walks (`terrainTextureActiveBiomes` history or
  biome samples along route; N=2 for walk-1km, N=3 for walk-4km).
- ≥ 1 water/coast area on route (`oceanMask > 0.5` sampled along route, or river tiles).
- **Fix the counter lie:** wire `missing_live_chunks_in_required_radius` (and page
  equivalent) to real bubble/CLOD state for infinite scenes, or add parallel
  `real_missing_*` counters and gate on those. Do not delete the simulated ones (they
  still validate plan geometry); gates move to the real ones — stricter, not weaker.

## 6. Files to change later (grouped; no changes in this pass)

- **Phase A:** `src/app/state/clod_state.ts`, `src/app/bootstrap/query_context.ts`,
  `src/app/bootstrap/clod_poc_bootstrap.ts` (or `post_renderer_startup.ts`),
  `src/ui/gui/terrain_material_gui.ts` (label only if needed), new unit test beside
  `clod_state`.
- **Phase B:** `src/terrain/near_field/near_field_bubble_controller.ts` (+ its test),
  `src/app/frame_loop/terrain_frame_phase.ts`, `src/terrain/terrain_collider.ts`,
  `src/player_controller.ts`, `src/phase0/long_view_frame_diagnostics.ts`.
- **Phase C (short-term part):** `src/streaming/streaming_ownership.ts` (effective-radius
  input), `src/app/bootstrap/clod_poc_bootstrap.ts` (far shell inner from effective CLOD
  edge), `config/infinite_streaming_phase0.yaml` (document effective values; no threshold
  relaxation).
- **Phase D:** `src/app/frame_loop/terrain_frame_phase.ts` (ring clamp),
  `src/runtime/vegetation/*_startup.ts` (only those found clamping),
  `src/water/hydrologySystem.ts` or `src/terrain/terrain.ts` (surface-override bounds),
  verification-only: `src/textures/biome_texture_streaming_manager.ts`,
  `src/world_source/biome_region_field.ts`.
- **Phase E / acceptance:** `tools/infinite-islands-acceptance.ts`,
  `tools/infinite_acceptance/thresholds.ts` (+ report), `src/stream/ownership_coverage_oracle.ts`
  (real-state inputs), possibly `tools/infinite_acceptance/routes.ts` (new, route specs).

## 7. Risks and fallback

| Risk | Fallback |
|---|---|
| CPU chunk-meshing spikes when GPU mesher fails | Per-frame CPU-fallback chunk cap sharing the build budget; page stays hidden (CLOD/analytic floor beneath) until complete |
| GPU mesher async readiness races (page evicted mid-build) | Existing identity check (`chunkGroups.get(key) !== entry`) already discards stale results; extend same pattern to collider registration |
| Collider readiness race → fall-through | Analytic `worldSource.sampleHeight` floor as last-resort ground for the player; counter + acceptance gate on min-Y |
| Hydrology finite-world assumptions corrupt outside heights | Bound the surface override to the hydrology grid; outside uses base field (verify parity with far-summary heights at the seam) |
| Vegetation ring clamping or non-deterministic scatter | Clamp removal behind scene/bounds check; keep old behavior for finite scenes; deterministic world-cell hashing only |
| Far shell z-fighting/overlap with live/CLOD ground | Keep `heightBiasMeters`/`nearBlendMeters`; far shell inner ≥ real coverage edge (Phase C.1) removes the overlap zone; visual check in frozen cams |
| CLOD page streaming scope creep | Hard-gated to a separate follow-up (Phase C.2) with its own plan; this pass ships with reduced-but-honest far shell inner |
| Acceptance runtime cost (7 new movement scenes) | Walk scenes reuse one browser; 4 km scene can run at reduced capture frequency; keep 1 km scene as the PR-blocking gate, 4 km as scheduled/full runs |

## 8. Final implementation order

1. This plan doc (done).
2. Phase A: scene-specific live-bubble defaults + `liveBubble` / `liveBubbleRadius` /
   `liveBubbleBudget` query overrides. Verify: manual URL + state unit test.
3. Phase B counters (`live_bubble_*`) published from real controller state; wire into
   phase0 report. Verify: counters visible in stats JSON.
4. Acceptance movement tests `walk-1km`, `walk-fast-turn`, `walk-low-build-budget` with
   real-state gates (expected to FAIL initially on fall-through/holes — that is the
   baseline evidence).
5. Phase B collider/readiness fallback ladder until `walk-1km` passes.
6. Phase C.1 (honest far-shell inner) + Phase D (ring clamp, hydrology bounds, biome/water
   gates) until `walk-biome-transition`, `walk-river-crossing`, `walk-4km`,
   `walk-high-speed` pass.
7. Phase E profiling passes (typecheck/test/build + perf harness A/B per CLAUDE.md);
   optimize only measured hot paths; keep `frame_ms_p95 <= 8`.
8. Only then: Phase C.2 streamed CLOD pages around the moving player (separate plan,
   reuses `clodWorker` + cache path).

Validation commands for every implementation pass (from `tools/clod-poc`):

```powershell
rtk npm --prefix tools/clod-poc run typecheck   # tsc only — rtk OK
npm --prefix tools/clod-poc test                # vitest — NO rtk
npm --prefix tools/clod-poc run build           # vite build — NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # NO rtk
npm run accept:infinite-islands                 # from tools/clod-poc, dev server running
```
