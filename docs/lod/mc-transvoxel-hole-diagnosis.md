# MC + Transvoxel Hole Diagnosis Log

Last updated: 2026-05-24

This file tracks the active MC+Transvoxel hole investigation. It is intentionally
evidence-first: keep failed hypotheses, commands, probe IDs, and fixed repro
coordinates here so the next debugging pass does not restart from screenshots.

## Current visible failure

MC+Transvoxel still shows black missing-terrain patches and seam bands on the
mountain, including:

- broad dark bands at LOD transition altitudes,
- smaller holes inside steep LOD1 mountain faces,
- failures visible in normal/debug views as missing geometry rather than only
  a lighting/material issue.

The latest bench screenshot inspected was:

- `bench-runs/2026-05-24T05-43-24Z/visual-regression-ridge-run-noon-mid-run0.png`

It still showed black/missing patches on the mountain after the SDF sign clamp
and scheduler max-one refinement change.

## Changes tested in this pass

### LOD1+ SDF smoothing sign clamp

Files:

- `src/voxel/meshing.rs`

Change:

- Added `SDF_SIGN_GUARD`.
- Added `preserve_sdf_sign(raw, candidate)`.
- Applied it inside `smooth_lod_sdf_interior`.
- Changed the neighbor sign check to match MC case selection semantics:
  `< 0.0` is solid; `0.0` is air/non-solid.

Regression tests added:

- `smooth_lod_sdf_interior_preserves_air_sign_near_solids`
- `smooth_lod_sdf_interior_preserves_solid_sign_near_air`
- `smooth_lod_sdf_interior_treats_zero_as_air_for_mc_case_sign`

Verification:

```powershell
rtk cargo test --lib smooth_lod_sdf_interior
rtk cargo test --lib --features mc_transvoxel smooth_lod_sdf_interior
```

Result:

- Passed.
- This fixed a real source bug, but it did not remove the visible holes.

### Visible MC+Transvoxel LOD-delta counter

Files:

- `src/interaction/debug.rs`

Change:

- F3 chunk stats now include:
  - `MC+TVX: meshed/frame=...`
  - `lod_delta_gt_one_skips=...`

Purpose:

- Separate scheduler/LOD seam skips from deterministic mesher/SDF failures in
  live runs.

### Scheduler max-one refinement rule

Files:

- `src/voxel/plugin.rs`

Change:

- Reworked `enforce_lod_delta_max_one` to refine the coarser side of a violating
  face-adjacent LOD pair, instead of pulling either side toward the midpoint.
- This preserves the high-detail side and produces bridgeable chains such as
  `Lod0 -> Lod1 -> Lod2`.

Regression tests added:

- `enforce_lod_delta_max_one_refines_coarser_side_only`
- `enforce_lod_delta_max_one_propagates_refinements_across_chain`

Verification:

```powershell
rtk cargo test --lib enforce_lod_delta_max_one
rtk cargo test --lib --features mc_transvoxel enforce_lod_delta_max_one
```

Result:

- Passed.
- This is a correct scheduler/coherence fix, but it did not remove the visible
  static mountain holes in the visual bench.

## Bench and guard evidence

Post-change visual bench:

```powershell
rtk cargo run --release --features mc_transvoxel -- --bench bench/scenes/visual/visual-regression.toml
```

Artifact:

- `bench-runs/2026-05-24T05-43-24Z/summary.json`

Guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/2026-05-24T05-43-24Z/summary.json
```

Result:

- `bench_guard` failed the established total-frame avg/p99 rows.
- `Mesh Dirty:p99` passed:
  - ridge: `0.175 ms`
  - jump: `0.214 ms`
  - forest: `0.457 ms`
- GPU opaque rows passed.
- This run is not a performance sign-off.

Visual result:

- The ridge screenshot still shows missing black terrain patches.
- The current visible defect is therefore not resolved by the SDF sign clamp or
  by the max-one scheduler refinement.

## Canonical manual static repro

Source dump:

- `debug/terrain-hole-probe-20260524-022032.json`

Trigger:

- Manual `Shift+F9`.

Camera:

```text
camera_world_position = (285.84256, 38.747417, 144.33394)
camera_ray.direction  = (-0.97716266, -0.02399765, -0.21113348)
camera_ray.max_distance = 512.0
```

Player:

```text
player_world_position = (285.84256, 37.047417, 144.33394)
```

Target voxel:

```text
target_voxel_position = (108, 34, 106)
target_voxel_type = TopSoil
target_chunk_position = (6, 2, 6)
target_local_voxel_position = (12, 2, 10)
```

Camera ray:

```text
first_voxel_solid_distance = 181.0
last_voxel_solid_distance = 224.75
first_front_render_hit.distance = 181.18588
first_front_render_hit.point = (108.79448, 34.399384, 106.07953)
first_front_render_hit.chunk_position = (6, 2, 6)
first_front_render_hit.triangle_start_index = 630
see_through_gap = null
```

Probe interpretation:

- The selected local neighborhood was LOD-converged at mesh time.
- Nearby MC chunks reported `skipped_lod_delta_gt_one = 0`.
- Many LOD1 chunks had no transition triangles because their face neighbors
  were same or finer LOD, which is expected for the coarser side.
- The persistent visible issue is now more likely in regular MC/transition
  geometry generation or table interpretation than in the scheduler alone.

## Ruled down or falsified in this pass

| Hypothesis | Result |
| --- | --- |
| LOD1+ `smooth_lod_sdf_interior` sign flips are the visible root cause | Real bug fixed and tests pass, but visual holes remain. |
| Scheduler midpoint max-one rule is enough to close the seam | Coherence rule improved and tests pass, but visual holes remain. |
| The current bench failure is a mesh-dirty performance regression from this pass | Guard still fails frame avg/p99, but Mesh Dirty rows pass; no improvement claim. |
| Current static mountain holes are explained only by `lod_delta_gt_one` skipped transition faces | The canonical manual probe shows nearby `skipped_lod_delta_gt_one = 0`; still keep the F3 counter for live confirmation. |

## Active hypotheses

1. Regular MC is producing bad or missing topology on steep low-LOD terrain.
2. Transition-cell table interpretation or face-frame mapping is wrong on at
   least one axis/sign.
3. Transition triangles are emitted but not tagged into mesh-section stats,
   making probe interpretation harder.
4. The MC path may be using the Transvoxel table endpoint encoding incorrectly
   for edge interpolation or vertex ordering.
5. There may still be a stale-build/config mismatch during manual testing; the
   startup build tag now exists to reduce this ambiguity.

## Repro automation target

Added in this pass:

- `TerrainHoleProbeRequests` in `src/voxel/hole_probe.rs`, so code can request
  the same JSON dump as `Shift+F9` without keyboard input.
- `hole_probe = { ... }` support in bench checkpoints.
- A fixed repro bench scene:
  `bench/scenes/visual/mc-transvoxel-static-hole-probe.toml`

Run it with:

```powershell
rtk cargo run --release --features mc_transvoxel -- --bench bench/scenes/visual/mc-transvoxel-static-hole-probe.toml
```

Expected outputs:

- `bench-runs/<run>/summary.json`
- fixed camera screenshots for the `probe` and `end` screenshot points
- labelled probe dump:
  `debug/terrain-hole-probe-mctx-static-mountain-hole-<timestamp>.json`

The scripted repro does this:

1. Start MC+Transvoxel in `replace_surface_nets` mode.
2. Place the camera/player at the recorded position.
3. Aim along the recorded camera ray direction.
4. Use the recorded target voxel `(108, 34, 106)` for the same probe center.
5. Wait until terrain LOD/meshing is settled.
6. Write a deterministic hole-probe JSON without requiring a physical
   `Shift+F9` keypress.
7. Diff normalized fields across runs:
   - target chunk and target voxel,
   - per-chunk logical/effective LOD,
   - neighbor LODs at mesh time,
   - MC transition face counts,
   - skipped LOD-delta counts,
   - camera-ray first solid and first render hit,
   - render-grid signed surface errors,
   - mesh triangle counts for chunks in the target neighborhood.

The goal is a repeatable command that can be run after every candidate fix, so
we can compare the same failing camera/probe case without manual screenshots.

### Verified scripted repro runs

First scripted run after adding the bench hook:

- Bench summary:
  `bench-runs/2026-05-24T06-21-10Z/summary.json`
- Probe screenshot:
  `bench-runs/2026-05-24T06-21-10Z/mc-transvoxel-static-hole-probe-mctx-static-mountain-hole-probe-run0.png`
- End screenshot:
  `bench-runs/2026-05-24T06-21-10Z/mc-transvoxel-static-hole-probe-mctx-static-mountain-hole-end-run0.png`
- Probe dump:
  `debug/terrain-hole-probe-mctx-static-mountain-hole-20260524-062226.json`

Second scripted run:

- Bench summary:
  `bench-runs/2026-05-24T06-25-31Z/summary.json`
- Probe dump:
  `debug/terrain-hole-probe-mctx-static-mountain-hole-20260524-062648.json`

Both runs produced the same normalized diagnostic signature:

```text
target_voxel_position = (108, 34, 106)
target_chunk_position = (6, 2, 6)
target_voxel_type = TopSoil
classification.world_data_hole = false
classification.mesh_missing = false
classification.mesh_surface_mismatch = false
classification.expected_surface_y = 35.0
classification.render_mesh_ray_hit_y = 34.419
camera_ray.first_voxel_solid_distance = 180.0
camera_ray.first_front_render_hit.distance = 181.07278
camera_ray.see_through_gap.gap_length = 1.07278
camera_ray_fan.rays_total = 81
camera_ray_fan.rays_with_gap = 33
```

Important caveat:

- Raw probe dumps are not intended to be byte-identical because they contain
  timestamps, entity IDs, generation timings, and potentially ordering-sensitive
  diagnostic detail.
- Compare normalized fields instead: target, chunk, logical/effective LOD,
  neighbor LODs, transition counts, skipped LOD-delta counts, camera-ray
  distances, and fan gap groups.
- The latest two scripted runs had identical normalized fields for those
  comparison categories.

Bench-mode physics note:

- The scripted probe currently runs without `SpatialQuery`, so
  `physics_hit_y = null`, `collider_pending = true`, and
  `collider_surface_mismatch = true` are not useful evidence for the meshing
  bug in this bench.
- The useful evidence from this repro is the render/voxel comparison:
  the camera ray and fan enter solid voxel data before the first front-facing
  render triangle, repeatedly, at the same camera pose.

Stable gap grouping from the repeated runs:

- The center camera ray lands in chunk `(6, 2, 6)`, `Lod1`, with neighbors
  `pos_x = Lod0` and `neg_y = Lod0`, `skipped_lod_delta_gt_one = 0`, and
  `transition_triangles_total = 0` for that chunk's recorded mesh stats.
- The 33 fan gaps include both LOD-transition-adjacent chunks and all-LOD0
  chunks. That means the remaining issue is not proven to be only transition
  stitching; regular MC topology on steep terrain is still a live suspect.

Normalization note:

- Ignore volatile fields when diffing: `timestamp_utc`, entity generation IDs,
  `generated_frame`, and wall-clock timing fields.
- Treat stable fields as regression checks: target voxel/chunk, LOD states,
  neighbor LODs, transition counts, skipped-delta counts, camera-ray distances,
  signed surface errors, and per-chunk triangle counts.
