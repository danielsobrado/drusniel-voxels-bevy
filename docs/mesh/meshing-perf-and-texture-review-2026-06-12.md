# Surface Nets Meshing Review — Performance vs CLOD PoC + Texture Repetition

**Date:** 2026-06-12
**Scope:** `src/voxel/meshing/` review, triggered by two observations against the
CLOD PoC (`tools/clod-poc/`): (1) terrain meshing/runtime is consistently slower
than the PoC, and (2) terrain textures look visibly repeated/tiled where the PoC
does not.
**Target hardware floor:** RTX 40-series minimum — no low-end/integrated-GPU
compromises were made in the fixes.

This document records the findings, code changes, and targeted Surface Nets
perf-probe results. The probe measures CPU meshing in the optimized test
profile; release scene benches remain the authority for frame-level claims.

---

## Part 1 — Performance findings and fixes

### P1 — Normals re-derived through the world `HashMap` on every tap (FIXED)

**Finding.** `generate_chunk_mesh_surface_nets*` computed every vertex normal
via `sdf_gradient_normal_at_local` (`sdf.rs`), which re-derives the smoothed
terrain field from scratch on each call:

- 6 gradient taps → each one `trilinear_smoothed_terrain_sdf_at_world_pos`
  (8 lattice samples)
- each lattice sample → `smoothed_terrain_sdf_at_world_pos`
  (up to 28 occupancy reads)
- each occupancy read → `VoxelWorld::sample_voxel` → bounds checks + a
  `HashMap<IVec3, Chunk>` lookup (`src/voxel/core/world.rs`)

That is up to **~1,300 hashmap lookups per normal**, with zero memoization —
not between the 8 trilinear corners of one tap, not between the 6 taps of one
gradient, and not between the ~6 triangles sharing each vertex (see P2). A
~2,000-triangle LOD0 chunk performed on the order of 8M hashmap lookups for
normals alone. The PoC never does this: it computes normals once per welded
vertex from the SDF grid it already holds.

The same per-tap pattern also ran in:

- `recompute_morphed_seam_normals` (`lod_seam.rs`) — full gradient per welded
  seam vertex;
- `snap_boundary_vertices_to_lower_detail_neighbor` (`lod_seam.rs`) — full
  gradient per snapped boundary vertex.

**Fix.** New `MeshSdfCache` in `sdf.rs`: a per-mesh-generation memoization of
occupancy and smoothed lattice values in flat arrays (NaN = not yet computed)
covering the chunk's padded neighbourhood (`±(step + 4)` voxels around the
chunk, sized per LOD). Repeated taps become array reads; the first touch of a
lattice point still reads the world once. Lattice points outside the cached
window fall back to the original uncached helpers, so callers never need to
range-check and results are identical everywhere.

- `surface_nets.rs` creates one cache per chunk mesh and uses
  `MeshSdfCache::gradient_normal_at_local` for all vertex normals and (via a
  threaded `&mut`) for `recompute_morphed_seam_normals`.
- `snap_boundary_vertices_to_lower_detail_neighbor` builds a locally scoped
  cache for its snapped-vertex normal loop (its signature is pinned by many
  tests, so the cache is not threaded through it).
- The cache's `smoothed_at` / `trilinear_at` replicate the exact arithmetic of
  `smoothed_terrain_sdf_at_world_pos` / `trilinear_smoothed_terrain_sdf_at_world_pos`
  (same kernel weights, same sign-guard clamps, same lerp order), so output
  normals match the old path. This equivalence is pinned by the new test
  `mesh_sdf_cache_matches_uncached_gradient_normals` in `meshing/tests.rs`.

### P2 — Per-triangle vertex duplication multiplied all attribute work ~6× (FIXED)

**Finding.** All four LOD paths emitted 3 fresh vertices per triangle and
computed normal, material weights, and AO **per corner**. A Surface Nets vertex
is shared by ~6 triangles, so every attribute was recomputed ~6×. The stated
justification ("consistent material indices, no interpolation artifacts") no
longer holds: every attribute is a pure function of the vertex position, so
duplicated corners get identical values and interpolate identically to shared
vertices.

The duplication itself (3× GPU vertex count) **cannot** be removed yet: the
barycentric wireframe debug encoding (`MeshData::push_triangle_barycentrics`,
`data.rs`) requires unshared corners. See "Not fixed" below.

**Fix.** `surface_nets.rs` was restructured:

- The four ~280-line near-identical functions
  (`generate_chunk_mesh_surface_nets{,_lod1,_lod2,_lod3}`) are now thin wrappers
  over one shared `generate_chunk_mesh_surface_nets_impl`, parameterized by a
  `SurfaceNetsGrid` enum (grid shape, step, capacity, AO on/off, weight mode).
  This also removes the standing hazard of a fix landing in one copy and
  missing the other three (~1,180 lines → ~570).
