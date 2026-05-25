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

### Live source-map repro: padded MC cell offset

User-provided live runtime dump on 2026-05-24 after restarting with
`.\scripts\startVoxels.ps1 -Mc`:

- `debug/terrain-hole-probe-20260524-125502.json`

Logged summary:

```text
camera_ray.gap_classification = vertex_position_or_table_decode_error
camera_ray.first_voxel_solid_distance = 227.0
camera_ray.first_mesher_iso_distance = 227.21916
camera_ray.first_any_render_hit.distance = 267.51733
camera_ray.first_front_render_hit = null
camera_ray.first_backface_render_hit.distance = 267.51733
camera_ray.first_mesher_iso_point = (96.60327, 46.26485, 96.79657)
camera_ray.mc_cell.chunk_position = (6, 2, 6)
camera_ray.mc_cell.effective_lod_at_mesh = Lod1
camera_ray.mc_cell.cell = (1, 7, 1)
camera_ray.mc_cell.case_index = 23
camera_ray.mc_cell.expected_regular_triangle_count = 4
camera_ray.mc_cell.actual_regular_triangle_count = 4
camera_ray.mc_cell.emitted_regular_triangles_ray_hit_count = 0
camera_ray.mc_cell.closest_emitted_regular_triangle_ray_distance = 0.3571166
camera_ray.mc_cell.source_chunk_skipped_lod_delta_gt_one = 0
camera_ray.first_render_hit_source = regular chunk (4, 3, 4), Lod2, cell (2, 1, 2)
camera_ray_fan.rays_with_gap = 23 / 81
camera_ray_fan.gap_classification counts = unknown:17, vertex_position_or_table_decode_error:6
source_chunk_skipped_lod_delta_gt_one values across classified gaps = [0]
```

Important finding:

- The mesher-iso point sits in the positive Y band of a Lod1 chunk:
  chunk `(6, 2, 6)` starts at world `(96, 32, 96)`, so `y = 46.26485`
  is local `14.26485`. Lod1 step is 2, so this belongs to regular cell
  `y = 7`, spanning local `[14, 16]`.
- `extract_regular_mc` was reading regular cells from padded SDF indices
  `cell + corner`, while `SdfGrid::local_position` maps padded index `i`
  to `(i - 1) * step`. That means the regular extractor meshed
  `[-step, chunk_size - step]` instead of `[0, chunk_size]`.
- At Lod1, the old extractor's top regular cell spanned local `[12, 14]`.
  The live iso point at local `14.26485` was inside the unmeshed positive
  boundary band, explaining the near-surface miss without involving the
  scheduler (`skipped_lod_delta_gt_one = 0`).

Fix:

- Regular MC now samples SDF corners from padded index `cell + 1 + corner`
  while keeping public/source-map cell coordinates in `0..subdivisions`.
- The hole-probe MC cell oracle now maps points to the same source cell
  coordinates and computes regular case indices with the same `+1` padded
  offset.
- Transvoxel face frames now use the same padded convention: the 9 high-res
  case samples sit on the inner side of the skipped boundary row and the
  4 low-res samples sit on the outer boundary side.
- The failed throwaway case-complement hypothesis test was removed; it did
  not explain the live ray.

Regression coverage:

```powershell
rtk cargo test -j 1 --lib --features mc_transvoxel regular_lod1_mesh_covers_positive_boundary_cell -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_mc_ -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel oracle_cell_selection -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_fills_skipped_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel grid_coords_stay_within_padded_bounds_for_all_faces -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel forensics -- --nocapture
rtk cargo check -j 1 --lib --features mc_transvoxel
rtk cargo build -j 1 --release --features mc_transvoxel
```

Status:

- All focused tests above passed.
- The first release build attempt exceeded the tool timeout but completed in
  the background; the immediate rerun finished as a no-op in under one second.
- Visual confirmation is still pending. Restart with `.\scripts\startVoxels.ps1 -Mc`,
  aim at the same dark mountain patch, and run Shift+F9. Expected improvement:
  the center ray should no longer report a near mesher-iso miss in the
  Lod1 positive-boundary band.

### Live seam repro after padded-cell fix: transition winding

User-provided live runtime dump on 2026-05-24 after the padded MC cell offset
fix:

- `debug/terrain-hole-probe-20260524-141321.json`

User observation:

- The mid-LOD/interior mountain hole appears fixed.
- Visible seams remain along LOD transition bands.

Logged summary:

```text
camera_ray.gap_classification = backface_or_winding
camera_ray.first_voxel_solid_distance = 189.25
camera_ray.first_mesher_iso_distance = 189.58493
camera_ray.first_any_render_hit.distance = 189.3657
camera_ray.first_front_render_hit.distance = 271.79724
camera_ray.first_backface_render_hit.distance = 189.3657
camera_ray.first_mesher_iso_point = (117.66649, 31.610695, 106.77595)
camera_ray.mc_cell.chunk_position = (7, 1, 6)
camera_ray.mc_cell.effective_lod_at_mesh = Lod0
camera_ray.mc_cell.neighbor_lods_at_mesh.neg_y = Lod1
camera_ray.mc_cell.neighbor_lods_at_mesh.pos_y = Lod1
camera_ray.mc_cell.cell = (5, 15, 10)
camera_ray.mc_cell.case_index = 51
camera_ray.mc_cell.expected_regular_triangle_count = 2
camera_ray.mc_cell.actual_regular_triangle_count = 0
camera_ray.mc_cell.skipped_regular_faces = [pos_y]
camera_ray.mc_cell.transition_owner_faces = [pos_y]
camera_ray.mc_cell.transition_cells[0].case_index = 495
camera_ray.mc_cell.transition_cells[0].class_index = 1
camera_ray.mc_cell.transition_cells[0].expected_triangle_count = 2
camera_ray.mc_cell.transition_cells[0].actual_triangle_count = 2
camera_ray.mc_cell.transition_cells[0].invert = true
camera_ray.mc_cell.transition_cells[0].emitted_triangles_ray_hit_count = 1
camera_ray.mc_cell.source_chunk_skipped_lod_delta_gt_one = 0
camera_ray.first_render_hit_source = transition chunk (7, 1, 6), Lod0, face pos_y, cell_u=2, cell_v=5, case=495, class=1, invert=true
camera_ray.cell_agreement = raw surface, mesher iso, and first render hit resolve to the same MC cell
camera_ray_fan.rays_with_gap = 25 / 81
camera_ray_fan.gap_classification counts = unknown:23, vertex_position_or_table_decode_error:1, backface_or_winding:1
source_chunk_skipped_lod_delta_gt_one values across classified gaps = [0]
```

