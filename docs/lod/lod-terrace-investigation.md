# LOD Terrace Investigation — Everything Tried, and the Real Fix

> Created: 2026-06-04 · Owner: terrain/rendering
> Scope: `src/voxel/meshing.rs`, `src/voxel/skirt.rs`, `src/rendering/triplanar_material.rs`
> Related: [GPU geomorph plan](gpu-terrain-geomorph-plan.md) ·
> [LOD seam closure plan](lod-seam-closure-plan.md) ·
> [LOD visual artifact fixes](lod-visual-artifact-fixes.md) ·
> [LOD terrain hole investigation](lod-terrain-hole-investigation.md)

## The symptom

On distant mountains a **dark, stepped band** appears along LOD seams — visible in
the user's circled screenshots at camera `pos = [256.5, 22.7, 256.5]`,
`look_at = [110, 30, 114]` (reproduced by
[`bench/scenes/visual/morph-seam-band.toml`](../../bench/scenes/visual/morph-seam-band.toml)).

Two distinct things were conflated under "dark band":

1. **Shading** — skirt/apron strips shaded near-black under the overhead sun.
2. **Geometry** — the coarse-LOD surface is **stair-stepped (terraced)**; the
   near-vertical step risers face sideways and read dark, *and* the steps are
   visible as geometry regardless of shading.

(2) is the dominant artifact and is what the user means by "I can still see the
terraces in the seams." This doc records every mitigation tried, why each did or
did not move (2), and the fix that finally targets the terrace **geometry** at its
source.

## Root cause (the load-bearing finding)

The terrain field is **binary occupancy at 1-voxel resolution**:
`terrain_occupancy_sdf_at_world` returns `-1` for solid/liquid and `+1` for air
([`meshing.rs`](../../src/voxel/meshing.rs)). Surface Nets places a vertex per
surface cell from the SDF zero-crossing; on a raw binary field the crossings snap
to the voxel lattice → **stair-steps**.

To counter this, **LOD0** runs an anti-terrace blur: `generate_sdf(..., smooth = true)`
replaces non-transition cells with `smoothed_sdf_from_block` — a 1-2-1 (Gaussian-ish)
blur of the occupancy block. That makes the field *fractional*, so the crossing
interpolates between voxel layers and LOD0 looks smooth. (`SMOOTH_TERRAIN_SDF_LOD0 = true`.)

**LOD1/2/3 never got the equivalent.** `generate_low_lod_sdf` point-sampled
`smoothed_terrain_sdf_at_world_pos` at coarse-aligned lattice positions (step 2/4/8).
Crucially, `smoothed_terrain_sdf_at_world_pos`'s blur kernel is only **±1 voxel
wide** — which is *sub-sample* at step ≥ 2. At step 8 the ±1 blur samples occupancy
immediately around a point that is itself 8 voxels from its neighbour, so the
coarse field is effectively **raw binary occupancy on the coarse lattice**. Surface
Nets then snaps coarse vertices to that lattice → **terraces of height ≈ step_size
(2, 4, or 8 voxels)**. These are the terraces.

So: *LOD0 was de-terraced; the coarse LODs that dominate the distant mountain were not.*

## What was tried (chronological), and what it did to the terraces