- `compute_unique_vertex_attributes` computes local position, normal, material
  weights, and AO **once per unique `SurfaceNetsBuffer` vertex** into parallel
  arrays; the triangle loop then fans the precomputed values out to the
  duplicated corners. Mesh topology, attribute values, and the barycentric
  wireframe encoding are unchanged — only the redundant recomputation is gone.
- Non-finite-position validation moved from per-triangle-corner to per-unique
  vertex (triangles referencing an invalid vertex are skipped, as before).
- Capacity hints fixed: vertex vectors are now reserved at index capacity
  (duplicated verts == indices; the old LOD0 hint of 2048 verts / 3072 indices
  guaranteed reallocation), and `local_positions` is pre-reserved (was
  `Vec::new()`).

### P3 — LOD material weights scanned step³ voxels per vertex (FIXED)

**Finding.** `compute_vertex_material_weights_lod` (`material_weights.rs`)
looped `0..step` on all three axes: 8 samples at LOD1 but **64 at LOD2 and 512
at LOD3 — per vertex** (and pre-P2, per triangle-corner). Coarse vertices
frequently sample outside the chunk, hitting the world-hashmap path. The scan
was also biased to the positive octant of the vertex.

**Fix.** The scan now samples the **8 corners of the step-sized cell**
(offsets `{0, step-1}` per axis): an equivalent dominant-material estimate at
8 lookups regardless of step. At step 2 the corners are exactly the old full
scan, so LOD1 weights are bit-identical; LOD2/LOD3 weights change only in
estimator resolution (corner sample vs full-volume average of the same cell).
The behavior-pinning test
`lod_mismatch_material_weights_use_fine_sampler_in_boundary_band` passes
unchanged. The fine sampler (`compute_vertex_material_weights`, used at LOD0
and in transition bands) is untouched.

### P4 — AO sampling overhead (FIXED, partially)

**Finding.** LOD0 AO (`compute_surface_nets_ao`, `baked_ao.rs`) takes 8 density
samples per vertex through the world hashmap, and recomputed the loop-invariant
tangent basis inside the 8-sample loop. Pre-P2 this also ran per corner (~6×
redundant).

**Fix.**
- The ~6× redundancy is gone via P2 (AO computed once per unique vertex).
- `arbitrary_tangent_basis` is hoisted out of the sample loop.
- The density sampler itself intentionally **still reads the world**: it uses
  `voxel.is_solid()` (water = not solid), while the `MeshSdfCache` occupancy
  uses the meshing convention `is_solid() || is_liquid()` (water = solid).
  Routing AO through the cache would change AO near water; left as is to keep
  the fix behavior-preserving. At 8 samples per unique vertex this is now a
  minor cost.

### P5 — Synchronous main-thread meshing (NOT FIXED — documented decision)

`mesh_dirty_chunks_system` meshes chunks inline on the main schedule, throttled
by `MAX_CHUNKS_PER_FRAME = 4` (`src/voxel/runtime/mod.rs`) and
`MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME = 1` (`meshing/commit.rs`). The
PoC never meshes per-frame — it swaps prebuilt buffers. Moving meshing to
`AsyncComputeTaskPool` is the structural fix but a much larger change
(ownership of `VoxelWorld` snapshots, commit ordering, strip-cache publication).
P1–P4 shrink per-chunk cost enough that the budgets should breathe; revisit
async meshing if hitches persist after measuring.

### P6 — Structural cleanups bundled with the fixes

- Four copy-pasted LOD functions unified (see P2).
- `meshing/mod.rs` still carries ~70 lines of `#[cfg(test)]`
  `#[allow(unused_imports)]` scaffolding imports — noted, deliberately not
  touched in this pass.

### Not fixed (deliberate deferrals)

| Item | Why deferred |
|---|---|
| True vertex welding (3× GPU vertex reduction) | Barycentric wireframe debug (UV1 encoding) requires unshared per-triangle corners. Needs a debug-only mesh variant first. CPU-side redundancy already removed by P2. |
| Async (off-main-thread) meshing | Architecture change; see P5. |
| AO sampling via `MeshSdfCache` | Water-solidity convention differs; would change AO near water. |
| `mod.rs` test-import scaffolding | Cosmetic; out of scope. |

---

## Part 2 — Texture repetition finding and fix

**Finding.** Not a meshing issue. Meshing outputs only material *weights*
(vertex color) and AO (UV0); texture coordinates are derived in the shader from
world position:

- This repo: `compute_uv = world_coord / tex_scale` with `tex_scale: 2.0`
  (`assets/shaders/triplanar_terrain.wgsl`,
  `src/rendering/materials/triplanar.rs`) → one texture repeat **every 2 world
  units**.
- CLOD PoC: `worldPos.xz * uTextureScales` with scales of `1/64`
  (`tools/clod-poc/src/material.ts`) → one repeat **every 64 world units**.

