# Unified Streaming — CLOD pages, far shell, and heightfield tiles as one system

Created 2026-07-16. Status: PLANNED (no code landed from this doc yet).

Related documents:

- `continent-plan-overview-2026-07-12.md` and `continent-fixes-and-next-steps-2026-07-14.md`
  (Part E items 1–2 are the roadmap slots this plan fills).
- `docs/performance/near-field-streaming-items-2026-07-16.md` — the measured session that
  motivates the coordination work (farSummaryMs 4.7 ms p95, root refinement backlog, movement
  p99 15.7 ms). Its "What to look at next" ranking is folded into Phase 0/4 here.
- `docs/far-summary-clipmaps.md` — far summary clipmap architecture.
- `infinite-islands-stutter-recovery.md` / `-handover.md` — prior stutter work; sliced rebuilds
  and budget discipline established there are assumed, not re-litigated.

## Goal

One coherent streaming stack for continuous play across a large map. Today the near voxel
bubble, streamed CLOD root pages, heightfield tiles, far summary tiles, and the far
shell/clipmap each stream around their own idea of the player with their own prediction,
budget, and invalidation. The target state:

1. **One stream cursor** — a single per-frame center + velocity + predicted-center contract
   consumed by every streaming system.
2. **One height authority with revisions** — heightfield tiles (where authoritative), edits,
   and stamps produce region revisions; every derived cache (far summary tiles, far shell,
   clipmap, vegetation masks) can tell when it baked stale data and re-bake by bounds.
3. **One streaming budget** — a frame-level governor that arbitrates worker dispatch, GPU
   mesher lanes, and main-thread apply/slice work across systems instead of N independent
   2 ms budgets stacking on the same frame.
4. **One seam** — the near↔far handoff follows the *actual* CLOD ready frontier instead of a
   fixed radius, so a lagging streamer widens the far band rather than leaving pops or holes.

Non-goals: no Rust/Bevy changes (keep new contracts port-shaped per
`docs/architecture/bevy-world-source-port.md`); no acceptance-gate weakening; no redo of the
near-field bubble micro-items already measured and closed in the 2026-07-16 session doc.

## Current architecture (as read on 2026-07-16)

Radial ownership bands (infinite-islands defaults, `config/infinite_streaming_phase0.yaml`):

```
0 ──── 200 m ─────── 768 m ───────────── 2048 m ─────────── 8192 m ──── 16384 m
  live voxel   CLOD refinement      CLOD safety ring     far shell/clipmap   far summary
  bubble       (worker pages)       (coarse pages)       (summary heights)   horizon ring
```

- Heightfield tiles: 256 m canonical tiles, `radius_m: 1024`, worker-built, IndexedDB
  persistence, fixed 7×7 GPU atlas. Authoritative in continent mode (and infinite islands
  when enabled); **`config/heightfield_tiles.yaml` ships `enabled: false`**, so plain
  infinite-islands runs without them and samples procedural directly.
- Far summary rings (`src/far-summary/config.ts`): near_far 1536–4096 m @ 32 m cells,
  mid_far 4096–8192 m @ 64 m, horizon 8192–16384 m @ 128 m.

Per-frame update order (`src/app/clod_frame_loop.ts`):

1. `updateSelection` → `updateSelectionWithStreaming` (`frame_loop_startup.ts:491`):
   computes **its own center** via `streamingWorldCenter`, updates the heightfield tile
   runtime (center only — no velocity, no deltaSeconds), then the streamed CLOD root
   controller (hysteresis: only when moved ≥ ~a page or work pending).
2. `runTerrainFramePhase` (`terrain_frame_phase.ts`): computes `canonicalWorldCenter`,
   updates the near-field bubble, returns `worldCenter` for everyone downstream.
