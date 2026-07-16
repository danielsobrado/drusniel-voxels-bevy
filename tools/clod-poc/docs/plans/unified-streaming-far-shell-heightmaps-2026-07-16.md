# Unified Streaming — CLOD pages, far shell, and heightfield tiles as one system

Created 2026-07-16. Status: HEADLESS IMPLEMENTATION COMPLETE; MANUAL VISUAL QA PENDING.

Revised same day after an external review. Accepted: C2 reframed as *surface-cache*
revisions with a single global commit revision (per-tile max-revision recording had a real
staleness-miss bug); C4 changed from a radial frontier actuator to per-cell readiness
ownership; C3 changed from one ms budget to a multi-resource capacity model; the
misleading master "streaming" toggle added as G11 + Phase 1; local-fix-first promoted to
its own phase; persistence/memory phases made strictly evidence-gated. Amended against the
review: master-off means **freeze**, not hide (hiding the far band 5 km from the startup
window would show void), and the scalar frontier counter stays as a diagnostic/gate input
(only its use as a control input was dropped).

## Implementation result (2026-07-16)

Phases 0–5 and the Phase 7 standing gate are implemented. Phase 4 ended in a measured
revert: `farSumTilesMs` was the largest far-summary sub-driver, but the cadence candidate
increased its p95 from 0.5 ms to 4.2 ms, so it did not ship. Phase 6 also ended in the
designed no-go state: the root and bubble use independent GPU mesher implementations, the
final long route stayed inside its tail-latency gate, and the remaining far-summary work is
small; a cross-system governor did not earn its complexity.

Headless evidence:

- Baseline steady: `perf-runs/unified-streaming-baseline/steady/summary.json` — frame p50
  2.50 ms, p95 3.10 ms, render p95 2.20 ms.
- Final steady: `perf-runs/unified-streaming-final/steady/summary.json` — frame p50
  2.40 ms, p95 3.10 ms, render p95 2.10 ms.
- Final walk: `acceptance-runs/infinite-islands/2026-07-16T08-39-32/report.json` — pass,
  movement p99 14.90 ms, no ownership holes.
- Final 3.06 km route: `acceptance-runs/infinite-islands/2026-07-16T09-04-28/report.json`
  — pass, movement p99 15.00 ms, max 19.40 ms, frontier-lag p95 384 m, zero priority
  unowned/CLOD-far-gap/clipmap-hole samples, 360 bubble evictions and 125 root evictions.
- Continent cache gate: `acceptance-runs/continent-tiles/unified-streaming-final/report.json`
  — pass, 70/70 resident tiles, queues drained, current-frame fallback 0, 16 parity
  samples, parity max error 0 m.

Phase 0 walk sub-buckets (p95):

| bucket | p95 |
| --- | ---: |
| `farSumTilesMs` | 0.5 ms |
| `farSumSunLightMs` | 0.2 ms |
| `farSumClipmapMs` | 0.1 ms |
| `farSumShadowProxyMs` | 0.1 ms |
| `farSumShellMs`, `farSumBiomeStreamMs`, `farSumStatsDomMs`, `farSumNaadfMs` | 0 ms |

No screenshots were inspected and no visual conclusion is claimed. The acceptance harness
created its normal automated image artifacts, but manual seam, shimmer, pop-in, and shell-
path review is deliberately left to the handover document.

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
2. **One surface truth with revisions** — the canonical world function (generator +
   hydrology carve + feature stamps + voxel edits/overlay) stays the authority;
   heightfield tiles are its revisioned *cache*, and every derived cache (far summary
   tiles, far shell, clipmap, vegetation masks) can tell when it baked stale data and
   re-bake by bounds.
3. **One capacity model** — a small multi-resource governor (main-thread ms, worker batch
   slots, GPU mesher lanes, upload bytes) arbitrates streaming work across systems instead
   of N independent 2 ms budgets stacking on the same frame.
4. **One seam** — the near↔far handoff follows *per-cell CLOD readiness* instead of a
   fixed radius, so a lagging streamer is covered by the far owner cell-by-cell rather
   than leaving pops or holes.