Important finding:

- This is no longer missing geometry at the center ray. The first actual
  render hit is at the expected surface distance, and it comes from the same
  transition cell the oracle expects.
- The hit is back-facing:

```text
first_any_render_hit.front_face = false
first_any_render_hit.geometric_normal = (-0.42379394, -0.80049825, -0.42379394)
first_any_render_hit.vertex_normal = (0.34503898, 0.87947774, 0.32782155)
material_weights = [0.0, 0.0, 0.0, 1.0]
```

- Geometric normal and vertex/SDF normal point in opposite hemispheres. Because
  the terrain material is double-sided, this is not GPU culling, but the shader
  receives `front_facing = false` and Bevy's PBR input can flip the normal for
  double-sided lighting. This matches a dark seam rather than an absent triangle.

Fix:

- Added `transition_triangle_winding_matches_vertex_normals`, using the existing
  PosY sawtooth transition fixture.
- The regression failed before the fix:

```text
transition triangle 930 has geometric normal opposite vertex normal:
dot = -0.8433683
source = Transition { face: PosY, case_index: 483, class_index: 4, invert: true }
```

- Corrected transition triangle winding by reversing the table invert handling:
  swap transition triangle vertices when `invert == false`, not when
  `invert == true`.

Verification:

```powershell
rtk cargo test -j 1 --lib --features mc_transvoxel transition_triangle_winding_matches_vertex_normals -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel forensics -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_fills_skipped_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_lod1_mesh_covers_positive_boundary_cell -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel oracle_cell_selection -- --nocapture
rtk cargo check -j 1 --lib --features mc_transvoxel
rtk cargo build -j 1 --release --features mc_transvoxel
```

Status:

- All focused tests above passed.
- Release MC binary rebuilt. As before, the first release build command exceeded
  the tool timeout but finished in the background; the immediate rerun reported
  the release profile finished successfully.
- Next live retest: restart with `.\scripts\startVoxels.ps1 -Mc`, aim at the
  same seam, and run Shift+F9. Expected center-ray change: first hit at the seam
  should become front-facing or no longer classify as `backface_or_winding`.

### Live seam repro after winding fix: empty transition owner

User-provided live runtime dump on 2026-05-24 after the transition winding fix:

- `debug/terrain-hole-probe-20260524-144537.json`

User observation:

- The mid-LOD/interior mountain issue appears improved.
- Dark holes are still visible on the seam between LOD bands.

Logged summary:

```text
camera_ray.gap_classification = missing_transition_geometry_or_face_frame
camera_ray.first_voxel_solid_distance = 192.75
camera_ray.first_mesher_iso_distance = 193.09703
camera_ray.first_any_render_hit = None
camera_ray.first_front_render_hit = None
camera_ray.first_backface_render_hit = None
camera_ray.mc_cell.chunk_position = (8, 3, 19)
camera_ray.mc_cell.effective_lod_at_mesh = Lod0
camera_ray.mc_cell.neighbor_lods_at_mesh.pos_z = Lod1
camera_ray.mc_cell.cell = (2, 3, 15)
camera_ray.mc_cell.case_index = 240
camera_ray.mc_cell.expected_regular_triangle_count = 2
camera_ray.mc_cell.actual_regular_triangle_count = 0
camera_ray.mc_cell.boundary_faces = [pos_z]
camera_ray.mc_cell.skipped_regular_faces = [pos_z]
camera_ray.mc_cell.transition_owner_faces = [pos_z]
camera_ray.mc_cell.transition_cells[0].face = pos_z
camera_ray.mc_cell.transition_cells[0].cell_u = 1
camera_ray.mc_cell.transition_cells[0].cell_v = 1
camera_ray.mc_cell.transition_cells[0].case_index = 0
camera_ray.mc_cell.transition_cells[0].expected_triangle_count = 0
camera_ray.mc_cell.transition_cells[0].actual_triangle_count = 0
camera_ray.mc_cell.source_chunk_skipped_lod_delta_gt_one = 0
camera_ray_fan.rays_with_gap = 14 / 81
camera_ray_fan.gap_classification counts =
  unknown:9
  vertex_position_or_table_decode_error:2
  missing_transition_geometry_or_face_frame:2
  backface_or_winding:1
source_chunk_skipped_lod_delta_gt_one values across classified gaps = [0]
```

Important finding:

- This is a real boundary-row replacement failure, not scheduler churn:
  `skipped_lod_delta_gt_one = 0`.
- The regular MC boundary cell was non-empty (`case=240`, expected 2 triangles),
  but it was skipped because `pos_z` was marked as a transition owner.
- The mapped transition cell for that same row was empty (`case=0`, expected
  and actual 0 triangles), so the transition pass removed the regular surface
  without providing replacement geometry.

Fix:

- Regular MC boundary-row skipping is now conditional on the mapped transition
  cell actually producing replacement triangles.
- `transition_triangle_count_for_regular_cell` reuses the same transition case
  calculation as transition extraction.
- If the transition owner exists but the mapped transition case is empty, the
  regular boundary cell is kept.
- The hole probe now reports `skipped_regular_faces` using the same conditional
  rule, while still reporting `transition_owner_faces` separately. This keeps
  future dumps from saying a row was skipped when the mesh generator now keeps it.

Regression:

- Added `empty_transition_owner_keeps_regular_boundary_row`.
- Fixture: current chunk air, `pos_z` neighbor solid/coarser. The target PosZ
  transition cell is empty, while the regular PosZ boundary cell is non-empty.
- Expected behavior: no transition source for the mapped transition cell,
  a regular source for cell `(8, 8, 15)`, and a ray hit through the retained
  regular boundary row.