3. `farSummaryMs` block: far summary integration (own `StreamCenter` velocity EMA +
   4 s preload), NAADF, far shell refresh gating (≤ every 120 frames on
   `cache.hasNewCommitsSince`), `infiniteFarShell.update` (recenter on `rebaseSnapMeters`
   snap → sliced full-ring CPU resample @ 2 ms/frame), shadow proxy, biome texture
   streaming, far clipmap controller, sun-light runtime.

Height flow: `CanonicalWorldSource.sampleHeight` → `surfaceHeight` → the global surface
override installed by the heightfield tile runtime (`setTerrainSurfaceOverride`) → tile
sampler → fallback chain (resident tile → startup raster → canonical fallback sampler that
recomputes hydrology carve + stamps per sample). Far summary tiles bake from this chain;
the far shell and the far clipmap both sample the far summary provider
(`__drusnielFarSummary`); GPU shell/water materials can displace from the far-summary GPU
atlas instead of CPU heights.

### What is already coherent — do not rebuild

- The **canonical center concept** exists and is asserted: `canonicalWorldCenter`,
  `world_center_debug.ts` counters, and acceptance gates that centers track the camera.
- The **ownership radii contract** (`resolveStreamingOwnership`) throws on gap/overlap, and
  the **coverage oracle** (`src/stream/ownership_coverage_oracle.ts`) already counts
  live/clod/far gap holes, overlap cells, priority-unowned cells, and horizon hole ratio.
- **Far-owner exclusivity** is enforced (`assertLegacyFarShellExclusive`), and replace-mode
  hands the far band to the GPU clipmap cleanly.
- The **edit invalidation bridge** exists for feature stamps: save runtime →
  `subscribeSaveRuntimeFeatureStamps` → heightfield tiles + streamed roots
  `invalidateBounds`, and `registerSaveInvalidationTarget` → far summary `markStale(bounds)`
  + `infiniteFarShell.requestHeightRefresh()`.
- Every layer has a **fallback chain with counters**, and continent acceptance gates tile
  drain with real thresholds (`accept:continent-tiles`).

The gaps below are therefore *coordination* gaps, not missing subsystems.

## Coherence gaps (evidence-linked)

- **G1 — Two center implementations.** `streamingWorldCenter`
  (`frame_loop_startup.ts:130`) duplicates `canonicalWorldCenter`
  (`terrain_frame_phase.ts:221`) and is kept in sync only by a "must match" comment. The
  tile runtime and root streamer also read their center *before* the terrain phase computes
  the canonical one — same math today, two code paths to drift.
- **G2 — Three prediction implementations, none shared.** Far summary: velocity EMA +
  `preloadSeconds: 4`. Heightfield tile cache: internal velocity from center deltas with
  `prediction_seconds: 4` — but the caller passes neither `velocityX/Z` nor `deltaSeconds`
  (`frame_loop_startup.ts:494`), so the cache divides by an assumed 60 fps frame time
  (`heightfield_tile_cache.ts:258-271`); at 30 fps it under-predicts by 2×. Root streamer
  and bubble: no prediction (bubble prefetch measured flat and reverted — the *bubble*
  radius pre-covers; the root refinement ring does not, see G6).
- **G3 — Independent budgets stack on the same frame.** Far summary build 2 ms + shell
  slice 2 ms + shadow proxy 2 ms + tile batches + root build/apply + bubble dispatch/apply
  are all separately budgeted with no shared headroom estimate. Measured on the walk route
  (n=522): `farSummaryMs` p95 **4.7 ms** is the largest phase bucket, movement p99
  **15.7 ms** vs median 5.35 ms. The root streamer and the bubble may also contend for the
  same 8 `GpuChunkMesher` lanes (session doc, item #2 — unproven, needs the Phase 0
  counter).
