# Continent Phase 2 — Streamed Canonical Heightfield Tiles

Parent: `continent-plan-overview-2026-07-12.md`. Requires Phase 1.

## Status

Updated 2026-07-14. **IMPLEMENTED — formal Evidence not yet recorded.**

The full tile system is live and unit-tested: `heightfield_tile_cache.ts`, `heightfield_tile_store.ts`
(IndexedDB), `heightfield_tile_runtime.ts` / `heightfield_tile_client_runtime.ts`,
`heightfield_tile_gpu_atlas.ts`, `heightfield_tile_sampler.ts`, `heightfield_tile_carve.ts`,
`heightfield_tile_complexity.ts`, and the worker protocol — with `heightfield_tiles_*` and
`heightfield_tile_gpu_atlas_*` counters surfaced. Phase 3 (validated) drives this cache as the
GPU tile-atlas streamed-root authority end-to-end, so it is exercised in a shipping path.

Not done: the doc's own **Evidence** checklist below (perf:main flag on/off, perf:move route
counters, cold-vs-warm store latency, `accept:infinite-islands --reuse` flag on/off) was never
formally captured, and there is no dedicated heightfield-tile acceptance gate in
`tools/infinite_acceptance`. Two correctness bugs in this phase's code are open — boundary
over-request and inflight-batch accounting; both are detailed in
`continent-fixes-and-next-steps-2026-07-14.md`. Per this plan's own rule ("a phase without
recorded numbers is not done"), Phase 2 stays **IMPLEMENTED** rather than COMPLETE until the
Evidence lands and the two bugs are fixed.

## Goal

A camera-following cache of **256 m canonical surface tiles** (257×257 samples at 1 m), built in
the existing CLOD worker, persisted to IndexedDB under the manifest identity, residency-bounded,
with exact shared borders — installed as a `HeightfieldSampler` ring outside the startup raster.

In this phase tiles are still **bit-exact caches of the procedural field** (like the startup
raster, generalized and unbounded). That keeps every CPU/GPU parity property intact while the
lifecycle, persistence, and perf characteristics get built and soaked. Tiles become the
*authority* only in Phase 3, when carving makes them diverge.

## Non-goals

No GPU mesher change (streamed roots keep evaluating procedural WGSL — the raster doc's
documented contract). No hydrology change. No new renderer. No far-summary change.

## Current code this builds on (verified 2026-07-12)

| Concern | Today | Anchor |
| --- | --- | --- |
| Deterministic tile cache precedent | `HydrologyTileCache`: pure function of (tileX,tileZ,sampler,config), LRU, bit-identical rebuilds | `src/water/hydrologyTileSource.ts`, `water:streaming` validator |
| Lifecycle precedent | far-summary states missing→requested→building→ready→stale→cooling→evicted + build budget | `src/far-summary/summary-cache.ts`, `types.ts:1-8` |
| Prediction precedent | far-summary `stream-center.ts` velocity-predicted center | `src/far-summary/stream-center.ts` |
| Worker transport precedent | `buildStreamRoots` request/response with transferables + timings | `src/clod_worker_protocol.ts`, `clod_worker_client.ts` |
| Worker terrain override | `installWorkerTerrainOverride` installs the startup raster in the worker | `src/clod_worker_runtime.ts`, `clod_worker_client_helpers.ts` |
| IndexedDB precedent | save DB with schema'd stores, region-keyed payloads, ArrayBuffer values | `src/save/save_db.ts`, `save/region_store.ts` |
| Fallback-chain precedent | far-summary sampler: exact→lower ring→stale→procedural→conservative | `src/far-summary/clipmap-sampler.ts` |

## Design

### `HeightfieldTile`

```ts
interface HeightfieldTile {
  key: WorldTileKey;                 // 256 m grid, Phase 1 module
  res: 257;                          // (tileSizeM / 1 m) + 1, shared-border lattice
  heights: Float64Array;             // f64 in this phase — see decision below
  sourceRevision: number;            // manifest.generatorVersion-scoped revision
  builtMs: number;
}
```