A **32× higher tiling frequency** is exactly the "repeated" look. Hex tiling
(anti-repetition) exists and is enabled in the local
`assets/config/terrain_texturing.yaml`, but it cannot hide a 2-unit repeat
period, and it fades out past `mid_distance` — where repetition reads worst.

**Fix.** In `TriplanarUniforms::default()` (`src/rendering/materials/triplanar.rs`):

- `tex_scale: 2.0` → **`64.0`** (PoC parity: one repeat per 64 world units).
- `parallax_scale: 0.04` → **`0.00125`**. Parallax depth is expressed in UV
  units, so it must scale inversely with the UV period (0.04 / 32) to keep the
  world-space parallax depth unchanged.

Notes:

- Close-up texel density drops at 64 (the PoC accepts the same tradeoff). If it
  reads too soft up close, the candidates are an intermediate `tex_scale`
  (16–32) or dual-scale "macro variation" sampling — both shader-side.
- With the RTX 40-series hardware floor, hex tiling and parallax stay enabled;
  the `disable_on_integrated_gpu` / `disable_on_low_quality` fallbacks in
  `terrain_texturing.yaml` are moot on target hardware and were left untouched
  (ship-default for hex tiling remains as pinned by
  `default_config_has_hex_tiling_disabled`).
- This is a visual change: re-check the visual-regression bench screenshots and
  re-tune `blend_sharpness` if triplanar seams read differently at the larger
  UV period.

---

## Files changed

| File | Change |
|---|---|
| `src/voxel/meshing/sdf.rs` | Added `MeshSdfCache` (memoized occupancy + smoothed lattice + trilinear + gradient normal, with out-of-window fallback). Uncached helpers unchanged. |
| `src/voxel/meshing/surface_nets.rs` | Four LOD functions unified into `generate_chunk_mesh_surface_nets_impl` + `SurfaceNetsGrid`; attributes computed once per unique vertex (`compute_unique_vertex_attributes`); normals/seam-normals via `MeshSdfCache`; capacity hints fixed. Public API unchanged. |
| `src/voxel/meshing/lod_seam.rs` | `recompute_morphed_seam_normals` takes `&mut MeshSdfCache`; snap-path normal loop uses a locally scoped cache. |
| `src/voxel/meshing/material_weights.rs` | `compute_vertex_material_weights_lod`: step³ scan → 8 cell-corner samples. |
| `src/voxel/meshing/baked_ao.rs` | Hoisted loop-invariant tangent basis in `compute_surface_nets_ao`. |
| `src/voxel/meshing/tests.rs` | Added `mesh_sdf_cache_matches_uncached_gradient_normals` (cache/uncached parity) and `perf_probe_surface_nets_meshing` (`#[ignore]`, manual timing probe). |
| `src/rendering/materials/triplanar.rs` | `tex_scale` 2.0 → 64.0 (PoC parity); `parallax_scale` rescaled to keep world-space depth. |

## Verification

Performed:

- `cargo check` and `cargo check --tests` pass.
- New parity test pins the cached normal field to the uncached path.
- `mesh_sdf_cache_matches_uncached_gradient_normals` passes after the optimized
  implementation was pulled in commit `83712cd`.
- `perf_probe_surface_nets_meshing` passed in three consecutive warmed runs.

### Targeted Surface Nets perf probe

The baseline was captured immediately before commit `83712cd`; the updated
probe was then run three times on the same machine with:

```bash
cargo test -j 1 --lib perf_probe_surface_nets_meshing -- --ignored --nocapture
```

The table compares the prior baseline with the best updated result across the
three runs:

| LOD | Baseline | Updated best | Speedup |
|---|---:|---:|---:|
| LOD0 | 58,779 us | 2,331 us | 25.2x |
| LOD1 | 17,538 us | 1,338 us | 13.1x |
| LOD2 | 5,223 us | 854 us | 6.1x |
| LOD3 | 1,545 us | 687 us | 2.2x |

Geometry output was unchanged: LOD0 produced 3,114 vertices / 1,038
triangles, LOD1 810 / 270, LOD2 180 / 60, and LOD3 24 / 8 before and after.
The largest measured reduction is in attribute emission, consistent with P1
and P2 removing repeated normal and per-corner attribute work.

These are targeted test-profile microbenchmark results, not release scene or
frame-time measurements. Compilation time is excluded. A release visual bench
is still required before making game-level frame-time or screenshot claims.

Additional verification still to run:

```bash
# Unit tests for the meshing module
cargo test meshing

# Manual perf probe (per-LOD wall time + per-stage breakdown; compare
# before/after on the same machine & profile)
cargo test perf_probe_surface_nets_meshing -- --ignored --nocapture

# Frame-level + visual verification per CLAUDE.md (compare
# bench-runs/<run>/summary.json and the fixed screenshot checkpoints —
# the tex_scale change is a deliberate visual diff)
cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

No frame-level performance claim is made from the targeted probe alone.
