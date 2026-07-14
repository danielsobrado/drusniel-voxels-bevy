# Continent — Fixes and Next Steps

Created 2026-07-14. Parent: `continent-plan-overview-2026-07-12.md`.

This document is the actionable backlog that came out of the 2026-07-14 status review and code
read of the continent effort. It carries the open bugs, the Phase 2 evidence backfill, the
performance candidates, and the roadmap beyond the six planned phases. Update the checkboxes here
as items land (same discipline as the phase-doc Status sections).

## Where we actually are (2026-07-14)

Green baseline captured this session:

- `npm --prefix tools/clod-poc run typecheck` — clean.
- `npm --prefix tools/clod-poc test` — **543 files / 2924 tests pass** (exit 0).

Phase reality (the overview table and Phase 1/2 Status sections were stale and have been
corrected):

| Phase | State | Note |
| --- | --- | --- |
| 1. Canonical world contract | COMPLETE | manifest threaded + diagnostics; `heightfield_tiles_*` counters surfaced |
| 2. Streamed heightfield tiles | IMPLEMENTED, evidence pending | code + unit tests live and exercised by Phase 3; formal Evidence and 2 bug fixes outstanding |
| 3. Continental hydrology | COMPLETE | C3.1–C3.7, GPU tile-atlas streamed-root authority |
| 4. Unified world summary | COMPLETE | graph-water + 4 km canopy A/B accepted |
| 5. Voxel overlay / complex regions | COMPLETE | caves/masks, bounded NAADF occupancy |
| 6. RPG features and persistence | COMPLETE | save v2, prop identity, stamps, `world:verify` |

The architecture already matches the target (fable5-style world demo, but streamed, voxel-backed,
prop/cave/RPG-aware). The remaining work is hardening (bugs), proof (Phase 2 evidence), and
scaling toward real RPG content — not new architecture.

---

## Part A — Open bugs

### A1. Half-open tile-bound check over-requests tiles (fix first — breadth, not severity)

- **Where:** `src/world/heightfield_tiles/heightfield_tile_client_runtime.ts:63-64`
  (`heightfieldTilesReadyForPage`), gating streamed-root builds via
  `src/app/bootstrap/ui/frame_loop_startup.ts:445` (`canBuildPage`).
- **Mechanism:** the exclusive upper edge is computed as
  `maxX = minX + span - Number.EPSILON`. `Number.EPSILON` (2.22e-16) is the ULP at 1.0; at
  continent coordinates (thousands of metres) it is far below the local float step, so the
  subtraction is a no-op and `maxX === minX + span` exactly. `basePageSizeM = 4 × 16 = 64 m` and
  the canonical tile is 256 m, so every CLOD page at level ≥ 2 (span 256/512/…) has its far edge
  land exactly on a tile boundary. `Math.floor(maxX / 256)` then includes the **next** tile
  row/column the page does not overlap.
- **Consequence (corrected 2026-07-14 — earlier draft overstated this as a guaranteed rim hole):**
  there is **no continent-domain rejection** in this path — `planHeightfieldTileKeys`
  (`heightfield_tile_cache.ts:86`) is purely distance-based with no clamp, the client sampler sets
  `domain: null`, and the builder synthesizes any key from `baseSurfaceHeight` + graph + carve. So
  the over-requested +1 tile is **not** rejected: if it is within the residency radius
  (`config/heightfield_tiles.yaml radius_m: 768`) it simply builds (procedural ocean beyond the
  continent) and goes resident. The reliable consequences are therefore: (a) unnecessary adjacent
  tile residency and worker/IndexedDB work on every tile-aligned level-≥2 page, (b) residency
  inflation against `max_resident_tiles: 64`, which can add LRU eviction pressure, and (c) a page
  waiting on a tile it does not geometrically overlap. A **persistent** page-readiness stall (and
  the resulting terrain hole) is reachable only in the narrower case where the over-requested +1
  tile falls **outside the 768 m residency ring** — i.e. at the edge of tile-cache coverage — not
  as a certainty at the continent rim.