| # | Mechanism | Where | Effect on the **terrace geometry** |
|---|-----------|-------|-----------------------------------|
| 1 | **CPU Y-snap** of fine boundary verts to coarse iso height | `snap_boundary_vertices_to_lower_detail_neighbor` | Closes the *gap* between fine and coarse at the seam. Does **not** smooth the coarse steps — it welds the fine side onto the (still terraced) coarse side. |
| 2 | **Boundary SDF coarsening** (transition cells sample the neighbour's step) | `lower_detail_transition_step*` | Makes the seam *consistent* across LODs so no hole opens. Does **not** de-terrace; it deliberately keeps the boundary binary so both sides agree. |
| 3 | **Transition aprons + vertical skirts** | `skirt.rs` | Hide residual gaps with extra geometry. A band-aid by design; adds strips that can themselves shade dark. No effect on coarse step geometry. |
| 4 | **Skirt boundary-band edge detection fix** (`00f488c`) | `skirt.rs::extract_boundary_edges` | Correctness fix so skirts attach to the fractional-SDF boundary band. Did not touch terraces. |
| 5 | **MC + Transvoxel spike** (parallel, gated off) | `src/voxel/mc_transvoxel/` | Alternative seam topology. Orthogonal; not enabled in production. Would change seam *topology*, not the coarse SDF that terraces. See [mc-transvoxel-plan.md](mc-transvoxel-plan.md). |
| 6 | **GPU geomorph v1** (PR1–PR3, gated `VOXELS_TERRAIN_MORPH`) | `meshing_lod.rs`, `triplanar_material.rs`, `triplanar_terrain_vertex.wgsl` | Static GPU weld of fine boundary verts to the coarse target. **Decision D1: v1 == CPU snap visually.** Welds fine→coarse, so it makes the fine side match the terraced coarse side. **Does not remove terraces.** |
| 7 | **Skirt-normal fix** (uncommitted) | `skirt.rs` ~485–507 | Replaced the 20%-toward-horizontal `blended_normal` with surface-normal inheritance, removing the *shaded* dark strip on skirts. Real but minor — md5 of the before/after screenshot differs, but the dominant band is unchanged. **Fixes shading (1), not geometry (2).** |
| 8 | **Hole-probe diagnosis** (Shift+F9 / bench `hole_probe`) | `terrain_debug.rs` | Confirmed the surface is **watertight**: `active_seam_face_count = 0`. So the band is **not** a hole/missing chunk — it is real coarse geometry. |
| 9 | **Before/after camera A/B** at the user's pose | `morph-seam-band.toml` | With (7) applied vs reverted, the band persists in both → confirms the band is coarse-LOD **terrace geometry**, not skirt normals. |

### Why GPU geomorph (even v2) does not fix *these* terraces

This is the key reason coarse-LOD smoothing was chosen over "finish geomorph":

- v1 geomorph welds the **fine** boundary vertices onto the **coarse** target. That
  direction makes the fine side *agree with* the terraced coarse side — it cannot
  un-terrace the coarse mesh. (Confirmed: D1, "v1 weld == snap".)
- v2 geomorph (distance blend, the rejected Option A) smooths the **pop** when a
  chunk swaps LOD as the camera moves. At a **fixed** distance the coarse chunk
  still renders at full coarseness, so a *static* distant mountain stays terraced.
  The user sees terraces on a static view → geomorph is the wrong tool for this
  artifact. Geomorph fixes *transition popping*, not *static coarse blockiness*.

Net: the terraces are a property of the **coarse SDF**, so the fix has to live in
how the coarse SDF is built — not in snap, skirts, or the display-time morph.

## The fix — coarse-LOD anti-terrace smoothing

Extend LOD0's proven anti-terrace policy to the coarse LODs, **scaled to the step
size**. Implemented in [`meshing.rs`](../../src/voxel/meshing.rs):

- **`coarse_smoothed_sdf_at_world_pos(world, pos, step)`** — same policy as
  `smoothed_terrain_sdf_at_world_pos` (solid centre → hard `-1` to preserve thin
  features; air centre → 1-2-1 blur clamped to `≥ SIGN_GUARD`), but the 1-2-1 taps
  are spaced **`step` voxels apart** so the kernel spans a whole coarse cell. The
  fractional values slide the Surface-Nets crossing off the coarse lattice → the
  steps flatten. Reads only world occupancy at coarse-aligned offsets, so adjacent
  coarse chunks agree on shared cells (no new seams).
- **`generate_low_lod_sdf`** now uses that blur for **interior** cells and keeps the
  existing binary `smoothed_terrain_sdf_at_world_pos` for **LOD-transition** cells
  (so the boundary weld that snap/skirts target is unchanged — seams stay closed).
- Gated by **`coarse_terrain_sdf_smooth_enabled()`** (env `VOXELS_COARSE_SDF_SMOOTH`),
  **default on**. Set `VOXELS_COARSE_SDF_SMOOTH=0` for a legacy-binary A/B baseline.

### Why this is cheap

The blur early-returns `-1` for solid centres (1 sample) and does at most 27
occupancy samples for air centres — the **same count** as the existing
`smoothed_terrain_sdf_at_world_pos` it replaces. Only the tap *spacing* widens, so
no extra samples per cell. Expected meshing-cost impact ≈ neutral (verified by
bench, below).

### Tests (`cargo test --lib`, all 414 pass)

- `coarse_smoothed_solid_center_stays_hard_negative` — thin features preserved.
- `coarse_smoothed_air_center_blurs_step_distant_solid` — an air cell a full step
  above solid reads a **fractional** value, while the legacy ±1-voxel blur reads a
  flat `1.0` (the terrace cause). This is the de-terrace mechanism, asserted.
- `coarse_smoothed_deep_air_stays_positive_one` — no spurious pull far from solid.

### Bench A/B

<!-- BENCH_RESULTS -->
**2026-06-04, `morph-seam-band` A/B (smoothing OFF vs ON), same binary, env-toggled:**

- Runs: `bench-runs/2026-06-04T02-49-34Z` (OFF, log confirmed
  "Coarse-LOD SDF anti-terrace smoothing: DISABLED") vs `2026-06-04T02-48-34Z` (ON).
- ImageMagick `compare -metric AE`: **412 107** pixels differ (amplified diff
  `bench-runs/terrace-diff-amplified.png` shows the change concentrated on the
  **mountain** and far terrain; the close foreground mesas — LOD0 — are unchanged,
  as expected).
- **But the change is NOT a visible terrace fix.** Mountain crops (`bench-runs/mtn-ON.png`
  vs `mtn-OFF.png`, 3× zoom) are near-identical: the **dark dotted seam band** and
  the **stepped left silhouette** persist in both.

**Honest conclusion: the interior-cell coarse smoothing is insufficient for the
visible artifact.** The dominant band sits on the **LOD-transition boundary**, and
this fix deliberately leaves transition cells binary (to preserve the weld). So the
remaining terrace/band is most likely **transition-cell stair geometry and/or the
skirt-apron strips**, not the interior coarse surface. Needs the follow-up
classification + fix in [Open / follow-ups](#open--follow-ups). Coarse smoothing is
kept (correct, cheap, default on) but is not the whole answer.

### 2026-06-04 follow-up: transition boundary geometry

The user's later screenshots narrowed the remaining artifact to the **seams
between LOD junctions**. Additional A/B runs confirmed that:

- Disabling transition skirts/aprons did not remove the dark horizontal band.
- Keeping every chunk at LOD0 removed the band.
- Coarse smoothing alone, including transition-band smoothing, reduced coarse
  stair-stepping but did not remove the visible junction shelf.

The working fix is therefore transition-boundary **effective mesh LOD refinement**
for Surface Nets: a Lod1 chunk that directly borders a base Lod0 neighbor is
meshed as Lod0 for the terrain surface. Refinement decisions use base neighbor
LODs to avoid a cascading promotion front; the mesh still receives effective
neighbor LODs for seam sampling and debug metadata.

Validation:

- `bench-runs/2026-06-04T09-49-25Z/morph-seam-band-mountain-dark-band-view-run0.png`
  removes the dark horizontal mountain seam band.
- `debug/terrain-hole-probe-mountain-seam-20260604-100300.json` matches the
  earlier probe: `active_seam_face_count = 0`,
  `active_seam_faces_with_possible_terrace = 0`,
  `active_seam_faces_with_open_edges = 0`, and
  `active_seam_faces_with_transition_coverage_gaps = 0`.
- The same probe still reports `rays_with_gap = 4`,
  `gap_classification = "unknown"`, and `world_data_hole = true`; this matched
  the prior probe and was not introduced by the fix.

Perf caveat:

- `visual-regression-live-lod` remains a guard failure after this fix. The latest
  run (`bench-runs/2026-06-04T09-52-18Z`) reports `Mesh Dirty:p99_ms` around
  57-61 ms and forest frame p99 98.344 ms. The visual fix is correct, but the
  transition-promotion path still needs a face-local or incremental meshing
  follow-up before it is performance-clean.

## Status of the tree (branch `feat/gpu-geomorph`)

- **Committed (`a31ec74`):** GPU geomorph PR1–PR3, gated off (`VOXELS_TERRAIN_MORPH`).
  Kept as v2 infrastructure / collider-fine-mesh win; **not** a terrace fix.
- **Uncommitted, this work:** coarse-LOD anti-terrace smoothing (`meshing.rs`) + tests;
  skirt-normal shading fix (`skirt.rs`); morph-active logs; diagnostic bench scenes.

## Perf regression from the promotion, and the levers tried (2026-06-05)

`transition_refined_surface_nets_lod` (d78d0bb) fixes the visual band by promoting
every Lod1 chunk that touches a Lod0 neighbor to **full Lod0 meshing**. That meshes a
one-chunk-wide ring at ~5–8× cost and re-meshes it as the LOD front moves. Two
symptoms: `visual-regression-live-lod` `Mesh Dirty:p99 ≈ 60 ms` (frame p99 ~100 ms vs
~40 baseline), and — because a LOD transaction prepares 1 chunk/frame and publishes
atomically — displayed seams lag ~1.3 s behind a moving camera and tear open (the
"vertical spikes / moving cracks" the user reported, confirmed via the camera-height
fan: transient, worst on promoted chunks during motion; steady-state near_face ≈
interior, so **not** a snap depression).

Cheap levers tried, each benched — **all rejected or neutral**:

| Lever | Result | Verdict |
|-------|--------|---------|
| Snap-target iso uses solid-preserving blur (match coarse surface) | probe byte-identical (near_face≈interior) | **no-op, reverted** |
| Dedup `NeighborLod`-only re-meshes with unchanged inputs (`Chunk::last_terrain_mesh_key`) | live-LOD within noise (continuous motion = genuine churn, not redundant) | **kept** (helps stop-and-go only; not the fix) |
| LOD transaction prepare rate 1 → 8 / frame | frame p99 133–136 ms, Mesh Dirty p99 ~106 ms | **regression, reverted** (heals cracks but worse stutter) |

**Conclusion:** the cost is *genuine* Lod0 meshing of the promotion ring. No cheap
lever removes it — you either mesh the ring (cost), don't (band returns), or replace
whole-chunk promotion with real transition geometry. The remaining true fix is
**face-local refinement (Transvoxel-style transition cells)**:

- Keep the chunk body at its native Lod1; emit a **fine transition strip only on the
  Lod0-facing boundary band** that interpolates Lod1→Lod0 (no internal T-junction).
- This is the same mechanism as the gated `src/voxel/mc_transvoxel/` spike, so the
  pragmatic path is to **evaluate MC+Transvoxel as the SN transition solution**
  (MTX-037) rather than hand-roll a second transition mesher.
- Scope: new mesh section + winding/normals + its own dirty/transaction handling +
  tests + full live-LOD/visual A/B. A dedicated effort, not a hot-path tweak.

Diagnostic tooling for this lives in the bench now: `terrain_debug = { wireframe|normals }`
per checkpoint, plus `morph-seam-spike-probe.toml` (camera-height fan) and the
`morph-seam-*` scenes.

## Open / follow-ups

- Y-face coarse cells: the step-scaled blur applies on all axes, but the
  LOD-transition **Y** weld is still the weaker path (`lower_detail_transition_step`
  history; see [lod-seam-closure-plan.md](lod-seam-closure-plan.md)).
- If distant silhouettes now look *too* soft at LOD3 (over-smoothing thin ridges
  that step 8 cannot represent anyway), consider a per-LOD blur radius (e.g. `step`
  for LOD1/2, `step/2` for LOD3) — left as a tuning knob, not done yet.
- Decide whether to keep the skirt-normal shading fix (correct but minor) when this
  geometry fix lands; with smoother coarse geometry the skirts matter less.