5. **One switch** — a master streaming control that freezes and resumes the whole stack
   coherently (today the GUI toggle labeled "streaming" only stops the near bubble).

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
- **G10 — World-mode split brain.** Continent runs tiles-as-required-cache; default
  infinite islands runs pure procedural with tiles off. Two tall paths through the same
  code, twice the test surface, and features proven on one mode (tile atlas, hydrology
  carve) silently absent on the other.
- **G11 — The master toggle lies.** The top-level GUI control labeled "streaming"
  (`src/ui/gui/clod_gui.ts:145`) toggles only `state.bubble`. The streamed CLOD roots
  (`enabled: streamingScene` at creation), the heightfield tile runtime, far summary
  requests, far shell recentering, and the clipmap all keep streaming regardless — there
  is no way to freeze the stack as one piece, for users or for A/B measurement.

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

### C2. Surface-cache revisions (tile → summary bridge)

Terminology first, because it shapes the Bevy port: the **authority** is the canonical
world function — generator + hydrology carve + feature stamps + voxel edits (and the voxel
overlay in complex regions). Heightfield tiles are a revisioned **cache** of that function;
the code's `authoritative` flag only means "pages must wait for this cache", not "this
cache is the world truth". Nothing in this contract may promote baked tile bytes to truth —
caves, overhangs, and near-player editability stay voxel-owned.

- One **global, monotonically increasing surface revision**. Every tile commit
  (fallback→resident transition, invalidation rebuild, store load) emits
  `SurfaceCommit { globalRevision, bounds }`. Per-tile independent revision counters are
  NOT sufficient: a summary tile that sampled source tiles at revisions {10, 4} and
  recorded max 10 would miss source B moving 4→5. The global counter makes "newer than
  what I baked" well-defined across any set of source tiles.
- The event path is unconditional: a commit whose bounds intersect a built far-summary
  tile marks it stale (`cache.markStale(bounds)`) with no revision comparison. The stored
  per-summary-tile `builtAtGlobalRevision` exists for *catch-up only* — reconciling
  commits that land while a summary build is in flight (the race the existing
  `summary-cache-invalidation-race` test covers) and re-syncing after the bridge is
  toggled off/on. The existing commit-revision machinery then drives the shell refresh
  and clipmap re-upload with no new plumbing.
- Add a **parity probe** (debug/acceptance only): sample N random points per second through
  the tile-resident path and the fallback path where both are available; publish
  `surface_cache_parity_max_error_m`. Gate it in continent acceptance (small epsilon —
  fallback recomputes the same math, so divergence is a bug, not noise).
- Edits already flow (stamps bridge); this contract makes *residency transitions* flow the
  same way, closing G5 and giving G10 a single correctness story.

### C3. StreamCapacity (multi-resource governor, not one budget)

The contended resources are not interchangeable — worker dispatch, GPU mesher lanes,
main-thread apply/slice time, and GPU upload bytes are separate currencies (the CLOD
handoff doc already established worker build vs main-thread apply as separate cost
systems). A single milliseconds budget would produce misleading accounting, so the
governor allocates per resource:

```ts
interface StreamingFrameCapacity {
  mainThreadDeadlineMs: number; // apply queues, shell/proxy slices, CPU summary builds
  workerBatchSlots: number;     // root page builds, heightfield tile batches
  gpuMesherSlots: number;       // root-vs-bubble lane split (8 lanes today)
  uploadBytes: number;          // geometry/atlas uploads this frame
}
```

- Producers request the resource they actually consume; each subsystem keeps its own
  queue and internal mechanics. The policy stays a small allocator — not a scheduler
  class that owns every subsystem.
- Priority classes (order): collision safety (bubble colliders, safety-ring pages) →
  near visual (bubble visuals, refinement pages) → seam band (near_far summary tiles,
  tile batches feeding `canBuildPage`) → far refresh (shell slice, shadow proxy slice,
  horizon-ring summary, biome streams).
- Minimum quotas prevent starvation (tile builds can no longer be fully gated off by
  `heightfieldTileBuildAllowed` during sustained movement — replace the boolean gate with
  a low-priority quota, G4).
- Hysteresis on allocation changes; oscillation guard proven over a long warmup (this is
  Task 5/6 from the near-field doc promoted to *cross-system* scope — the within-bubble
  version was measured structurally absorbed).