- **G4 — Mutual readiness gating between tiles and CLOD.** In continent mode, streamed
  root builds wait on tile residency (`canBuildPage` → `heightfieldTilesReadyForPage`);
  tile build p95 is ~300 ms, which serializes into page latency at the frontier. In
  non-authoritative worlds the arrow reverses: tile builds are only allowed when the CLOD
  streamer is fully drained (`heightfieldTileBuildAllowed` — pending, inflight, apply queue
  and safety all zero), a condition that can stay false through sustained movement →
  tile starvation exactly when prefetch matters most.
- **G5 — No tile→summary invalidation bridge.** A far summary tile built before its
  underlying heightfield tiles were resident bakes fallback heights and is never marked
  stale when the canonical tile lands; the only downstream signal is the shell's
  any-commit refresh (≤ every 120 frames), which re-*samples* but only helps if the sampler
  now returns different heights AND the summary tile itself was rebuilt. Heights agree
  today only because the canonical fallback sampler recomputes the same carve+stamp math —
  an invariant that is asserted nowhere (no per-sample parity probe between the
  tile-resident and fallback paths).
- **G6 — Fixed 768 m seam regardless of actual readiness.** During movement the root
  streamer runs at ~39% coverage (`required 183 / ready 71`, refinement pending max 120),
  yet the far owner's inner edge stays at the configured 768 m. The lagging annulus renders
  whatever the previous cut provides (coarser safety-ring pages), and refined pages pop in
  later. Nothing adapts the far band inward, and no counter reports the ready-frontier
  radius vs the configured seam.
- **G7 — Persistence only for heightfield tiles.** Far summary tiles and CLOD pages
  rebuild from scratch every session and every revisit; continuous play over a large map
  recomputes the same terrain repeatedly.
- **G8 — Independent eviction/memory policies.** Bubble cached pages (64), root
  `maxCachedPages`, tile `max_resident_tiles: 96` + distance multiplier, far summary
  stale/cooling grace — each sized alone, no shared byte budget or pressure signal.