**f64 vs f32 (decision):** this phase stores f64 so integer-lattice reads are bit-identical to
`baseSurfaceHeight` — the exact property the startup raster relies on, testable with the same
parity suite. Cost: 528 KB/tile (257²×8 B). Phase 3, where the carved tile *defines* truth,
re-decides storage (f32 + explicit quantization is acceptable once nothing has to match a f64
procedural evaluation) and bumps `TERRAIN_SOURCE_VERSION` accordingly. Do not spend effort on
f32 compression now.

Shared borders: tiles share their edge lattice (sample `x = tileOrigin + 256` belongs to both
neighbors); both compute it from the same world coordinate → exact by construction, locked by a
border-sweep test (the hydrology-tile property, `hydrology-authority.md` Phase 3 section).

### Residency and budget

- Ring radius: cover the CLOD streamed-root demand — `state.bubbleRadius` + streamed-root
  radius + one-tile halo; configurable `heightfield_tiles.radius_m` (default ≈ 768 m ⇒ ≤ 49
  resident tiles ≈ 26 MB f64). LRU cap `max_resident_tiles: 64` (≈ 34 MB) with
  evict-distance multiplier semantics copied from streamed roots.
- Build budget: ≤ 1 tile batch in flight (mirror `DEFAULT_MAX_INFLIGHT_BATCHES`), apply
  (install into cache + notify) is O(pointer swap) — no geometry, so no apply budget needed.
- Prefetch: predicted center from a shared `stream-center` instance, request nearest-first
  (reuse `sortStreamingClodPageCoordsForLoad` ordering logic shape).

### Persistence

IndexedDB store `heightfield_tiles` keyed by
`(manifest.terrainSourceHash, tileKeyString, sourceRevision)`, value = raw `ArrayBuffer` +
small metadata record. Load-before-generate; store-after-generate (fire-and-forget with error
counter). A generator/version change naturally misses the store — old worlds keep their
entries (Phase 6 handles migration/GC).

### Sampler wiring (behind flag)

`heightfieldTileSampler(cache)` implements `HeightfieldSampler` with chain:

```text
1. startup raster            (inside padded startup domain)   — unchanged
2. resident heightfield tile (integer lattice)                — new
3. procedural field          (fractional + non-resident)      — unchanged
```

Enabled by `?heightTiles=1` + `config/heightfield_tiles.yaml` default-off. Because tiles are
bit-exact, flag on/off must produce identical geometry — that *is* the A/B test.

## Commit sequence

### C2.1 — Pure tile builder + parity/border tests

- `src/world/heightfield_tiles/heightfield_tile.ts`: types + `buildHeightfieldTile(key, field)`
  pure function (no caching, no workers).
- Tests: lattice bit-parity vs `baseSurfaceHeight` (seeds 1/2/3, tiles straddling origin and
  negative coords); neighbor border exactness; determinism (two builds deep-equal).
- Nothing consumes it. Typecheck + targeted vitest only.

### C2.2 — Worker protocol + client method

- `clod_worker_protocol.ts`: `buildHeightfieldTiles` request (`keys: [{tx,tz}]`) /
  `heightfieldTilesBuilt` response (transferable buffers, per-tile buildMs), following the
  `buildStreamRoots`/`rehydrateStandaloneNodes` pattern including error/reject bookkeeping.
- `clod_worker.ts`: handler builds via C2.1 using the worker's terrain field (worker already
  regenerates the procedural field; unified mode ships no carve — `hydrology-authority.md`).
  Must error if called before `build` completes (same guard as buildStreamRoots).
- `clod_worker_client.ts`: `buildHeightfieldTiles(keys) → Promise<{tiles, buildMs}>`.
- Tests: protocol round-trip + client tests mirroring `clod_worker_client.test.ts` cases
  (resolve, reject, transfer bookkeeping).

### C2.3 — `HeightfieldTileCache` (lifecycle + prefetch + counters)