- **Keep-only-if-measured**: ships behind a flag and survives only with movement p99/p95
  improvements on the acceptance A/B, per the repo perf rule.

### C4. Seam contract (per-cell readiness ownership, not a radial frontier)

A single scalar frontier radius is the wrong actuator: one missing page to the north
would pull the far band inward through all 360°, including sectors that are fully ready.
The backlog numbers also overstate the visual problem — the root streamer keeps
hierarchical parent/safety coverage while refinements land (`parentCoverageViolations`,
`pageCoveredByResidentClodHierarchy`), so G6 is mostly *refinement pop*, not holes. The
seam therefore follows readiness **per cell**, and the annular shell stays put:

- The root streamer publishes a per-cell readiness feed for the refinement band (which
  cells are covered by a *refined* page rather than only safety coverage) — the residency
  feeds and coverage oracle already compute this shape.
- The far clipmap consumes it through its existing per-cell GPU ownership: clipmap cells
  render wherever refined CLOD is not ready and fade out per cell as pages land. Clipmap
  (replace-mode) path first — it is the band owner there today.
- The annular shell keeps its stable configured inner radius initially. Sector- or
  cell-based shell ownership is added only if shot evidence proves the shell path needs
  it.
- `live_clod_stream_ready_frontier_m` (the worst-case scalar) is still published — as a
  *diagnostic and acceptance-gate input only*, never as a control input.
- Crossfade stays owned by root transitions for pages and by the far material fade for the
  band; the contract only decides *which cells* the far owner covers.
- Coverage-oracle gates get teeth during movement: `priority_unowned_cells == 0`,
  `clod_far_gap_holes == 0` sampled on the walking route, not just at settle. New gate on
  frontier lag: `farShellInnerM - ready_frontier_m` p95 below a calibrated bound.

## Phases

Order: measure → control contract → cursor → cache-revision bridge → dominant local fix →
per-cell seam → capacity governor → soak. Every phase: failing test first for logic,
typecheck + vitest + build green, no gate weakening, evidence recorded here before the
checkbox flips.

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
- [x] sub-bucket table recorded above (`farSumTilesMs` was largest at 0.5 ms p95)
- [x] lane-occupancy counters landed; root and bubble proved to use independent meshers
- [x] frontier counter landed
- [ ] baseline walk captured; the multi-km route was added and captured as the final standing gate, not as a pre-change baseline

### Phase 1 — Runtime control contract (master streaming switch)

Fixes G11. Independent of Phase 0 and may run in parallel with it.

1. Failing test: `terrainStreamingEnabled = false` stops *new* work in all six streams
   (bubble required-set growth, root planning/dispatch, tile dispatch, far summary
   requests/builds, shell recenter + slice, clipmap ring updates) while preserving
   resident caches and currently rendered meshes; re-enabling resumes from the current
   cursor with no rebuild storm (caches still valid).
2. Semantics are **freeze**, not hide: renderers keep their last state. Hiding the far
   band while the player stands kilometres from the startup window would show void — the
   useful semantics (for users and for measurement) is a coherent pause, which also gives
   perf work a clean "streaming off" A/B lever.
3. The GUI toggle currently labeled "streaming" (`clod_gui.ts:145`) becomes the master
   switch; the bubble-only toggle already exists in the advanced near-field folder
   ("enable (raw chunks)", `terrain_material_gui.ts:70`) and keeps its narrow meaning.
4. Presets that set `bubble = false` (`clodPerf` / acceptance paths, the historical
   sticky-bubble workaround) are re-audited against the new field so acceptance URLs keep
   their current meaning.
- [x] failing freeze/resume test → green
- [x] GUI re-labeled; bubble toggle stays demoted to the near-field folder
- [x] preset audit recorded: existing `bubble = false` presets remain bubble-only; master defaults on
- [x] walk acceptance green with the master switch untouched

### Phase 2 — StreamCursor (C1)

1. Failing test: cursor equals `canonicalWorldCenter` semantics for all interaction modes
   (playing / orbit spawned / orbit pre-spawn / orbit target), velocity uses real
   `deltaSeconds` (assert a 30 fps sequence predicts the same distance as a 60 fps one).
