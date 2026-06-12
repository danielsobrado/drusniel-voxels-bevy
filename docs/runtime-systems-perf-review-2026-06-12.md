# Runtime Systems Review — `src/voxel` (broad) + `src/rendering`

**Date:** 2026-06-12
**Scope:** Per-frame runtime systems in `src/voxel/` (LOD, visibility, occlusion,
enclosure, water bodies, generation, scheduling, chunk storage) and
`src/rendering/` (materials sync, water reflection, GI subsystems). Follow-up to
the Surface Nets meshing review
([meshing-perf-and-texture-review-2026-06-12.md](mesh/meshing-perf-and-texture-review-2026-06-12.md)).
**Target hardware floor:** RTX 40-series minimum.

This document records the findings and the code changes applied for each.
Performance numbers are measured externally (bench scenes + perf probes); this
doc documents **code changes only** and claims no numbers.

---

## Findings and fixes

### V1 — Water-shore LOD guard scanned every voxel of every chunk (FIXED)

**Finding.** `collect_water_shore_lod_guard_chunks` (`src/voxel/lod/mod.rs`)
runs inside `update_chunk_lod_system` (up to 4 Hz while the camera moves or
chunks are arriving) and called `chunk_contains_liquid` on **every loaded
chunk**. That helper was an open-coded 16³ = 4,096-voxel loop; chunks with no
liquid — the overwhelming majority, including all-air sky chunks — scanned all
4,096 voxels before returning false. At ~10k loaded chunks that is on the order
of 40M voxel reads per LOD pass. The "LOD Guard CPU" timing row isolates this
cost in bench runs.

**Fix.** The answer is now memoized on the chunk:

- `Chunk` gains a `contains_liquid_cache: AtomicU8`
  (`LIQUID_UNKNOWN`/`NO`/`YES`) and a `contains_liquid()` method
  (`src/voxel/core/chunk.rs`). First call after a mutation scans the 4,096
  voxels once; subsequent calls are a single relaxed atomic load. Atomic (not
  `Cell`) so the lazy fill works through `&Chunk` during the whole-world scan
  while `VoxelWorld` stays `Sync`.
- The cache is invalidated exactly where `uniformity` is invalidated (`set`,
  `try_set` — only mutation paths that touch `voxels`), starts as `NO` for
  `Chunk::new` (all air) and `UNKNOWN` for `with_voxels` / the persistence
  constructor.
- `chunk_contains_liquid` in `lod/mod.rs` now delegates to the chunk method.

Steady state, the per-LOD-pass cost drops from ~4,096 reads × chunk count to
one atomic load × chunk count; the full scan re-runs only for chunks that were
actually edited.

### V2 — Water-body registry throttle was bypassed during world churn (FIXED)

**Finding.** `update_water_body_registry`
(`src/voxel/runtime/water_bodies.rs`) skipped work on a 0.5 s interval **unless
`world.is_changed()`**. `VoxelWorld` is a `ResMut` in several every-frame
systems, so during generation, edits, or LOD churn — exactly the busiest
frames — the full registry rebuild (water-mesh entity scan, body BFS grouping,
per-body world sampling) ran every frame instead of twice a second.

**Fix.** The `!world.is_changed()` bypass is removed; the interval throttle is
now unconditional. A registry that is up to 0.5 s stale only delays water
material/kind selection, which already has hysteresis downstream.

### V3 — Chunk storage hashed with SipHash (FIXED)

**Finding.** `VoxelWorld` stored `chunks: std::collections::HashMap<IVec3,
Chunk>` (plus the dirty sets). Every `sample_voxel` everywhere in the engine —
collision, water meshing, AO, generation halo checks, and whatever cache misses
remain after the meshing fixes — funnels through `chunks.get(&chunk_pos)` and
paid std's DoS-resistant SipHash per lookup.

**Fix.** `src/voxel/core/world.rs` now uses
`bevy::platform::collections::{HashMap, HashSet}` (hashbrown + foldhash) for
the chunk map and dirty sets. API-compatible swap; no call sites changed. DoS
resistance is irrelevant for chunk coordinates.

### R1 — Weather sync dirtied every terrain material every frame (FIXED)

**Finding.** `update_weather_runtime`
(`src/world/environment/weather/plugin.rs`) called `runtime.advance(...)`
through `ResMut<WeatherRuntime>` unconditionally every frame. Bevy change
detection is deref-based, so `WeatherRuntime` read as changed **every frame,
even with weather fully idle**. Downstream, `sync_weather_to_materials`
(`src/rendering/materials/mod.rs`) — guarded by `weather.is_changed()`, with a
comment explaining that `get_mut` on an asset forces a bind-group rebuild —
then mutated all 9 triplanar material variants plus the blocky material every
frame, forcing per-frame asset re-extract and uniform/bind-group re-preparation
for every terrain material. The neighbouring water/hex-tiling syncs are guarded
correctly; this one was defeated upstream.

Notably, `WeatherRuntime::advance` **already returned a bool** reporting
whether the uniforms/quality actually changed — the system ignored it.