- `src/world/heightfield_tiles/heightfield_tile_cache.ts`: required-set planner (ring around
  predicted center), states (subset of far-summary's: missing/inflight/ready/evicted — no
  stale tier needed while tiles are procedural-exact), LRU eviction, failure retry with
  cooldown (copy `retryCooldownFrames` semantics from `clod_streaming_roots.ts:198`).
- `update(center)` called once per frame from the frame loop **next to** the streamed-roots
  update (`frame_loop_startup.ts`), budgeted: planning is O(ring tiles), map lookups only.
- Counters (mirrored like `live_clod_stream_*`): `heightfield_tiles_resident`,
  `_pending`, `_inflight`, `_builds_total`, `_build_ms_p95`, `_evictions_total`,
  `_fallback_samples_total` (sampler misses that fell to procedural), `_bytes_resident`.
- Tests: fake async builder (deferred promises) — budget, apply-on-resolve, eviction,
  planner-only when builder null, failure cooldown. Mirror `clod_streaming_roots.test.ts`
  structure.

### C2.4 — Sampler + flag wiring + A/B identity proof

- Sampler chain as designed; installed in `world_build_startup.ts` only when
  `heightTiles=1` and mode is infinite-islands/continent.
- The cache-key question: the sampler is bit-exact, so the terrain-source hash **must not**
  change with the flag (assert in test: same hash flag on/off). Add the tile-system config to
  the hash **only** in Phase 3 when it can change geometry.
- Browser A/B (manual QA + shot harness): same pose, flag on/off, `phase1.heightSignature`-style
  counters and screenshots identical; movement route probe shows `_fallback_samples_total`
  near-zero while inside the ring.

### C2.5 — IndexedDB persistence

- `src/world/heightfield_tiles/heightfield_tile_store.ts` on save_db patterns; wire
  load-before-generate into the cache (inflight state covers both paths); store after worker
  build. Counters: `_store_hits`, `_store_misses`, `_store_errors`.
- Tests: fake-indexeddb round-trip (the save tests' harness), key includes terrainSourceHash
  (two hashes → two namespaces), corrupted-entry tolerance (falls back to rebuild).

### C2.6 — Soak, perf evidence, default stays off

- Record Evidence (below). Flip default **only** in Phase 3 when tiles become load-bearing;
  this phase ships default-off to keep risk zero.

## Performance budget and measurement

- Tile build (worker): expect ≈ 257² × field cost; the startup raster measured 688 ms for a
  world=8 build ≈ 0.26 M samples ⇒ ~170 ms per 66 K-sample tile is the pessimistic bound;
  batch ≤ 2 tiles per request to keep worker latency low for streamed-root traffic sharing the
  same worker. Gate: streamed-root `workerBuildMsP95ByLevel` must not regress >10% with tiles
  enabled during a movement run.
- Main thread: cache update + sampler dispatch must not appear in perf:main top buckets; gate
  `frameMs p95` unchanged (±0.2 ms) flag on vs off, stationary and movement.
- Memory: `_bytes_resident` ≤ 34 MB at default config; acceptance rule `>0 and <= budget`
  when flag on.
- Commands: standard battery + perf:move mini-run with `&heightTiles=1` vs off (same route).

## Risks

- *Worker contention* with streamed-root builds → tile batches are lower priority; keep
  `maxInflightBatches` shared-aware (never dispatch tiles while a root batch is pending if the
  route probe shows p95 regression).
- *IndexedDB latency spikes* → all IO off frame path (async), load races resolved by inflight
  state; a slow store never blocks building.
- *Double memory with raster* → acceptable (raster ≤ 16 MiB, spawn-only); Phase 3 C3.4 folds
  the spawn area into tiles and can retire the raster if numbers support it.

## Evidence (fill before merging final commit)

- [ ] parity/border/determinism test run
- [ ] perf:main flag on/off (frameMs p50/p95, renderMs p95, top bucket)
- [ ] perf:move route with counters (`heightfield_tiles_*`, `live_clod_stream_worker_build_ms_l*`)
- [ ] cold vs warm (store-hit) tile latency numbers
- [ ] acceptance --reuse green with flag off (default) and on
