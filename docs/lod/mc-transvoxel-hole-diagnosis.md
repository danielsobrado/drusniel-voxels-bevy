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

## Mesh forensics pass

Implemented after the deterministic repro showed the SDF sign clamp and
scheduler refinement did not remove the visible mountain holes.

New probe evidence:

- `camera_ray.first_any_render_hit`
- `camera_ray.first_backface_render_hit`
- per-hit geometric normal, averaged vertex normal, material weights, and
  `normal_dot_ray`
- MC triangle source for render hits when MC forensics are enabled
- `camera_ray.first_mesher_iso_distance`
- `camera_ray.first_mesher_iso_point`
- `camera_ray.mc_cell`
- `camera_ray.gap_classification`
- the same classification and MC-cell evidence on each fan gap

Classification buckets:

```text
raw_occupancy_vs_mesher_iso_false_positive
geometry_present_but_shading_or_normal_darkening
backface_or_winding
missing_regular_mc_geometry
missing_transition_geometry_or_face_frame
vertex_position_or_table_decode_error
missing_mesh_entity_or_render_layer
unknown
```

MC cell oracle fields now recorded for each source gap:

- effective LOD at mesh time,
- neighbor LODs at mesh time,
- nearest regular MC cell,
- regular case/class index,
- expected regular triangle count,
- actual emitted regular triangle count from `McTriangleSources`,
- boundary faces,
- skipped regular boundary faces,
- transition owner faces,
- transition cell case/class/expected/actual counts for owning faces,
- source chunk `skipped_lod_delta_gt_one`.

Runtime plumbing:

- Added `McTriangleSources` as a separate debug component, not part of
  `TerrainMeshDebug`.
- MC generation only fills sources when bench forensics are enabled.
- Non-MC and non-forensics meshes remove or omit the component.
- Bench forensics overrides can force mesher, LOD, and transition mode before
  initial LOD assignment and during LOD updates.

Isolation bench variants:

```text
bench/scenes/visual/mc-transvoxel-static-hole-probe.toml
bench/scenes/visual/mc-transvoxel-static-hole-probe-surface-nets.toml
bench/scenes/visual/mc-transvoxel-static-hole-probe-all-lod0.toml
bench/scenes/visual/mc-transvoxel-static-hole-probe-all-lod1.toml
bench/scenes/visual/mc-transvoxel-static-hole-probe-no-transitions.toml
bench/scenes/visual/mc-transvoxel-static-hole-probe-all-lod1-no-transitions.toml
```

Verification added:

```powershell
rtk cargo test --lib --features mc_transvoxel forensics
rtk cargo test --lib --features mc_transvoxel ray_triangle_hit_reports_front_and_backface_hits
rtk cargo test --lib --features mc_transvoxel camera_gap_classifies_backface_when_front_hit_is_late
rtk cargo test --lib --features mc_transvoxel mesher_iso_oracle_matches_flat_plane_sdf
rtk cargo test --lib --features mc_transvoxel regular_mc_flat_plane_has_no_ray_gaps
rtk cargo test --lib --features mc_transvoxel regular_mc_diagonal_plane_has_no_ray_gaps
rtk cargo test --lib --features mc_transvoxel sloped_chunk_with_coarser_pos_y_neighbor_emits_transition_triangles
rtk cargo test --lib --features mc_transvoxel hole_probe_checkpoint_config_deserializes
rtk cargo test --lib --features mc_transvoxel forensics_scene_config_deserializes
```

Next acceptance target:

- Run normal MC+Transvoxel fixed repro twice.
- Compare normalized classification counts.
- Confirm every `33 / 81` fan gap has non-`unknown` classification.
- Confirm every classified source chunk records `skipped_lod_delta_gt_one = 0`
  before ruling scheduler out for that gap.
- Then run all-LOD1 and no-transition variants to split regular MC from
  transition face-frame/boundary-row replacement.

### First mesh-forensics repro result

Run:

```powershell
rtk cargo run --release --features mc_transvoxel -- --bench bench/scenes/visual/mc-transvoxel-static-hole-probe.toml
```

Artifacts:

- `bench-runs/2026-05-24T07-55-35Z/summary.json`
- `debug/terrain-hole-probe-mctx-static-mountain-hole-20260524-075652.json`

The shell wrapper returned nonzero because the run output still includes the
known missing prop/billboard asset errors, but the bench did produce summary,
screenshots, CSV, and the labelled probe dump.

Normalized result:

```text
schema_version = 9
camera_ray.first_any_render_hit.distance = 181.07278
camera_ray.first_front_render_hit.distance = 181.07278
camera_ray.first_backface_render_hit.distance = 225.6785
camera_ray.first_mesher_iso_distance = 180.96196
camera_ray.gap_classification = raw_occupancy_vs_mesher_iso_false_positive
camera_ray_fan.rays_total = 81
camera_ray_fan.rays_with_gap = 33
camera_ray_fan.gap_classification counts:
  raw_occupancy_vs_mesher_iso_false_positive = 29
  vertex_position_or_table_decode_error = 4
  unknown = 0
source_chunk_skipped_lod_delta_gt_one values across fan gaps = [0]
```