Verification:

```powershell
rtk cargo test -j 1 --lib --features mc_transvoxel empty_transition_owner_keeps_regular_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_triangle_winding_matches_vertex_normals -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_fills_skipped_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_lod1_mesh_covers_positive_boundary_cell -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel forensics -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel oracle_cell_selection -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_mc_flat_plane_has_no_ray_gaps -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_mc_diagonal_plane_has_no_ray_gaps -- --nocapture
rtk cargo check -j 1 --lib --features mc_transvoxel
rtk cargo build -j 1 --release --features mc_transvoxel
```

Status:

- All focused tests above passed.
- Release MC binary rebuilt successfully.
- Next live retest: restart with `.\scripts\startVoxels.ps1 -Mc`, aim at the
  same seam, and run Shift+F9. Expected center-ray change for this failure class:
  if the oracle regular cell is non-empty and the mapped transition cell is
  empty, the regular cell should now be present and `skipped_regular_faces`
  should be empty while `transition_owner_faces` may still include the face.

### Live seam repro after empty-owner fix: PosZ face-frame orientation

User-provided live runtime dump on 2026-05-24 after the empty transition owner
fallback:

- `debug/terrain-hole-probe-20260524-152756.json`

User observation:

- Seam holes are still visible, but likely fewer.

Logged summary:

```text
camera_ray.gap_classification = missing_transition_geometry_or_face_frame
camera_ray.first_voxel_solid_distance = 179.75
camera_ray.first_mesher_iso_distance = 179.52902
camera_ray.first_any_render_hit.distance = 274.4428
camera_ray.mc_cell.chunk_position = (21, 2, 21)
camera_ray.mc_cell.effective_lod_at_mesh = Lod0
camera_ray.mc_cell.neighbor_lods_at_mesh.pos_z = Lod1
camera_ray.mc_cell.cell = (10, 7, 15)
camera_ray.mc_cell.case_index = 48
camera_ray.mc_cell.expected_regular_triangle_count = 2
camera_ray.mc_cell.actual_regular_triangle_count = 0
camera_ray.mc_cell.boundary_faces = [pos_z]
camera_ray.mc_cell.skipped_regular_faces = [pos_z]
camera_ray.mc_cell.transition_owner_faces = [pos_z]
camera_ray.mc_cell.transition_cells[0].face = pos_z
camera_ray.mc_cell.transition_cells[0].cell_u = 5
camera_ray.mc_cell.transition_cells[0].cell_v = 3
camera_ray.mc_cell.transition_cells[0].case_index = 12
camera_ray.mc_cell.transition_cells[0].expected_triangle_count = 3
camera_ray.mc_cell.transition_cells[0].actual_triangle_count = 3
camera_ray.mc_cell.transition_cells[0].emitted_triangles_ray_hit_count = 0
camera_ray.mc_cell.transition_cells[0].closest_emitted_triangle_ray_distance = 0.84287953
camera_ray.mc_cell.source_chunk_skipped_lod_delta_gt_one = 0
camera_ray_fan.rays_with_gap = 18 / 81
camera_ray_fan.gap_classification counts =
  unknown:16
  vertex_position_or_table_decode_error:1
  missing_transition_geometry_or_face_frame:1
  backface_or_winding:1
source_chunk_skipped_lod_delta_gt_one values across classified gaps = [0]
```

Important finding:

- The mapped PosZ transition cell was not empty, but it was mapped with the
  wrong tangent orientation. The reference `transvoxel` crate's rotations define
  `HighZ`/PosZ U as `-X`; this implementation used `+X`.
- The same audit found two other tangent sign mismatches against the reference
  rotations: `NegX` U should run toward `-Z`, and `NegY` V should run toward
  `-Z`.

Fix:

- `FaceFrame` now carries `u_sign` and `v_sign`.
- `PosZ` uses reversed U, `NegX` uses reversed U, and `NegY` uses reversed V.
- Transition cell lookup from a regular boundary cell now respects reversed
  tangent axes, so the probe and mesher agree on the mapped transition cell.

Regression:

- Added `face_frames_match_transvoxel_tangent_orientation`.
- Added `transition_cell_mapping_respects_reversed_tangent_axes`.
- Added `pos_z_transition_case_uses_reversed_u_mapping`, using a synthetic PosZ
  `case=12` SDF fixture matching the live dump's case class.

Verification:

```powershell
rtk cargo test -j 1 --lib --features mc_transvoxel pos_z_transition_case_uses_reversed_u_mapping -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel face_frames_match_transvoxel_tangent_orientation -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_cell_mapping_respects_reversed_tangent_axes -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel empty_transition_owner_keeps_regular_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_triangle_winding_matches_vertex_normals -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_fills_skipped_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel forensics -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel oracle_cell_selection -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_mc_flat_plane_has_no_ray_gaps -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_mc_diagonal_plane_has_no_ray_gaps -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel regular_lod1_mesh_covers_positive_boundary_cell -- --nocapture
rtk cargo check -j 1 --lib --features mc_transvoxel
rtk cargo build -j 1 --release --features mc_transvoxel
```

Status:

- All focused tests above passed.
- Release MC binary rebuilt successfully.

### Live seam repro after face-frame fix: transition replacement not watertight

User-provided live runtime dump on 2026-05-24 after the PosZ/NegX/NegY tangent
orientation fix:

- `debug/terrain-hole-probe-20260524-154713.json`

User observation:

- There are fewer seam holes, but visible holes remain.

Logged summary:

```text
camera_ray.gap_classification = unknown
camera_ray.see_through_gap = None
camera_ray.first_any_render_hit.distance = 211.64474
camera_ray.first_any_render_hit.front_face = true
camera_ray.first_any_render_hit.source = regular chunk (10, 2, 20), Lod1, cell (7, 1, 3), case=247
camera_ray_fan.rays_with_gap = 15 / 81
camera_ray_fan.gap_classification counts =
  unknown:12
  missing_transition_geometry_or_face_frame:2
  vertex_position_or_table_decode_error:1
source_chunk_skipped_lod_delta_gt_one values across fan gaps = [0]
```