- **Fix direction:** make the upper edge exclusive with index math, not an epsilon. Compute the
  last tile as `Math.ceil((minX + span) / WORLD_TILE_SIZE_M) - 1` (and likewise for Z); this treats
  `[minX, minX + span)` as half-open, requires exactly the overlapped tiles, and is correct for
  negative coordinates too (`[-256, 0)` → tile −1 only). Keep the lower bound at
  `Math.floor(minX / WORLD_TILE_SIZE_M)`.
- **Test (write first, must fail before the fix):**
  `heightfield_tile_client_runtime.test.ts` — assert that a level-≥2 page whose far edge sits
  exactly on a 256 m boundary at a **large positive** coordinate (e.g. origin 32512, span 256)
  requires exactly the one covered tile, not the next. Add a **large negative** coordinate case and
  a small-origin case to lock both edge directions and prevent an origin regression.
- [x] failing regression test (large +, large −, small origin)
- [x] fix
- [ ] full `vitest` green
- **2026-07-14 verification:** focused file failed before the fix (3 failed / 8 passed) and
  passed after it (11 passed). Full repository Vitest remains pending.
- [ ] `accept:infinite-islands --reuse` (continent scene): required/resident tile counts drop on
  tile-aligned pages; no page-readiness stall at the residency-ring edge

### A2. Inflight accounting breaks after invalidation — three facets (low severity, but fix must be complete)

- **Where:** `src/world/heightfield_tiles/heightfield_tile_cache.ts:236-238` (`invalidateBounds`
  resets `inflightBatches = 0` and clears `inflightIds`) and `:300-304` (the `.finally()` that
  decrements `inflightBatches` and deletes `inflightIds`, both unconditionally).
- **Mechanism (corrected 2026-07-14 — earlier draft named only the counter facet):** an
  invalidation while prior-epoch physical builds are still running breaks accounting three ways:
  1. **Over-subscription window.** Resetting `inflightBatches = 0` lets `dispatch()` immediately
     start a new batch while the stale *physical* worker request is still running — so the
     concurrency limit is exceeded before any stale `.finally()` even fires.
  2. **Counter cross-talk.** A stale finalizer decrements `inflightBatches`, which now belongs to
     a new-epoch request, driving the counter below the true in-flight count.
  3. **ID-ownership cross-talk.** A stale finalizer runs `inflightIds.delete(entry.id)` even though
     `loadOrBuild` early-returned on its epoch check; if a new-epoch batch is building the same
     tile, its ID is removed → a later `dispatch()` can start a **duplicate build** of that tile.
- **Impact:** bounded, and consequences are wasted worker cycles + redundant (bit-identical) builds,
  not data corruption — so still low severity — but it violates the concurrency invariant exactly
  when a terrain edit fires, and the fix must cover all three facets.
- **Fix direction (supersedes the earlier epoch-guarded-decrement-only suggestion):** make
  `inflightBatches` a **pure physical-request counter** — do **not** reset it in `invalidateBounds`
  (or `clear`); let each physical request decrement it **unconditionally** in `.finally()` when it
  truly settles. Separately, **epoch-guard the `inflightIds` deletion**
  (`if (epoch === this.epoch) { for (…) inflightIds.delete(entry.id); }`) so a stale finalizer
  cannot remove a current-epoch tile's ID. With the counter no longer reset, `dispatch()` refuses
  to start new batches until the stale physical requests finish → strict concurrency held. This
  composes with `clear()` (which already leaves `inflightBatches` untouched).
- **Test:** dispatch N batches with a deferred builder, call `invalidateBounds`, dispatch again,
  then resolve the stale builders — assert (a) concurrent physical builds never exceed
  `maxInflightBatches` across the whole sequence, and (b) no tile ID is built twice. The existing
  invalidation test only covers rebuild-after-completed-load, so this race is currently uncovered.
- [x] failing regression test (concurrency ceiling + no duplicate build)
- [x] fix (physical counter + epoch-guarded ID deletion)
- [ ] full `vitest` green
- **2026-07-14 verification:** focused file failed before the fix (1 failed / 9 passed) and
  passed after it (10 passed). Full repository Vitest remains pending.

### Not-a-bug notes (verified this pass, keep for future readers)

- Far-summary GPU descriptor/record layout matches the JS packing byte-for-byte (64 B descriptor,
  128 B record; canonical-sample halo offset/stride consistent). No silent GPU data mismatch.