Interpretation:

- The new evidence rules out GPU culling for the center ray: first-any and
  first-front are the same triangle distance.
- All 33 fan gaps classify as non-unknown in this run.
- Every classified fan-gap source chunk reports `skipped_lod_delta_gt_one = 0`,
  so this fixed-camera result should not trigger more scheduler work.
- Most fan gaps are raw-occupancy-vs-mesher-iso differences, but four LOD0
  interior cells classify as emitted triangles whose ray still misses the
  expected near surface; those are the next concrete mesh-forensics targets.

All-LOD1 isolation run:

- `bench-runs/2026-05-24T07-59-04Z/summary.json`
- `debug/terrain-hole-probe-mctx-static-mountain-hole-all-lod1-20260524-075949.json`

```text
camera_ray.gap_classification = raw_occupancy_vs_mesher_iso_false_positive
camera_ray_fan.rays_total = 81
camera_ray_fan.rays_with_gap = 27
camera_ray_fan.gap_classification counts:
  raw_occupancy_vs_mesher_iso_false_positive = 25
  vertex_position_or_table_decode_error = 2
  unknown = 0
source_chunk_skipped_lod_delta_gt_one values across fan gaps = [0]
```

This is comparable to the normal-LOD run: the dominant bucket remains
raw-occupancy-vs-mesher-iso, with a smaller but persistent set of
vertex-position/table-decode suspects.

### Screenshot-backed mesh oracle pass

Implemented on 2026-05-24 after visual checks still showed the same mountain
defects. This pass keeps scheduler and SDF behavior frozen and sharpens the
probe so a raw voxel gap is not accepted as a visual hole unless the checkpoint
screenshot also supports it.

Additional probe evidence:

- `schema_version = 10`
- multi-chunk `first_mesher_iso_distance` and `first_mesher_iso_point`
- raw-surface MC cell, mesher-iso MC cell, first render-hit source cell, and
  explicit cell agreement flags
- emitted regular and transition triangle vertices for suspicious oracle cells
- ray-hit distance and closest ray-to-triangle miss distance for emitted
  triangles
- first render-hit triangle vertices, source cell, normal data, material
  weights, and distance from mesher iso
- projected screenshot pixels at raw surface, mesher iso, and first render hit
- visual pixel classification: `lit_or_non_dark`, `dark_or_black`, or
  `sky_or_background`

Bench plumbing change:

- Hole probes that need screenshot pixels are deferred until the matching
  checkpoint PNG exists. The request still comes from the configured
  `hole_probe.frame`, but the actual dump can occur during the screenshot
  phase so `visual_samples` are populated instead of `screenshot_unavailable`.

Focused verification passed:

```powershell
rtk cargo test --lib --features mc_transvoxel forensics -j 1
rtk cargo test --lib --features mc_transvoxel mesher_iso_oracle_matches_flat_plane_sdf -j 1
rtk cargo test --lib --features mc_transvoxel regular_mc_flat_plane_has_no_ray_gaps -j 1
rtk cargo test --lib --features mc_transvoxel regular_mc_diagonal_plane_has_no_ray_gaps -j 1
rtk cargo test --lib --features mc_transvoxel screenshot_pixel_sampler_reads_synthetic_fixture -j 1
rtk cargo test --lib --features mc_transvoxel ray_to_emitted_triangle_residual_reports_hit_and_miss -j 1
rtk cargo test --lib --features mc_transvoxel render_hit_source_cell_matches_expected_mc_cell -j 1
rtk cargo test --lib --features mc_transvoxel mesher_iso_crossing_interpolates_across_chunk_sample_boundary -j 1
rtk cargo test --lib --features mc_transvoxel oracle_cell_selection_uses_mesher_iso_point -j 1
```

Isolation matrix result:

| Scene | Probe dump | Fan gaps | Classification counts | Mesher-iso visual pixels | Source chunk `skipped_lod_delta_gt_one` |
| --- | --- | ---: | --- | --- | --- |
| Normal MC+Transvoxel | `debug/terrain-hole-probe-mctx-static-mountain-hole-20260524-091824.json` | `33 / 81` | `raw_occupancy_vs_mesher_iso_false_positive = 32`, `vertex_position_or_table_decode_error = 1` | `lit_or_non_dark = 33` | `0` |
| Surface Nets baseline | `debug/terrain-hole-probe-mctx-static-mountain-hole-surface-nets-20260524-092056.json` | `35 / 81` | `unknown = 35` | MC oracle not applicable | n/a |
| MC all LOD0 | `debug/terrain-hole-probe-mctx-static-mountain-hole-all-lod0-20260524-092224.json` | `32 / 81` | `raw_occupancy_vs_mesher_iso_false_positive = 31`, `vertex_position_or_table_decode_error = 1` | `lit_or_non_dark = 32` | `0` |
| MC normal LODs, transitions disabled, boundary rows kept | `debug/terrain-hole-probe-mctx-static-mountain-hole-no-transitions-20260524-093554.json` | `33 / 81` | `raw_occupancy_vs_mesher_iso_false_positive = 20`, `missing_mesh_entity_or_render_layer = 12`, `vertex_position_or_table_decode_error = 1` | `lit_or_non_dark = 21`, `sky_or_background = 12` | `0` |
| MC all LOD1, transitions disabled, boundary rows kept | `debug/terrain-hole-probe-mctx-static-mountain-hole-all-lod1-no-transitions-20260524-092605.json` | `27 / 81` | `raw_occupancy_vs_mesher_iso_false_positive = 27` | `lit_or_non_dark = 27` | `0` |
| MC all LOD1 | `debug/terrain-hole-probe-mctx-static-mountain-hole-all-lod1-20260524-092734.json` | `27 / 81` | `raw_occupancy_vs_mesher_iso_false_positive = 27` | `lit_or_non_dark = 27` | `0` |

The release bench commands still returned nonzero because the run output
contains the known missing prop/billboard asset errors, but each run produced
the summary, screenshot, timing CSVs, and labelled probe dump used above.

Interpretation:

- The fixed-camera fan now classifies all normal MC gaps as non-unknown.
- Every classified MC source chunk still reports `skipped_lod_delta_gt_one = 0`,
  so this repro still does not justify scheduler work.
- The dominant raw probe gap is not a visual hole for this exact fan: the
  screenshot pixel at the mesher iso is lit/non-dark in the normal, all-LOD0,
  all-LOD1, and all-LOD1-no-transition runs.
- Surface Nets still reports raw solid-before-render candidates, but the MC
  source-cell oracle cannot classify those meshes. This reinforces that raw
  occupancy distance alone is not the visual truth.
- Disabling transitions while keeping boundary rows creates 12
  `missing_mesh_entity_or_render_layer` classifications with sky/background
  pixels. Treat that as transition-mode evidence, not as the current normal MC
  root cause.
- The persistent high-value suspect is a regular MC cell where the mesher-iso
  owning cell emits the expected triangle count, but the emitted triangles do
  not intersect the ray.

Current regular MC replay target:

```text
fan grid = [2, 8]
raw voxel surface distance = 95.5
mesher iso distance = 98.228195
first any/front render hit distance = 102.165565
mesher-iso owning chunk = (11, 1, 8), Lod0
mesher-iso owning cell = (15, 4, 5)
case_index = 3
class_index = 3
expected_regular_triangle_count = 2
actual_regular_triangle_count = 2
emitted_regular_triangles_ray_hit_count = 0
closest_emitted_regular_triangle_ray_distance = 0.13819484
first render-hit source chunk = (11, 1, 8)
first render-hit source cell = (11, 3, 4)
first render-hit case/class = 51 / 3
cell_agreement.raw_vs_mesher_iso = false
cell_agreement.mesher_iso_vs_first_render_source = false
cell_agreement.raw_vs_first_render_source = false
```

Next concrete step:

- Build a minimal replay fixture for chunk `(11, 1, 8)`, cell `(15, 4, 5)`,
  using the dumped SDF/case/ray data.
- Compare that case-3 emitted geometry against a reference MC edge/corner-order
  oracle.
- Do not change scheduler or SDF code unless a new probe shows a nonzero
  `skipped_lod_delta_gt_one` on the source chunk for a visually confirmed gap.
- If the human-visible dark patches are still not covered by this fixed fan,
  move the repro target/fan onto one of those dark screenshot regions and rerun
  the same schema-10 classification.

### Case-3 replay classification correction

Follow-up on 2026-05-24:

- Added a minimal regular-MC case-3 table sanity test:
  `regular_case3_table_uses_expected_lengyel_edges`.
- The table/corner-order for the replay target is correct:

```text
case_index = 3
class_index = 3
expected triangle count = 2
edge vertices = [0-2, 0-4, 1-5, 1-3]
triangulation = [0, 1, 2], [0, 2, 3]
```

This means the previous replay target was not a proven regular-MC
table/corner-order failure. It was a trilinear mesher-iso vs triangulated-MC
surface residual at a visually lit screenshot pixel.

Probe fix:

- `vertex_position_or_table_decode_error` is now gated behind visual evidence.
- If the mesher-iso point projects to a lit/non-dark screenshot pixel, the gap
  remains `raw_occupancy_vs_mesher_iso_false_positive` even when the exact
  mesher-iso owning cell's emitted triangles miss the ray by a small residual.