2. Implement the module; delete `streamingWorldCenter`; thread cursor into the tile
   runtime (`velocityX/Z` + `deltaSeconds`), root streamer, far summary integration
   (replace internal `updateStreamCenter`), far shell/shadow/biome updates.
3. Existing world-center acceptance gates must pass unchanged; add
   `stream_cursor_*` counters to the debug overlay.
- [x] failing test → green
- [x] `streamingWorldCenter` deleted, one implementation remains
- [x] tile prediction fed real velocity (unit test at 30 fps)
- [x] `accept:infinite-islands --reuse` green, world-center gates untouched

### Phase 3 — Surface-cache revisions (C2)

1. Failing test: build a far summary tile over fallback heights, then commit a heightfield
   tile under it → the summary tile transitions to stale/requested and rebuilds with the
   canonical heights (extend the existing `summary-cache` invalidation tests). Include the
   multi-source case: a summary tile that sampled source tiles at global revisions
   {10, 4}, followed by a recommit of the rev-4 source, must go stale — this is exactly
   what per-tile max-revision recording would miss.
2. Implement `SurfaceCommit { globalRevision, bounds }` + the bridge + per-summary-tile
   `builtAtGlobalRevision`. Reuse `markStale(bounds)`; no new lifecycle states.
3. Parity probe + `surface_cache_parity_max_error_m` counter; wire into
   `accept:continent-tiles` with a real epsilon.
4. Watch for churn: the bridge must coalesce (per-frame bounds union) so a burst of tile
   commits doesn't mark the whole near ring stale every frame — assert max summary
   rebuilds per second in the test.
- [x] failing bridge test → green
- [x] parity probe gated in continent acceptance
- [x] churn guard test (commit bursts coalesce to one bounds invalidation)
- [x] walk + continent acceptance green

### Phase 4 — Fix the dominant `farSummaryMs` sub-driver locally

Phase 0's sub-bucket table decides this phase's content: a local fix beats a governor when
one subsystem dominates. Candidates by *suspicion* (do not start until the table exists):

1. `farSumShellMs` dominant → G9: replace the full-ring shell resample on recenter with
   partial-rim updates (only vertices whose sampled world cell changed), or move the shell
   fully to GPU displacement from the summary atlas (the `heightSamplingMode: "gpu"` path
   already exists).
2. `farSumTilesMs` dominant → tile build/enrichment slicing or GPU-builder coverage.
3. `farSumStatsDomMs` / upload-shaped buckets dominant → cadence and throttle fixes.
- [x] driver identified from the Phase 0 table: `farSumTilesMs`, 0.5 ms p95
- [x] characterization test and cadence candidate completed
- [x] measured no-go: cadence raised `farSumTilesMs` p95 to 4.2 ms and `farSummaryMs`
      p95 to 4.4 ms (`2026-07-16T08-04-52`), so code and test were removed; no visual
      claim was made

### Phase 5 — Per-cell seam ownership (C4)

1. Failing test: with a synthetic root streamer at 40% *refined* coverage (full safety
   coverage), far-clipmap cells cover exactly the non-refined cells — no unowned cell, no
   double-owned cell (extend `ownership_coverage_oracle` tests).
2. Implement the per-cell readiness feed + clipmap ownership consumption (replace mode
   first). The annular shell keeps its configured radius; a shell-path follow is a
   separate decision gated on shot evidence.
3. Movement-time coverage gates: `priority_unowned_cells == 0`,
   `clod_far_gap_holes == 0`, frontier-lag p95 bound calibrated from Phase 0 baseline.
4. Visual QA via the shot harness on the walk route poses (near↔far band, no double-render
   shimmer, no hole ring). Include shot + stats paths here.
- [x] failing oracle test → green
- [x] per-cell clipmap ownership landed (replace mode)
- [ ] shell-path decision deferred until manual shot evidence exists
- [x] movement coverage gates green
- [ ] shots and pop-in/shimmer review deferred by request; steady frame p95 was unchanged

### Phase 6 — StreamCapacity governor (C3) — measured adoption only

1. Prereq: Phases 0 and 4 are done and the re-measured route *still* shows cross-system
   contention (lane occupancy split, stacked budgets on the p99 frames). If Phase 4's
   local fix already cleared the movement p99 target, stop here and record that — the
   governor only earns its complexity if contention is genuinely cross-system.