- The GPU far-summary builder writes `canopyCoverage = 0` on purpose; CPU enrichment fills canopy
  (Phase 4 C4.5 hybrid authority). Do not "fix" it in the shader.
- The hydrology graph builder (`hydrology_graph_builder.ts`) is a sound priority-flood + D8 +
  flow-accumulation + lake/river extraction with deterministic tie-breaks; the cycle guard in
  `accumulateFlow` is provably unreachable given the flat-routing via `floodParent`.

---

## Part B — Phase 2 evidence backfill (closes the last open phase)

Phase 2 code is done and unit-tested, but its Evidence checklist is empty and there is no
heightfield-tile acceptance gate. Do this **after A1/A2** so the numbers reflect fixed code.

1. Capture the four Evidence rows from `continent-phase-2-heightfield-tiles-2026-07-12.md`:
   - `perf:main` flag on/off (frameMs p50/p95, renderMs p95, top bucket).
   - `perf:move` route with `heightfield_tiles_*` and `live_clod_stream_worker_build_ms_l*`.
   - cold vs warm (store-hit) tile latency.
   - `accept:infinite-islands --reuse` green with `heightTiles` off (default) and on.
   Write summaries under `perf-runs/continent-phase2-evidence/` and link them in the phase doc.
2. Add a real heightfield-tile **acceptance gate** in `tools/infinite_acceptance` (thresholds on
   `heightfield_tiles_pending`/`inflight` draining, `fallbackSamplesTotal`, `buildMsP95`, and
   `heightfield_tile_gpu_atlas_resident` > 0 on continent). No `>= 0` theater — real bounds,
   per the plan's counter policy.
3. Flip Phase 2 to COMPLETE in its Status section and the overview table.

- [ ] evidence captured and linked
- [ ] acceptance gate added with real thresholds
- [ ] Phase 2 marked COMPLETE

---

## Part C — Performance candidates (bench-first, no unmeasured fixes)

Per `CLAUDE.md`, none of these are fixes until a before/after `perf:main` / `perf:move` (or a
targeted micro-bench) shows the win. Ranked by expected gameplay impact.

### C1. Full exclusion/project-prop rebuild on every prop edit (highest expected impact)

- **Where:** `src/save/save_runtime.ts:215-216` and `:224-225` — every `upsert` / `remove` /
  `destroyEnvironmentalPropCandidate` calls
  `SparsePropExclusionBitsets.fromSavedProps(savedPropStore.snapshot())` and
  `projectPropEditStore.restore(...)`, i.e. O(all props) per single edit.
- **Why it matters:** an RPG with many destructibles (looting, combat, mass destruction) makes
  this aggregate-quadratic on a hot interaction path.
