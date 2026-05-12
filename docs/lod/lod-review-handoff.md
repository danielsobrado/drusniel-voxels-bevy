# LOD Review Handoff

Date: 2026-05-12

This file captures the interrupted follow-up to an external LOD subsystem review. No code changes were made before this handoff.

## Current State

- Branch: `main`
- Worktree was clean before this file was added.
- A release visual-regression baseline was started with:

```bash
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

- The run was stopped before completion at the user's request to create this handoff.
- Partial run directory observed: `bench-runs/2026-05-12T11-55-05Z`
- The partial run did not produce a `summary.json` before it was stopped.
- Captured log path on the original machine: `/tmp/drusniel-lod-baseline.log`

## Baseline Bench Notes

The partial baseline showed pre-existing bench/runtime issues:

- Missing vegetation/prop assets, including several `ultimate_stylized_nature` `.gltf` files and custom plant `.glb` files.
- Integrated GPU constraints prevented bench render features such as `gtao=true` and later `ssao=true`.
- Several checkpoints hit readiness and render-ready timeouts.
- Some screenshots were not written before bench timeout and were recorded as null.

Because the bench was interrupted and timed out before completion, do not treat it as a valid before/after performance baseline.

## Review Findings Checked So Far

Confirmed:

- LOD surface-nets meshing has substantial duplication across `generate_chunk_mesh_surface_nets_lod1`, `generate_chunk_mesh_surface_nets_lod2`, and `generate_chunk_mesh_surface_nets_lod3` in `src/voxel/meshing.rs`.
- The LOD SDF generation functions are similarly duplicated for LOD1, LOD2, and LOD3.
- The skirt depth table is duplicated in all four surface-nets mesh paths.
- `LodLevel::Culled.step_size()` returns `0`; current callers guard with `.max(1)` where needed, so this is not currently a crash bug.
- `NeighborLods` tracks only horizontal neighbors and the LOD dirty propagation only marks horizontal neighbors.
- Prop decimation cache/types exist, but no runtime system was found that swaps `MeshLod` mesh handles by camera distance.

Incorrect or overstated:

- The claim that LOD0 treats water differently from LOD1+ was wrong in the current tree. `sample_voxel_solid()` already treats `voxel.is_solid() || voxel.is_liquid()` as SDF-solid for LOD0, matching `sample_voxel_at_world_pos()`.
- The LOD2 stability calculation in the review was partially contradictory. With default distances, Lod2 has a 36m outward transition band, not zero width. The real risk is still valid for tighter custom distances because there is no clamp/validation around `high_detail_distance` and `cull_distance`.
- LOD3 full-cell sampling is real, but it is a performance tradeoff, not yet a measured defect. Do not change it without a release bench comparison and screenshot review.

## Recommended Next Patch

Keep the first code patch narrow:

1. Extract a shared helper in `src/voxel/meshing.rs`:
   - `fn skirt_depth_for_lod(lod: LodLevel) -> f32`
   - Use it in every surface-nets mesh path.

2. Extract a generic low-LOD SDF helper that preserves current behavior:
   - Keep fixed array wrappers if that is simplest for `fast_surface_nets`.
   - Replace duplicated triple loops with one helper that receives padded size, step size, and an index function or writes through a callback.
   - Do not change water semantics or density sampling.

3. Add a guard for invalid/tight LOD distances:
   - Prefer clamping in debug UI after sliders mutate `LodSettings`.
   - Add a pure helper test around the invariant so future preset changes cannot collapse all hysteresis bands silently.
   - Use `TERRAIN_LOD_HYSTERESIS` in the invariant.

4. Leave these as follow-up tasks unless explicitly requested:
   - Runtime prop mesh-decimation switching.
   - Vertical neighbor LOD/skirt support.
   - Sparse LOD3 sampling.
   - Changing `Culled.step_size()` to `Option<u32>`.

## Verification To Run Later

After code changes:

```bash
rtk cargo test meshing::tests::lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample
rtk cargo test voxel::plugin::tests
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

Then inspect:

- `bench-runs/<run>/summary.json`
- Fixed checkpoint screenshots from the bench output
- Relevant render timing rows and counters

If the change touches known bottlenecks or claims performance improvement:

```bash
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Report any bench readiness timeouts or missing screenshots plainly.