The 12 `unknown` fan rays now have front-facing render hits close to the mesher
iso and are likely raw-occupancy-vs-mesher displacement rather than true holes.
The remaining classified seam misses are both `pos_z` transition replacements:

```text
gap (3, 1):
  chunk = (10, 4, 22), Lod1, pos_z neighbor Lod2
  regular cell = (3, 2, 7), case=85, expected regular tris=2, actual regular tris=0
  transition cell = pos_z u=2 v=1, case=270, expected/actual transition tris=4/4
  emitted transition triangles ray hits = 0
  closest transition triangle ray distance = 0.33981854

gap (5, 4):
  chunk = (10, 2, 19), Lod0, pos_z neighbor Lod1
  regular cell = (9, 3, 15), case=115, expected regular tris=3, actual regular tris=0
  transition cell = pos_z u=3 v=1, case=399, expected/actual transition tris=3/3
  emitted transition triangles ray hits = 0
  closest transition triangle ray distance = 0.4521598
```

Important finding:

- This is no longer an empty transition owner or wrong PosZ tangent mapping.
- The transition cell emits triangles, but the emitted triangles still miss the
  ray near the mesher iso after the regular boundary cell has been deleted.
- The remaining seam holes therefore come from destructive boundary-row
  replacement by a transition path that is not yet watertight enough.

Fix:

- Regular MC boundary rows are now retained under transition aprons. The
  transition triangles are still emitted, but they no longer destructively
  delete the regular surface.
- The hole probe now reports `transition_owner_faces` separately while keeping
  `skipped_regular_faces` empty, matching the mesher behavior.
- This is intentionally a pragmatic spike fallback: it should close the visible
  holes while preserving transition-apron evidence. Pure destructive
  replacement should only be restored after transition-cell watertight tests pass
  on the live repro cases.

Regression:

- Added `transition_apron_keeps_regular_boundary_rows`.

Verification:

```powershell
rtk cargo test -j 1 --lib --features mc_transvoxel transition_apron_keeps_regular_boundary_rows -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel pos_z_transition_case_uses_reversed_u_mapping -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel empty_transition_owner_keeps_regular_boundary_row -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_triangle_winding_matches_vertex_normals -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel face_frames_match_transvoxel_tangent_orientation -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel transition_cell_mapping_respects_reversed_tangent_axes -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel forensics -- --nocapture
rtk cargo test -j 1 --lib --features mc_transvoxel oracle_cell_selection -- --nocapture
rtk cargo check -j 1 --lib --features mc_transvoxel
rtk cargo build -j 1 --release --features mc_transvoxel
```

Status:

- All focused tests above passed.
- Release MC binary rebuilt successfully.
- Next live retest: restart with `.\scripts\startVoxels.ps1 -Mc`, aim at the
  same seam, and run Shift+F9. Expected dump change: `skipped_regular_faces`
  should be empty for transition-owner cells; the two previous
  `missing_transition_geometry_or_face_frame` rays should either disappear or
  reclassify as regular/vertex issues if there is a deeper MC-table problem.

### Live seam repro after keeping regular boundary rows

User-provided live runtime dump on 2026-05-24 after retaining regular MC
boundary rows under transition aprons:

- `debug/terrain-hole-probe-20260524-162818.json`

User observation:

- Improved, but some visible seam holes remain.

Logged summary:

```text
camera_ray.first_voxel_solid_distance = 187.75
camera_ray.first_front_render_hit.distance = 187.81879
camera_ray.first_mesher_iso_distance = 187.59807
camera_ray.gap_classification = unknown
camera_ray_fan.rays_with_gap = 32 / 81
camera_ray_fan.gap_classification counts =
  unknown:30
  vertex_position_or_table_decode_error:2
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:27
  Lod1:5
camera_ray_fan transition_owner_faces rays = 0
camera_ray_fan skipped_regular_faces rays = 0
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
camera_ray_fan mesher_iso visual pixel classifications =
  screenshot_unavailable:32
height fan worst negative sample =
  error=-1.81 chunk=(6,2,5) local=(5.53,13.19,14.88) Lod1 near pos_z
height fan Lod1 interior median minus Lod0 interior median = -0.42
target classification =
  world_data_hole=false
  mesh_missing=false
  mesh_surface_mismatch=false
  vertical_chunk_boundary_surface=true
```

Important finding:

- The destructive transition replacement class is no longer present in this
  dump: fan rays report no skipped regular rows and no transition-owner cells.
- The scheduler is still ruled down for this repro: every source chunk reports
  `skipped_lod_delta_gt_one = 0`.
- The center ray has front-facing regular MC geometry almost immediately after
  the raw solid distance, so the center target is not a missing mesh.
- The remaining fan evidence is now dominated by raw voxel vs mesher/SDF height
  disagreement and visual uncertainty. The probe cannot yet distinguish a real
  dark pixel from a raw-occupancy false positive because no current screenshot
  was attached to the Shift+F9 dump.
- The strongest numeric clue is the residual LOD height disagreement: the worst
  sample is a Lod1 near-face point depressed by `-1.81`, and Lod1 interior
  samples are still lower than Lod0 interior samples by a median `-0.42`.

Probe improvement:

- Shift+F9 now auto-selects the newest recent `Alt+Shift+F7` terrain debug
  screenshot when the sidecar camera position matches the current camera. Bench
  probes with an explicit screenshot path still use the explicit path.
- This should turn the next live dump's `visual_samples` from
  `screenshot_unavailable` into pixel classifications at raw surface,
  mesher-iso, and render-hit points.

Next live retest:

1. Aim at the remaining seam hole.
2. Press `Alt+Shift+F7` and wait for the wireframe screenshot/sidecar log.
3. Without moving the camera, press `Shift+F9`.
4. Inspect the new dump for `visual_samples` classifications.

Interpretation for the next dump:

- `dark_or_missing` at the mesher iso or first render hit means the visual seam
  is still real and the next target is shading/material/normal or missing local
  geometry.
- `lit_or_non_dark` at the mesher iso or first render hit means that fan ray is
  a raw-occupancy-vs-smoothed/coarse-mesher false positive.
- Persistent negative Lod1 near-face height errors with lit pixels point to LOD
  SDF/coarse sampling displacement rather than transition deletion.