- If the same case is visually dark/missing, it still remains a
  `vertex_position_or_table_decode_error` suspect.

Verification:

```powershell
rtk cargo test --lib --features mc_transvoxel lit_mesher_iso_visual_overrides_case3_triangle_miss_classification -j 1
rtk cargo test --lib --features mc_transvoxel dark_mesher_iso_keeps_case3_triangle_miss_as_vertex_decode_suspect -j 1
rtk cargo test --lib --features mc_transvoxel regular_case3_table_uses_expected_lengyel_edges -j 1
rtk cargo test --lib --features mc_transvoxel forensics -j 1
```

Refreshed normal MC fixed-camera repro:

```powershell
rtk cargo run --release --features mc_transvoxel -- --bench bench/scenes/visual/mc-transvoxel-static-hole-probe.toml
```

Artifacts:

- `debug/terrain-hole-probe-mctx-static-mountain-hole-20260524-104838.json`

Normalized result:

```text
camera_ray_fan.rays_total = 81
camera_ray_fan.rays_with_gap = 33
camera_ray_fan.gap_classification counts:
  raw_occupancy_vs_mesher_iso_false_positive = 33
mesher_iso visual pixel classifications:
  lit_or_non_dark = 33
source_chunk_skipped_lod_delta_gt_one values across fan gaps = [0]
```

Updated conclusion:

- The current fixed-camera fan is not landing on a visually dark/missing mesh
  defect. It is mostly measuring raw voxel occupancy earlier than the smoothed
  MC surface, and the screenshot confirms the sampled pixels are lit.
- Do not fix MC extraction from this fan anymore.
- The next useful repro must retarget the probe onto a pixel that is visibly
  black/dark in the screenshot, then rerun schema 10. Only that visually dark
  ray should drive a mesh/table/transition fix.

### Live Shift+F9 dark-region probe

User-provided live runtime dump on 2026-05-24:

- `debug/terrain-hole-probe-20260524-123352.json`

Logged summary:

```text
target_voxel_position = (95, 46, 97)
target_chunk_position = (5, 2, 6)
camera_ray.first_voxel_solid_distance = 227.25
camera_ray.first_mesher_iso_distance = 228.0654
camera_ray.first_any_render_hit.distance = 265.58856
camera_ray.first_front_render_hit = null
camera_ray.first_backface_render_hit.distance = 265.58856
camera_ray_fan.rays_total = 81
camera_ray_fan.rays_with_gap = 20
source_chunk_skipped_lod_delta_gt_one values across fan gaps = [0]
```

Important findings:

- This is a better visual target than the previous fixed bench fan; the center
  ray has no front-facing render hit near the raw or mesher-iso surface.
- The dump did not include `McTriangleSources` because live runtime meshing was
  not enabling source maps. Therefore `actual_regular_triangle_count = null`
  means "unknown", not zero.
- The old classifier was incorrectly treating unknown source counts as zero,
  inflating the fan to `missing_regular_mc_geometry = 16`.
- The old classifier also treated any later back-facing hit as winding, even
  when it was 37.5 m behind the mesher iso. Backface/winding is only evidence
  when the backface is at the expected surface.

Probe fixes:

- Missing regular/transition geometry now requires a known zero source count,
  not a missing source map.
- Backface/winding classification now requires the backface to be near the raw
  or mesher-iso surface.
- Added `mc_transvoxel.debug_triangle_sources` so live MC runtime meshes can
  carry `McTriangleSources`, not just bench-forensics meshes.
- Enabled `debug_triangle_sources: true` in the active MC config while this
  investigation is running.

Verification:

```powershell
rtk cargo test --lib --features mc_transvoxel camera_gap_does_not_classify_far_backface_as_winding -j 1
rtk cargo test --lib --features mc_transvoxel camera_gap_classifies_backface_when_front_hit_is_late -j 1
rtk cargo test --lib --features mc_transvoxel missing_regular_geometry_requires_known_zero_source_count -j 1
rtk cargo test --lib --features mc_transvoxel known_zero_regular_source_count_classifies_missing_geometry -j 1
rtk cargo test --lib --features mc_transvoxel config_deserializes_debug_triangle_sources -j 1
rtk cargo test --lib --features mc_transvoxel forensics -j 1
```

Next live repro requirement:

- Restart/rebuild the MC runtime so `debug_triangle_sources: true` is active
  during mesh generation.
- Let the visible region remesh, then run Shift+F9 again on the same dark
  patch.
- The next dump should have non-null `actual_regular_triangle_count` and
  `first_render_hit_source` for MC chunks. That is the first dump that can
  legitimately classify missing regular/transition geometry in live mode.