- **G9 — Far shell recenter cost is a full-ring resample.** Every `rebaseSnapMeters` snap
  re-samples *all* shell vertices (sliced at 2 ms/frame). Suspected contributor to the
  4.7 ms `farSummaryMs` p95, but the composite bucket hides it — `farSum*Ms` sub-buckets
  exist and must be read before touching anything (session doc, item #1).
- **G10 — World-mode split brain.** Continent runs tiles-as-authority; default infinite
  islands runs pure procedural with tiles off. Two tall paths through the same code, twice
  the test surface, and features proven on one mode (tile atlas, hydrology carve) silently
  absent on the other.

## Design — four contracts

### C1. StreamCursor (single center + prediction)

One module (proposed `src/stream/stream_cursor.ts`) computes per frame:

```ts
interface StreamCursor {
  frameId: number;
  center: { x: number; z: number };        // canonicalWorldCenter, unchanged semantics
  velocityMps: { x: number; z: number };   // EMA over real deltaSeconds (far-summary style)
  predicted(aheadSeconds: number): { x: number; z: number };
  deltaSeconds: number;
}
```

- Computed once at the top of the frame (before `updateSelection`), owned by the frame
  loop, passed to: tile runtime (as `velocityX/Z` + `deltaSeconds` — fixes the 60 fps
  assumption), root streamer, bubble, far summary (replaces its internal
  `updateStreamCenter`), far shell, shadow proxy, biome streaming.
- `streamingWorldCenter` is deleted; `canonicalWorldCenter` moves into (or is re-exported
  from) the cursor module so there is exactly one implementation.
- Per-system *lookahead* stays per-system config (tiles 4 s, far summary 4 s, roots 0 s
  initially) — the cursor unifies the *inputs*, not the policy.
- Counters: `stream_cursor_x/z`, `stream_cursor_speed_mps`, plus existing
  `world_center_debug` distances now measured against the cursor.

### C2. Height authority revisions (tile → summary bridge)

- The heightfield tile cache exposes a commit notification with bounds and a monotonically
  increasing **surface revision** per committed tile (resident-from-fallback transitions,
  invalidation rebuilds, and store loads all count).
- Far summary tiles record the max surface revision they sampled. A small bridge (same
  shape as `registerSaveInvalidationTarget`) subscribes: on tile commit whose bounds
  intersect a built summary tile with an older revision → `cache.markStale(bounds)`. The
  existing commit-revision machinery then drives the shell refresh and clipmap re-upload
  with no new plumbing.
- Add a **parity probe** (debug/acceptance only): sample N random points per second through
  the tile-resident path and the fallback path where both are available; publish
  `height_authority_parity_max_error_m`. Gate it in continent acceptance (small epsilon —
  fallback recomputes the same math, so divergence is a bug, not noise).
- Edits already flow (stamps bridge); this contract makes *residency transitions* flow the
  same way, closing G5 and giving G10 a single correctness story.

### C3. StreamScheduler (one frame budget)

A governor that hands out the streaming time slice each frame instead of letting fixed
budgets stack:

- Inputs: recent frame-time headroom (target minus p95-smoothed frame ms), per-producer
  demand (queue depths, oldest-request age), and GPU mesher lane occupancy (root vs bubble
  — new counter).
- Producers register with a priority class:
  1. collision safety (bubble colliders, safety-ring pages),
  2. near visual (bubble visuals, refinement pages),
  3. seam band (far summary tiles in the near_far ring, tile batches feeding `canBuildPage`),
  4. far refresh (shell slice, shadow proxy slice, horizon-ring summary, biome streams).
- Each producer keeps its own internal mechanics; the scheduler only scales
  how-much-this-frame (build counts / deadline ms). Minimum quotas prevent starvation
  (e.g. tile builds can no longer be fully gated off by `heightfieldTileBuildAllowed`
  during sustained movement — replace the boolean gate with a low-priority quota, G4).
- Hysteresis on budget changes; oscillation guard proven over a long warmup (this is Task
  5/6 from the near-field doc, promoted to *cross-system* scope — the within-bubble version
  was measured structurally absorbed).
- **Keep-only-if-measured**: the whole phase ships behind a flag and survives only with
  movement p99 / p95 improvements on the acceptance A/B, per the repo perf rule.

### C4. Seam contract (frontier-adaptive far band)

- Root streamer publishes `live_clod_stream_ready_frontier_m`: the largest radius R such
  that required pages within R are ready (computable from the per-level required/ready
  sets it already tracks).
- The far owner's effective inner edge becomes
  `min(farShellInnerM, max(readyFrontierM, liveRadiusM + margin))` with hysteresis
  (recede fast, advance slow) — in replace mode via the clipmap's per-cell GPU ownership,
  in shell mode via the existing `nearBlendMeters` band following the frontier.
- Crossfade stays owned by root transitions for pages and by the far material fade for the
  band; the contract only moves *where* the band sits.
- Coverage-oracle gates get teeth during movement: `priority_unowned_cells == 0`,
  `clod_far_gap_holes == 0` sampled on the walking route, not just at settle. New gate on
  frontier lag: `farShellInnerM - ready_frontier_m` p95 below a calibrated bound.

## Phases

Order: measure → cheapest structural fix → correctness bridge → seam → scheduler → soak.
Every phase: failing test first for logic, typecheck + vitest + build green, no gate
weakening, evidence recorded here before the checkbox flips.

### Phase 0 — Measurement and counters (no behavior change)

1. Split `farSummaryMs` in the movement report using the existing `farSum*Ms` sub-buckets
   (`farSumTilesMs`, `farSumShellMs`, `farSumShadowProxyMs`, `farSumSunLightMs`,
   `farSumNaadfMs`, `farSumBiomeStreamMs`, `farSumClipmapMs`, `farSumStatsDomMs`) — find
   the 4.7 ms driver. Do not optimize blind (G9 depends on this).
2. Add `gpu_mesher_lane_busy_root` / `_bubble` (or equivalent occupancy counters) to prove
   or kill the shared-lane contention hypothesis.
3. Add `live_clod_stream_ready_frontier_m` (needed by C4, harmless standalone).
4. Capture the unified baseline: `accept:infinite-islands:reuse -- --scene walk --gate perf`
   plus one **long route** (multi-km, crosses ≥ 2 far-summary ring boundaries and ≥ 1
   IndexedDB-cold region) saved under `perf-runs/unified-streaming-baseline/`.
- [ ] sub-bucket table recorded here
- [ ] lane-occupancy counters landed + baseline numbers
- [ ] frontier counter landed
- [ ] baseline runs captured (walk + long route)

### Phase 1 — StreamCursor (C1)

1. Failing test: cursor equals `canonicalWorldCenter` semantics for all interaction modes
   (playing / orbit spawned / orbit pre-spawn / orbit target), velocity uses real
   `deltaSeconds` (assert a 30 fps sequence predicts the same distance as a 60 fps one).
2. Implement the module; delete `streamingWorldCenter`; thread cursor into the tile
   runtime (`velocityX/Z` + `deltaSeconds`), root streamer, far summary integration
   (replace internal `updateStreamCenter`), far shell/shadow/biome updates.
3. Existing world-center acceptance gates must pass unchanged; add
   `stream_cursor_*` counters to the debug overlay.
- [ ] failing test → green
- [ ] `streamingWorldCenter` deleted, one implementation remains
- [ ] tile prediction fed real velocity (unit test at 30 fps)
- [ ] `accept:infinite-islands --reuse` green, world-center gates untouched

### Phase 2 — Height authority revisions (C2)

1. Failing test: build a far summary tile over fallback heights, then commit a heightfield
   tile under it → the summary tile transitions to stale/requested and rebuilds with the
   canonical heights (extend the existing `summary-cache` invalidation tests).
2. Implement the commit notification + bridge + revision recording. Reuse
   `markStale(bounds)`; no new lifecycle states.
3. Parity probe + `height_authority_parity_max_error_m` counter; wire into
   `accept:continent-tiles` with a real epsilon.
4. Watch for churn: the bridge must coalesce (per-frame bounds union) so a burst of tile
   commits doesn't mark the whole near ring stale every frame — assert max summary
   rebuilds per second in the test.
- [ ] failing bridge test → green
- [ ] parity probe gated in continent acceptance
- [ ] churn guard test (bounded rebuilds under commit burst)
- [ ] walk + continent acceptance green

### Phase 3 — Frontier-adaptive seam (C4)

1. Failing test: with a synthetic root streamer at 40% coverage, the effective far inner
   edge follows the frontier (with hysteresis) and never leaves an unowned annulus
   (extend `ownership_coverage_oracle` tests).
2. Implement frontier publication + far-owner inner-edge follow (clipmap path first —
   per-cell ownership already exists; shell `nearBlendMeters` path second).
3. Movement-time coverage gates: `priority_unowned_cells == 0`,
   `clod_far_gap_holes == 0`, frontier-lag p95 bound calibrated from Phase 0 baseline.
4. Visual QA via the shot harness on the walk route poses (near↔far band, no double-render
   shimmer, no hole ring). Include shot + stats paths here.
- [ ] failing oracle test → green
- [ ] clipmap-mode frontier follow landed
- [ ] shell-mode frontier follow landed
- [ ] movement coverage gates green; shots recorded
- [ ] A/B: pop-in complaints quantified (transition counters) not worse; frame p95 not worse

### Phase 4 — StreamScheduler (C3) — measured adoption only

1. Prereq: Phase 0 numbers say *what* contends (farSummary sub-driver, lane occupancy).
   If the data shows a single dominant driver with a local fix (e.g. G9 shell resample →
   partial-rim updates or GPU displacement), do that local fix **first** and re-measure;
   the scheduler only earns its complexity if contention is genuinely cross-system.
2. Failing tests: priority starvation (collision work always proceeds), min-quota
   (tile builds never fully starve during movement — replaces the
   `heightfieldTileBuildAllowed` boolean, G4), oscillation guard (budgets stable under
   steady load).
3. Implement behind `?streamScheduler=1`; A/B on walk + long route; keep only with
   movement p99/p95 improvement and no steady-state regression. Report per the repo rule
   (frameMs p50/p95, renderMs p95, top bucket, `live_clod_stream_*`, `live_bubble_*`,
   `heightfield_tiles_*`, `farSum*Ms`).
- [ ] Phase 0 data reviewed; local-fix-first decision recorded here
- [ ] failing scheduler tests → green
- [ ] A/B evidence (keep or revert decision recorded either way)

### Phase 5 — Continuous-play soak, persistence, unification

1. **Long-route acceptance** becomes a standing gate: multi-km route, movement p99 bound,
   zero coverage holes, `heightfield_tiles_fallback_samples_this_frame` draining to 0
   after each region, eviction totals bounded (no runaway).
2. **Far summary persistence** (optional, measure first): IndexedDB store keyed by manifest
   hash + surface revision, same shape as the tile store. Only if the long-route baseline
   shows summary rebuild cost matters on revisit.
3. **Memory budget unification** (G8): one bytes-based pressure signal consulted by the
   four eviction policies; sized from long-route peaks.
4. **World-mode decision** (G10): either enable heightfield tiles for infinite-islands by
   default (single authority path everywhere — preferred if the Phase 2 parity probe and
   perf A/B hold) or record explicitly why islands stay procedural. Decision + evidence
   here, config flipped only with the A/B.
- [ ] long-route gate landed with real thresholds
- [ ] persistence decision (with numbers) recorded
- [ ] memory pressure signal landed or explicitly skipped (with numbers)
- [ ] world-mode decision recorded; config change (if any) benchmarked

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Perf: `perf:main` (steady) + `accept:infinite-islands:reuse -- --scene walk --gate perf`
  (movement) baseline vs change; long route from Phase 0 for Phases 3–5. Report frameMs
  p50/p95, renderMs p95, top phase bucket, and the counters named in each phase. Never
  claim a win from FPS alone; flat-or-regressing changes get reverted and the revert
  recorded here (the near-field session doc shows the discipline).
- Continent path: `accept:continent-tiles` after Phases 2 and 5.
- Visuals: shot harness poses on the walk route for Phase 3 (record shot + stats JSON
  paths here).
- Update this doc's checkboxes and the per-phase evidence after every commit-sized chunk
  (`md-progress-logging` discipline, same as the continent plan).

## Risks and rollbacks

- **C1** is a refactor of load-bearing center math — the mode-matrix unit test plus the
  existing world-center acceptance gates are the safety net; land it alone, not with
  behavior changes.
- **C2** risks invalidation churn (summary tiles re-baking every frame during tile
  streaming) — the coalescing/churn-guard test is mandatory, and the bridge can be
  feature-flagged off without touching the stamp-edit bridge.
- **C4** moves the seam during play; hysteresis constants must be calibrated from the
  Phase 0 baseline, and the coverage oracle gates catch both failure directions
  (hole vs double-render).
- **C3** is the highest-complexity, lowest-certainty item — that is why it is Phase 4,
  gated on Phase 0 evidence, flagged, and explicitly allowed to end in a documented
  revert.
- Pre-existing red on `main`: as of 2026-07-16 `npm run typecheck` fails with 4 errors in
  `tools/qa-capture-clod.ts` (stale imports against `src/qa/unified/*` — unrelated to
  streaming; the 2026-07-14 tree-impostor/WebGPU breakage was since fixed per the
  near-field session doc's green vitest baseline). Resolve or explicitly re-attribute
  before any phase claims a green typecheck gate.