### Live seam repro: 2026-05-25 off-center seam holes

User-provided live runtime dump and screenshot on 2026-05-25:

- `debug/terrain-hole-probe-20260525-013029.json`
- `debug/wireframe-1779672632.png`
- `debug/wireframe-1779672632.json`

User observation:

- The issue is reduced, but left/right off-center seam holes are still visible.

Logged summary:

```text
camera_ray.first_voxel_solid_distance = 183.0
camera_ray.first_front_render_hit.distance = 183.20956
camera_ray.first_mesher_iso_distance = 183.24927
camera_ray.gap_classification = unknown
camera_ray_fan.rays_with_gap = 36 / 81
camera_ray_fan.gap_classification counts =
  unknown:34
  vertex_position_or_table_decode_error:1
  backface_or_winding:1
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:28
  Lod1:8
camera_ray_fan transition_owner_faces rays = 2
camera_ray_fan skipped_regular_faces rays = 0
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
camera_ray_fan mesher_iso visual pixel classifications =
  screenshot_unavailable:35
```

The screenshot was captured at `01:30:32`, three seconds after the `01:30:29`
Shift+F9 dump, so schema-10 visual fields were still `screenshot_unavailable`.
The sidecar camera position matched the dump camera exactly, so the screenshot
was sampled offline against the dump's projected ray points.

Offline screenshot sampling result:

```text
fan projected screen x range = 730..1189 on a 1920-wide screenshot
mesher_iso pixels:
  lit_or_non_dark:34
  sky_or_background:1
  none/offscreen-missing-point:1
dark_or_missing pixels at fan mesher_iso/front points = 0
```

Important finding:

- The 10-degree fan did not cover the user-circled left/right holes. It sampled
  the middle of the image, where the pixels were lit terrain or sky.
- The visible residual is now off-center relative to the crosshair, so the
  previous fan output cannot prove the circled holes are raw-vs-mesher false
  positives.
- Scheduler remains ruled down for this dump: source chunks again report
  `skipped_lod_delta_gt_one = 0`.
- Boundary-row deletion is still not present: `skipped_regular_faces = 0`.

Probe improvement:

- The Shift+F9 camera fan has been widened from a 10-degree 9x9 cone to a
  35-degree 13x13 cone so it covers most of a 45-degree, 16:9 screenshot and
  reaches off-center seam holes.

Next live retest:

1. Aim at the same scene.
2. Press `Alt+Shift+F7` first and wait for the screenshot/sidecar log.
3. Without moving, press `Shift+F9`.
4. Confirm the dump logs the widened fan and has populated visual samples.

### Live seam repro: screenshot-backed wide fan

User-provided live runtime dump and screenshot on 2026-05-25:

- `debug/wireframe-1779673953.png`
- `debug/wireframe-1779673953.json`
- `debug/terrain-hole-probe-20260525-015242.json`

This run used the correct capture order:

```text
Alt+Shift+F7 screenshot at 01:52:33
Shift+F9 probe at 01:52:41
Terrain hole probe using latest matching terrain debug screenshot debug\wireframe-1779673953.png
```

Logged summary:

```text
camera_ray_fan.rays_with_gap = 25 / 169
camera_ray_fan.half_angle_degrees = 35
camera_ray_fan.grid_size = 13
camera_ray_fan.gap_classification counts =
  raw_occupancy_vs_mesher_iso_false_positive:18
  geometry_present_but_shading_or_normal_darkening:2
  missing_mesh_entity_or_render_layer:1
  vertex_position_or_table_decode_error:1
  unknown:3
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:22
  Lod1:3
camera_ray_fan.mesher_iso visual pixel classifications =
  lit_or_non_dark:18
  dark_or_missing:2
  sky_or_background:1
  offscreen:3
camera_ray_fan transition_owner_faces rays = 0
camera_ray_fan skipped_regular_faces rays = 0
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
```

Confirmed visual-backed rays:

```text
grid (7,9):
  classification = geometry_present_but_shading_or_normal_darkening
  screen = (1093,951)
  chunk = (15,1,12), Lod0, cell=(8,0,9), case=51
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 1
  front hit distance = mesher iso distance = 30.235
  visual pixel = dark_or_missing, rgb=(12,17,26), luminance=0.065
  hit triangle y = 16.666666 for all vertices

grid (8,9):
  classification = geometry_present_but_shading_or_normal_darkening
  screen = (1229,951)
  chunk = (15,1,12), Lod0, cell=(10,0,7), case=51
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 1
  front hit distance = mesher iso distance = 30.670
  visual pixel = dark_or_missing, rgb=(12,17,26), luminance=0.065
  hit triangle y = 16.666666 for all vertices

grid (0,6):
  classification = missing_mesh_entity_or_render_layer
  screen = (47,540)
  chunk = (3,1,13), Lod0, cell=(9,14,14), case=119
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 1
  visual pixel = sky_or_background, rgb=(149,157,176)

grid (7,5):
  classification = vertex_position_or_table_decode_error
  chunk = (6,3,4), Lod1, cell=(3,3,7), case=17
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 0
  closest emitted triangle ray distance = 0.389
  raw surface pixel = sky_or_background
```

Important finding:

- This is the first useful screenshot-backed wide-fan classification.
- The dominant class is now benign for the visible image:
  18 / 25 gap rays are lit terrain where raw occupancy is earlier than the
  mesher iso/render surface.
- The scheduler and destructive transition replacement are still ruled down:
  all source chunks report `skipped_lod_delta_gt_one = 0`, and no rays have
  `skipped_regular_faces`.
- The two confirmed dark pixels are not missing MC triangles. They have
  front-facing regular Lod0 geometry exactly at the mesher iso. This points to
  shading/material/normal/debug overlay darkening or a depth/material path issue
  for those pixels, not transition-cell topology.
- The one sky/background pixel despite CPU-visible geometry points to
  render-layer/entity/depth visibility mismatch and should be inspected
  separately from MC topology.

Next target:

- Do not return to scheduler work for this scene.
- Inspect the regular Lod0 dark pixels at chunk `(15,1,12)`, cells `(8,0,9)`
  and `(10,0,7)`, both `case=51`, using material weights, vertex normals,
  triangle winding, depth ordering, and debug material mode.
- Inspect the single sky/background mismatch at chunk `(3,1,13)`, cell
  `(9,14,14)`, `case=119`, to determine whether the CPU probe is intersecting a
  mesh that is not visible in the rendered frame or whether projection/depth
  ordering differs from the screenshot.

### Live normals-view follow-up

User-provided live runtime dump and normals-view screenshot on 2026-05-25:

- `debug/wireframe-1779675115.png`
- `debug/wireframe-1779675115.json`
- `debug/terrain-hole-probe-20260525-021201.json`

Logged summary:

```text
camera_ray_fan.rays_with_gap = 35 / 169
camera_ray_fan.half_angle_degrees = 35
camera_ray_fan.grid_size = 13
camera_ray_fan.gap_classification counts =
  raw_occupancy_vs_mesher_iso_false_positive:28
  geometry_present_but_shading_or_normal_darkening:1
  vertex_position_or_table_decode_error:2
  unknown:4
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:34
  Lod1:1
camera_ray_fan.mesher_iso visual pixel classifications =
  lit_or_non_dark:28
  dark_or_missing:1
  offscreen:5
camera_ray_fan transition_owner_faces rays = 0
camera_ray_fan skipped_regular_faces rays = 0
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
```

Important sidecar note:

```text
debug/wireframe-1779675115.json mode_flags =
  wireframe=false
  normals=false
  iso_band=false
  editor_wireframe=false
```

The attached image visually appears to show normals/wire debugging, but the
saved sidecar says those terrain debug flags were false. Treat the mode flag as
suspect until we verify whether the overlay is coming from another debug path or
whether the sidecar is sampling stale/debug-incomplete state.

Confirmed non-benign in-frame ray:

```text
grid (8,9):
  classification = geometry_present_but_shading_or_normal_darkening
  screen = (1229,951)
  chunk = (24,1,18), Lod0, cell=(14,6,4), case=51
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 1
  first_front distance = 56.226
  mesher_iso distance = 56.247
  visual pixel = dark_or_missing, rgb=(15,20,28), luminance=0.077
```

Other non-benign rays:

```text
grid (11,6):
  classification = vertex_position_or_table_decode_error
  screen = (1688,540)
  chunk = (28,2,14), Lod0, cell=(15,2,12), case=17
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 0
  closest emitted triangle ray distance = 0.430
  raw pixel = lit_or_non_dark

grid (8,11):
  classification = vertex_position_or_table_decode_error
  screen = offscreen y=1268
  chunk = (24,1,20), Lod0, cell=(3,12,0), case=48
  actual/expected regular triangles = 2/2
  emitted regular ray hits = 0
  first render source is adjacent chunk (24,1,19), cell=(3,11,15), case=51
```

Interpretation:

- The visible circled seam areas in the attached normals-view image are largely
  colored rather than black/transparent. That strongly suggests geometry exists
  in those regions.
- The remaining in-frame dark classification is a regular Lod0 `case=51` cell
  with real front-facing geometry. That points away from MC/Transvoxel topology
  and toward material/lighting/depth/debug-shading behavior.
- One in-frame `case=17` vertex/table suspect remains, but its sampled pixel is
  lit, so it is not currently a visually dark hole.
- Scheduler and destructive transition replacement remain ruled down.

Next target:

- Add or use a terrain material/debug mode that renders MC terrain as a flat
  unlit solid color with depth testing unchanged. If the circled regions become
  solid, the remaining issue is lighting/material/normal/shadow/fog. If they
  stay visually missing, inspect render extraction/layers/depth.
- Fix the debug sidecar if needed so `mode_flags.normals` accurately records
  the screenshot mode used for the visual sample.

### Flat unlit terrain debug mode

Implemented after the normals-view follow-up:

- `Alt+F10` toggles a flat unlit terrain material.
- `Alt+F7 + Alt+F10` keeps the existing wireframe overlay over the flat unlit
  fill.
- The capture sidecar now records `mode_flags.flat_unlit`.
- The shader path returns a constant unlit terrain colour before triplanar
  texture sampling, normal maps, PBR lighting, fog post-processing, weather
  darkening, and caustics.

Use this mode on the same residual seam views:

```text
Alt+F10 -> Alt+Shift+F7 -> Shift+F9
```

Interpretation:

- If the circled regions become solid in flat unlit mode, the remaining issue
  is material/lighting/fog/shadow/weather/debug shading.
- If the circled regions remain missing/dark, inspect render
  extraction/layers/depth for the source cells reported by the wide fan.

### Flat unlit follow-up: residual small polygon defects

User-provided flat-unlit runtime dump and screenshot on 2026-05-25:

- `debug/wireframe-1779677014.png`
- `debug/wireframe-1779677014.json`
- `debug/terrain-hole-probe-20260525-024354.json`

Logged and parsed summary:

```text
mode_flags.flat_unlit = true
camera_ray_fan.rays_with_gap = 35 / 169
camera_ray_fan.half_angle_degrees = 35
camera_ray_fan.grid_size = 13
camera_ray_fan.gap_classification counts =
  raw_occupancy_vs_mesher_iso_false_positive:25
  vertex_position_or_table_decode_error:2
  geometry_present_but_shading_or_normal_darkening:2
  backface_or_winding:3
  unknown:3
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:34
  Lod1:1
camera_ray_fan.mesher_iso visual pixel classifications =
  lit_or_non_dark:29
  dark_or_missing:2
  offscreen:4
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
```

The flat-unlit image removes most broad shading ambiguity. The remaining
user-circled issue is small and polygonal, so it should be treated as real mesh
coverage evidence rather than a lighting-only artifact.

Center ray:

```text
classification = vertex_position_or_table_decode_error
first_voxel_solid_distance = 198.5
first_mesher_iso_distance = 198.428
first_front_render_hit = None
first_any_render_hit = 251.069, back-facing, unrelated transition source
visual mesher-iso pixel = lit_or_non_dark, rgb=(173,190,173)

mc_cell =
  chunk = (6,1,7), Lod0
  neighbor_lods = neg_x:Lod0 pos_x:Lod0 neg_y:Lod1 pos_y:Lod1 neg_z:Lod0 pos_z:Lod0
  cell = (15,15,0)
  case = 51
  class = 3
  boundary_faces = pos_x,pos_y,neg_z
  transition_owner_faces = pos_y
  expected_regular_triangle_count = 2
  actual_regular_triangle_count = 2
  emitted_regular_ray_hits = 0
  closest_regular_ray_distance = 0.132

transition owner =
  face = pos_y
  cell_u = 7
  cell_v = 0
  case = 495
  class = 1
  invert = true
  expected_transition_triangle_count = 2
  actual_transition_triangle_count = 2
  emitted_transition_ray_hits = 0
  closest_transition_ray_distance = 0.358
```

Second similar ray:

```text
grid = (7,6)
classification = vertex_position_or_table_decode_error
chunk = (7,1,6), Lod0
cell = (15,15,2)
case = 51
transition_owner_faces = pos_y
first_front_render_hit = None
first_any_render_hit = 261.586
closest_regular_ray_distance = 0.387
```

Interpretation:

- The remaining center defect is not scheduler-related:
  `source_chunk_skipped_lod_delta_gt_one = 0`.
- It is not the broad normals/material-darkening problem: flat unlit mode is
  active and most sampled pixels are lit/non-dark.
- It is not a missing-mesh-entity case for the source chunk: both regular and
  transition triangle counts match the expected table counts.
- It is a boundary-corner coverage problem: the mesher-iso owner is a Lod0
  `case=51` cell on `pos_x,pos_y,neg_z`, the only transition owner is `pos_y`,
  and the emitted regular plus transition triangles both miss the ray by a
  small but visible margin.

Next target:

- Build a minimal replay fixture from the center ray:
  chunk `(6,1,7)`, cell `(15,15,0)`, regular `case=51`, `pos_y` transition
  cell `(u=7,v=0)`, transition `case=495`, `invert=true`.
- The regression should assert that a ray through the mesher-iso point is
  covered by either the owning regular cell triangles or the owning transition
  cell triangles. It should fail on the current dump-derived data.
- Extend the oracle to report all boundary-corner transition candidates, not
  only the selected transition owner face, because this source cell is on three
  chunk faces while only `pos_y` is currently represented as transition-owned.
- Do not return to scheduler or SDF work for this residual defect unless a new
  source chunk reports nonzero `skipped_lod_delta_gt_one`.

### Normals-highlighted artifacts are not holes

User-provided normals-view screenshot on 2026-05-25 shows several circled
magenta/blue/purple regions on the mountain. These are visible in normals mode,
but the user confirmed they are not terrain holes.

Interpretation update:

- Treat these as normals/material-orientation/debug-shading artifacts, not
  missing geometry.
- Do not use normals-highlighted-only regions as evidence for MC/Transvoxel
  topology failure unless the same region is also missing in flat-unlit mode.
- For topology work, prioritize only defects that remain visible as missing
  coverage in `Alt+F10` flat-unlit mode.
- For normals work, investigate vertex normals, geometric normal orientation,
  transition-normal blending, and material/debug normal visualization around
  the highlighted regions separately from the seam-hole investigation.

Current split:

```text
flat-unlit missing or white polygon/sliver -> mesh coverage / depth / extraction suspect
normals-only magenta/blue/purple highlight -> normals/material debug suspect
lit-mode dark band that disappears in flat unlit -> lighting/material/fog/AO suspect
```

### Flat unlit follow-up: intermittent small gaps remain

User-provided flat-unlit runtime dump and screenshot on 2026-05-25:

- `debug/wireframe-1779678080.png`
- `debug/wireframe-1779678080.json`
- `debug/terrain-hole-probe-20260525-030140.json`

Sidecar confirms:

```text
mode_flags.flat_unlit = true
mode_flags.normals = false
mode_flags.iso_band = false
```

Logged and parsed summary:

```text
camera_ray_fan.rays_with_gap = 28 / 169
camera_ray_fan.gap_classification counts =
  raw_occupancy_vs_mesher_iso_false_positive:16
  vertex_position_or_table_decode_error:2
  backface_or_winding:1
  unknown:9
camera_ray_fan.effective_lod_at_mesh counts =
  Lod0:25
  Lod1:1
  Lod2:2
camera_ray_fan source_chunk_skipped_lod_delta_gt_one rays = 0
camera_ray_fan transition-owner rays = 0
```

Center ray:

```text
classification = vertex_position_or_table_decode_error
first_voxel_solid_distance = 229.0
first_mesher_iso_distance = 228.862
first_front_render_hit = None
first_any_render_hit = None
visual mesher-iso pixel = lit_or_non_dark, rgb=(193,187,188)

mc_cell =
  chunk = (9,1,18), Lod0
  neighbor_lods = neg_x:Lod0 pos_x:Lod0 neg_y:Lod1 pos_y:Lod0 neg_z:Lod0 pos_z:Lod0
  cell = (6,15,15)
  case = 16
  class = 1
  boundary_faces = pos_y,pos_z
  transition_owner_faces = none
  expected_regular_triangle_count = 1
  actual_regular_triangle_count = 1
  emitted_regular_ray_hits = 0
  closest_regular_ray_distance = 0.312
```

Raw-surface cell differs from mesher-iso owner:

```text
raw_surface_cell =
  chunk = (9,1,19), Lod0
  cell = (6,15,0)
  case = 51
  transition_owner_faces = pos_y
  pos_y transition case = 511, expected_transition_triangle_count = 0
  regular triangles = 2 / 2, emitted_regular_ray_hits = 0
```

Interpretation:

- This confirms small flat-unlit defects still occur, but the latest center
  ray is not transition-owned. It is a regular Lod0 boundary cell with a
  single expected triangle that misses the ray.
- The failure is still not scheduler-related:
  `source_chunk_skipped_lod_delta_gt_one = 0`.
- The exact single-pixel screenshot classifier is too weak for these tiny
  slivers: it samples the center projection as normal flat terrain even though
  the user-visible defect is a small white polygon nearby.