2. Failing tests: priority starvation (collision work always proceeds), min-quota
   (tile builds never fully starve during movement — replaces the
   `heightfieldTileBuildAllowed` boolean, G4), oscillation guard (allocations stable under
   steady load), and per-resource accounting (a worker-slot consumer cannot exhaust the
   main-thread deadline).
3. Implement behind `?streamCapacity=1`; A/B on walk + long route; keep only with
   movement p99/p95 improvement and no steady-state regression. Report per the repo rule
   (frameMs p50/p95, renderMs p95, top bucket, `live_clod_stream_*`, `live_bubble_*`,
   `heightfield_tiles_*`, `farSum*Ms`).
- [x] Phase 0 + Phase 4 re-measure reviewed; no-go recorded above
- [ ] governor tests not created because the conditional implementation prerequisite failed
- [x] no-go evidence recorded; no `streamCapacity` flag or scheduler complexity shipped

### Phase 7 — Continuous-play soak, persistence, unification

1. **Long-route acceptance** becomes a standing gate: multi-km route, movement p99 bound,
   zero coverage holes, `heightfield_tiles_fallback_samples_this_frame` draining to 0
   after each region, eviction totals bounded (no runaway).
2. **Far summary persistence** (strictly optional): do NOT build until a revisit
   measurement on the long route shows meaningful rebuild cost. If built: IndexedDB store
   keyed by manifest hash + global surface revision, same shape as the tile store.
3. **Memory pressure signal** (G8): measure approximate resident bytes per cache first;
   then one bytes-based pressure signal consulted by the four existing eviction policies,
   sized from long-route peaks. A central cross-cache eviction manager is explicitly out
   of scope — the shared signal is expected to be enough.
4. **World-mode decision** (G10): either enable heightfield tiles for infinite-islands by
   default (single surface-cache path everywhere — preferred if the Phase 3 parity probe
   and perf A/B hold, and explicitly NOT a promotion of tiles to world truth per C2) or
   record why islands stay procedural. Decision + evidence here, config flipped only with
   the A/B.
- [x] long-route gate landed with real thresholds (`accept:unified-streaming-long-route`)
- [x] persistence skipped: no revisit-cost measurement was captured, so the strict prerequisite was absent
- [x] memory pressure signal skipped: the 3.06 km route stayed bounded at 360 bubble and 125 root evictions; no runaway evidence
- [x] world-mode decision: keep infinite-islands procedural for now; parity is proven, but no tiles-on islands perf A/B exists to justify a default flip

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Perf: `perf:main` (steady) + `accept:infinite-islands:reuse -- --scene walk --gate perf`
  (movement) baseline vs change; long route from Phase 0 for Phases 4–7. Report frameMs
  p50/p95, renderMs p95, top phase bucket, and the counters named in each phase. Never
  claim a win from FPS alone; flat-or-regressing changes get reverted and the revert
  recorded here (the near-field session doc shows the discipline).
- Continent path: `accept:continent-tiles` after Phases 3 and 7.
- Visuals: shot harness poses on the walk route for Phases 4–5 (record shot + stats JSON
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
- **C4** changes which cells the far owner renders during play; per-cell fades must be
  verified in shots, and the coverage oracle gates catch both failure directions
  (hole vs double-render). The shell path is deliberately deferred behind shot evidence.
- **C3** is the highest-complexity, lowest-certainty item — that is why it is Phase 6,
  gated on Phase 0 + Phase 4 evidence, flagged, and explicitly allowed to end in a
  documented revert.
- **Phase 1** touches presets: `clodPerf` / acceptance paths historically force
  `bubble = false` (the old sticky-toggle workaround) — the preset audit must keep
  acceptance URLs meaning what they meant, or the perf baselines silently change.
- Pre-existing red on `main`: as of 2026-07-16 `npm run typecheck` fails with 4 errors in
  `tools/qa-capture-clod.ts` (stale imports against `src/qa/unified/*` — unrelated to
  streaming; the 2026-07-14 tree-impostor/WebGPU breakage was since fixed per the
  near-field session doc's green vitest baseline). Resolve or explicitly re-attribute
  before any phase claims a green typecheck gate.