- **Plan:** add incremental single-prop add/remove to `SparsePropExclusionBitsets` (flip only the
  affected prop's bits) and a cheaper project-prop delta path; keep `fromSavedProps` for load/init
  only. Micro-bench N props × M edits before/after.
- [ ] micro-bench baseline
- [ ] incremental API + call-site change
- [ ] micro-bench after + `vitest` green

### C2. Hydrology graph build is one ~12 s uninterruptible block (world-creation UX)

- **Where:** `src/world/hydrology_graph/hydrology_graph_builder.ts:363`
  (`buildHydrologyGraphFromMacro`). Only the row sampling is checkpointed; flood/accumulate/extract
  run to completion (~12 s at 2049² per C3.1 evidence). It is correctly in a worker (off the frame
  path), so this is world-creation progress/cancel UX, not steady-state frame time.
- **Plan (optional, only if creation UX needs it):** chunk the flood/accumulation passes to publish
  progress and honor cancellation; do not change outputs (determinism must hold — reuse the C3.1
  bit-determinism test).
- [ ] decide whether creation UX warrants it

### C3. Tile cache dispatches one batch per `dispatch()` call (MOOT at current config)

- **Where:** `heightfield_tile_cache.ts:287` — no loop, so each
  `dispatch()` starts at most one batch.
- **Status:** the shipped config is `config/heightfield_tiles.yaml max_inflight_batches: 1`, so
  there is **no unused concurrency to fill** — this is currently a non-issue. It only becomes
  relevant if `max_inflight_batches` is raised, and even then gradual dispatch may be intentional
  because tile builds share the CLOD worker. **Do not touch without first raising the budget and
  measuring** (`perf:move` A/B, watch worker contention against streamed-root builds).
- [ ] revisit only if `max_inflight_batches` > 1 is adopted

### C4. Per-call array allocations in tile counters/residency (low)

- **Where:** `heightfield_tile_cache.ts:205` and `:214` spread `[...this.resident.values()]` on
  every `counters()` / `residentTiles()` call; steady GC pressure if the HUD reads them per frame.
- **Plan:** maintain running `bytesResident` and a cached residency view, or gate counter
  computation to the HUD cadence. Confirm with an allocation profile before changing.
- [ ] profile then decide

---

## Part D — Documentation reconciliation

Done in the 2026-07-14 pass:

- [x] Overview table statuses + date corrected; green baseline noted.
- [x] Phase 1 Status marked COMPLETE with per-commit evidence.
- [x] Phase 2 Status section added (was missing) — IMPLEMENTED, evidence pending.
- [x] This backlog document created.

Remaining:

- [ ] When Phase 2 evidence lands, flip its Status and the overview to COMPLETE.
- [ ] Keep the `md-progress-logging` discipline: update the phase Status **and** this backlog after
  every commit-sized chunk, so an interrupted session loses nothing.

---

## Part E — Roadmap beyond the six phases (toward the full RPG world)

The six phases deliver the world substrate. The following is what stands between "substrate" and
"proper streaming voxel RPG", roughly in dependency order. Each becomes its own dated plan doc when
picked up.

1. **Content density and streaming budgets at RPG scale.** The tile/CLOD/far systems are proven at
   the acceptance scene; validate them with real prop/vegetation/structure density across a long
   traversal (perf:move over a multi-kilometre route), and set residency/eviction budgets from
   measured numbers rather than the current defaults.
2. **Editable-terrain + cave gameplay loop end to end.** Phase 5 gives the voxel overlay and cave
   masks; wire the actual dig/build/collapse interactions to the durable delta path (Phase 6 save
   runtime) and confirm invalidation → far-summary bridge → streamed-root rebuild round-trips under
   load (extends the `acceptance-runs/phase5-voxel-overlay` report).
3. **Prop/structure authoring at scale.** Deterministic road/settlement stamps and scatter
   exclusions exist (C6.3); the next step is authoring tools and density that exercise C1 (the
   incremental-exclusion perf fix is a prerequisite for heavy destructible content).
4. **Save/migration hardening.** Schema v2 + v1 migration exist (C6.4); add soak coverage for
   regenerate-vs-persisted reconciliation and manifest-pinned upgrades across a generator version
   bump (`TERRAIN_SOURCE_VERSION` change) so an existing world is never silently altered.
5. **Bevy port groundwork.** `docs/architecture/bevy-world-source-port.md` defines the contract-first
   ladder; Phases 1–2 shaped `WorldManifest` / `WorldTileKey` / `HeightfieldSampler` to port as data
   + pure functions. Porting stays out of scope until the substrate is content-proven, but keep new
   contracts port-shaped.

---

## Suggested sequencing

1. **A1** (half-open tile bound — over-requests on every tile-aligned level-≥2 page; stall only at
   the residency-ring edge) + its large-±/small-origin regression tests.
2. **A2** (inflight accounting, all three facets) — small, ride the same branch.
3. **B** (Phase 2 evidence + acceptance gate) — proves the streamed tile layer and closes the last
   open phase on measured numbers.
4. **C1** (incremental prop exclusions) — unblocks heavy RPG destructible content; bench-first.
5. **E1/E2** (density + cave loop) — the first real RPG-scale validation.

## Verification protocol (every item, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
# dev server for harnesses (direct, not via rtk):
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Frame/streaming changes: `perf:main` and `perf:move` baseline vs change; report frameMs p50/p95,
  renderMs p95, top bucket, and the relevant `heightfield_tiles_*` / `live_clod_stream_*` counters.
- Continent acceptance: `accept:infinite-islands --reuse` (continent scene), no weakened gates.
- Never claim a perf fix from FPS alone; record before/after `summary.json` numbers here.