Instrumentation update:

- The hole probe now records a local screenshot pixel window around each
  projected visual point, including bright, sky/background, dark, and lit pixel
  counts. This is intended to catch tiny flat-unlit white slivers that are
  missed by the exact one-pixel sample.

Next target:

- Re-run `Alt+F10 -> Alt+Shift+F7 -> Shift+F9` on one small visible gap after
  rebuilding, then inspect `visual_samples.*.pixel_window`.
- If the center ray still reports `case=16` or `case=51` with expected
  triangles emitted but no ray hit, build the replay fixture around that exact
  cell and ray.

### Flat unlit/wireframe confirmation: red rear LOD visible through foreground

User clarification on 2026-05-25: the latest `Alt+F10` screenshots still show
real holes because red rear-LOD wireframe can be seen through the foreground
terrain surface.

Interpretation update:

- Treat this as a true see-through geometry/render coverage failure.
- Do not let a single `lit_or_non_dark` center-pixel sample veto the ray
  evidence. The defect is sub-pixel/small-polygon enough that the exact center
  sample can land on adjacent grey terrain.
- The stronger evidence is the probe ray:

```text
first_front_render_hit = None
first_any_render_hit = None
expected_regular_triangle_count > 0
actual_regular_triangle_count > 0
emitted_regular_ray_hits = 0
source_chunk_skipped_lod_delta_gt_one = 0
```

- The screenshot pixel-window classifier is now supporting evidence only. It
  records local and nearby luminance ranges/bright-pixel counts so tiny white
  slivers and visible rear wireframe are easier to correlate with ray data.

Current leading bug class:

```text
regular/transition MC vertex placement or table decode produces triangles
for the owning cell, but those triangles do not cover the mesher-iso ray.
```

Current replay candidates:

```text
20260525-030140 center:
  Lod0 chunk=(9,1,18), cell=(6,15,15), case=16
  expected/actual regular triangles = 1/1
  emitted regular ray hits = 0

20260525-035752 center:
  Lod1 chunk=(9,1,19), cell=(6,7,0), case=51
  transition_owner_faces = pos_y
  expected/actual regular triangles = 2/2
  emitted regular ray hits = 0
```

Next implementation target:

- Add a dump-derived replay test for the center-ray geometry. The acceptance
  should be: ray through the mesher-iso point intersects at least one triangle
  emitted for the owning regular cell or its owning transition cell.

### Dynamic LOD settling holes and popping

User-reported runtime issue on 2026-05-25:

- While walking and LODs update gradually, small holes appear and then repair as
  adjacent chunks finish remeshing.
- This is visually distinct from the static fixed-camera mesh bug. It is a
  temporal consistency problem: one chunk can display a new LOD/transition state
  while its neighbor still displays an old mesh for a few frames.

Current code path:

```text
update_chunk_lod_system:
  computes a coherent desired LOD field
  enforces max-one logical LOD deltas
  calls chunk.set_lod_level(...)
  marks only changed chunks' face halos dirty

mesh_dirty_chunks_system:
  drains dirty chunks under a per-frame budget
  generates each chunk against the current world LOD/neighbor LOD state
  swaps each mesh entity as soon as that chunk is ready
```

Why this can pop holes:

- The logical LOD graph can be coherent while the displayed mesh graph is not.
- A chunk can be remeshed using neighbor LODs that are not yet represented by
  the neighbor's visible mesh.
- The throttled dirty queue can expose intermediate states like:

```text
frame N:   center switched to Lod1 mesh, neighbor still visible as old Lod0 mesh
frame N+1: transition/neighbor halo remesh arrives
frame N+2: visible hole disappears
```

Mitigation direction:

```text
Do not publish partial LOD neighborhoods.
```

Recommended design:

1. Split terrain LOD into at least two states:

```text
desired_lod      = what camera/hysteresis wants
active_lod       = what visible mesh entities currently represent
pending_lod      = target for an in-flight remesh transaction
```

2. Build LOD transactions instead of single chunk swaps:

```text
transaction seed = chunks whose desired_lod != active_lod
transaction closure =
  seed chunks
  all face neighbors
  transition-owner faces
  any chunks whose neighbor_lods_at_mesh would change
```

3. Generate every mesh in the transaction against one frozen LOD snapshot:

```text
snapshot_lods = active_lod with this transaction's pending_lod applied
```

4. Keep old visible meshes alive until the full transaction is ready.

5. Commit all ready meshes in one frame:

```text
active_lod = pending_lod for transaction chunks
swap mesh handles/entities together
clear dirty flags together
```

6. If the transaction is too large, split it into spatial waves, but each wave
   must include its face-neighbor halo and must preserve visible max-one LOD
   deltas after commit.

Important policy choices:

- Upgrades should be allowed to prepare in the background, but old lower-detail
  meshes must remain visible until the high-detail chunk plus required neighbors
  are ready.
- Downgrades should be delayed even more aggressively: keep fine meshes visible
  until the coarser mesh and its seam-neighbor closure are ready.
- If the dirty queue is backed up, freeze accepting new LOD transactions rather
  than continually changing desired targets. This trades delayed LOD response
  for stable terrain.
- Throttle by transaction count or triangle cost, not by individual chunks that
  can expose invalid intermediate seams.

Diagnostics to add:

```text
visible_lod_delta_gt_one_faces
mesh_neighbor_lod_mismatch_faces
pending_lod_transactions
lod_transaction_chunks_waiting
lod_transaction_chunks_ready
lod_transaction_commits_per_second
lod_publish_blocked_by_missing_neighbor_mesh
```

Acceptance for the dynamic path:

- While walking through the live LOD scene, the displayed mesh graph should
  never contain a face where the two visible meshes disagree by more than one
  LOD.
- A displayed mesh's `neighbor_lods_at_mesh` should match the neighbor's
  displayed `active_lod`, not merely the chunk's newest logical desired LOD.
- If a chunk is waiting for a transaction, the old mesh remains visible.
- Holes should not appear during LOD settling even when the dirty mesh budget is
  low.

This dynamic settling fix should be tracked separately from the static
dump-derived `case=16` / `case=51` replay fixtures.