**Fix.** `update_weather_runtime` now writes through
`runtime.bypass_change_detection()` and calls `runtime.set_changed()` only when
`advance` reports a real change. While rain/snow/wetness transitions are active
the uniforms change every frame (`time` ticks) and behavior is identical; when
idle, no change flag is raised and the material sync early-outs as its guard
intended. The only `is_changed()` consumer is `sync_weather_to_materials`;
other readers (god rays) read values directly and are unaffected.

### Minor — per-frame env var read in water reflection (FIXED)

`update_water_reflection_camera` checked
`env_flag("VOXEL_FORCE_WATER_REFLECTION_ACTIVE")` via `std::env::var_os` every
frame, taking the process env lock on a hot system
(`src/rendering/water/reflection.rs`). Now read once and cached in a
`OnceLock`, matching the pattern used elsewhere (e.g. the meshing env gates in
`sdf.rs`). The same pattern exists in `forced_water_body_kind`
(`water_bodies.rs`), but after V2 that runs at most twice a second — left as
is.

---

## Reviewed and found sound (no change)

| Area | Why it's fine |
|---|---|
| Occlusion BFS (`culling/occlusion.rs`) | Interval-throttled, dominance dedup per (chunk, face), state + chunk caps, fail-open on overflow. |
| Enclosure detection (`culling/enclosure.rs`) | Interval-throttled with wall-time hysteresis. |
| Face visibility (`runtime/visibility.rs`) | Dirty-flag driven, scan cadence matched to its consumer interval. |
| Chunk LOD update (`runtime/visibility.rs`) | 4 Hz throttle, camera-moved + chunk-count gating, hysteresis, cooldowns, change cap per pass. Two whole-world HashMaps are rebuilt per scan — acceptable at this cadence; reusable buffers only if profiles say otherwise. |
| Dirty-mesh scheduling (`runtime/mesh_scheduler.rs`) | Dirty sets, not scans; camera-distance prioritization; per-frame budgets. |
| Chunk generation (`runtime/generation.rs`) | Already async on `AsyncComputeTaskPool` with batched spawning — also the in-repo pattern to copy for the deferred async-meshing work. |
| Water material / hex-tiling / terrain material LOD syncs (`rendering/materials/mod.rs`, `mesh_scheduler.rs`) | Properly `is_changed()`-guarded or interval-throttled. |
| Water reflection activation (`rendering/water/reflection.rs`) | Deactivates with no water visible/eligible/in range; supports update-interval throttling. |
| naadf uploads (`rendering/naadf/build/prepare.rs`) | Budgeted by chunk count and bytes per frame. |
| Timing recorder (`src/diagnostics/timing.rs`) | Early-outs when disabled; string/BTreeMap costs are bench-only. |

## Context (not a bug): PoC comparisons are apples-to-oranges by default

The full app ships with radiance cascades GI enabled by default
(`RadianceCascadesConfig { enabled: true }`), the naadf voxel-ray backend (a
default Cargo feature), GTAO, god rays, water reflection cameras, weather, and
shadows. The CLOD PoC draws one welded mesh with a hemisphere-light shader and
no post-processing. When measuring "this engine vs the PoC," use
`BenchRenderToggles` to switch the extra passes off so terrain-pipeline numbers
are isolated; otherwise terrain improvements will look smaller than they are.

---

## Files changed

| File | Change |
|---|---|
| `src/voxel/core/chunk.rs` | `contains_liquid_cache: AtomicU8` + memoized `contains_liquid()`; invalidation in `set`/`try_set`; initialization in all three constructors. |
| `src/voxel/lod/mod.rs` | `chunk_contains_liquid` delegates to the memoized chunk method (removed the open-coded 16³ scan); dropped orphaned imports. |
| `src/voxel/runtime/water_bodies.rs` | Removed the `world.is_changed()` throttle bypass; interval-only. |
| `src/voxel/core/world.rs` | Chunk map + dirty sets switched from `std::collections` (SipHash) to `bevy::platform::collections` (foldhash). |
| `src/world/environment/weather/plugin.rs` | `update_weather_runtime` writes via `bypass_change_detection()`, marks changed only when `advance` reports a change. |
| `src/rendering/water/reflection.rs` | `VOXEL_FORCE_WATER_REFLECTION_ACTIVE` read once via `OnceLock` instead of per frame. |

## Verification

Performed:

- `cargo check` and `cargo check --tests` pass.

To be run externally (results not in this doc):

```bash
# Unit tests
cargo test

# Frame-level comparison per CLAUDE.md — compare bench-runs/<run>/summary.json
# before/after. Rows expected to move: "LOD Guard CPU", "LOD Update",
# "Material Sync Weather", water-body counters; plus general frame time.
cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Behavioral notes for the test pass:

- V1: liquid answers are identical; only memoized. If a future mutation path
  writes `Chunk::voxels` without going through `set`/`try_set`, it must also
  reset `contains_liquid_cache` (same contract as `uniformity`).
- V2: water body kind/material reactions can lag up to 0.5 s where they were
  previously same-frame during world churn.
- R1: weather visuals are unchanged while any rain/snow/wetness transition is
  active (uniforms change every frame then); idle frames no longer re-upload
  terrain materials.

No performance numbers are claimed in this document; these changes were not
benchmarked at the time of writing.
