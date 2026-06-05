# LOD Seam — Master Issues & Solutions Log

> Last updated: 2026-06-05. Consolidated index of the LOD-seam work across both
> terrain meshers. Detailed evidence lives in the linked docs; this file is the
> single source of truth for **what the problem was, what was tried, what the
> outcome was, and what remains** to make each path production-perfect.

Related detail docs:
[lod-terrace-investigation.md](lod-terrace-investigation.md) ·
[mc-transvoxel-hole-diagnosis.md](mc-transvoxel-hole-diagnosis.md) ·
[mctx-decision.md](mctx-decision.md) ·
[gpu-terrain-geomorph-plan.md](gpu-terrain-geomorph-plan.md) ·
[lod-seam-closure-plan.md](lod-seam-closure-plan.md)

## The two paths

There are two terrain meshers behind a chunk LOD system (LOD0 step 1 → LOD3 step 8).
Neither is yet perfect; they have **opposite** strengths:

| Path | Visual at LOD seams | Perf | Default |
|------|--------------------|------|---------|
| **Surface Nets + transition promotion** (`generate_chunk_mesh_surface_nets*`, `transition_refined_surface_nets_lod`) | **Correct** (band closed) | **Regressed** (`Mesh Dirty p99 ~60 ms`, frame p99 ~100 ms) | **Production** |
| **MC + Transvoxel** (`src/voxel/mc_transvoxel/`, gated `mc_transvoxel.enabled`) | **Broken** (open seam edges + ≤5 vox terrace) | **Excellent** (`Mesh Dirty p99 ~1.5 ms`, frame p99 ~28 ms) | Spike, off |

**"Perfect both"** therefore means: give SN the MC perf, and give MC the SN visual.
Both are large, multi-pass efforts (details below). MC is the higher-leverage target —
if its holes close it is *both* fast and correct, collapsing the two paths into one.

## Issue → root cause → solution → status

| # | Issue (symptom) | Root cause | Solution tried | Status |
|---|-----------------|-----------|----------------|--------|
| 1 | Distant mountain **dark band** at LOD seam | Skirt/apron strip at the Lod0↔Lod1 boundary shading dark (sideways normals); under it, fine/coarse SDF disagree | SN: **transition promotion** (Lod1 touching Lod0 meshes as Lod0) + sealed-face skirts + fractional snap (`d78d0bb`) | **FIXED (SN)**, verified via wireframe/normals classifier |
| 2 | Coarse-LOD **terraces** (stair-stepped distant surface) | Coarse LODs sampled a ±1-voxel-blurred *binary* occupancy field at coarse stride → SN snaps to coarse lattice | SN: **step-scaled coarse SDF smoothing** (`coarse_smoothed_sdf_at_world_pos`, `dbd5a44`) | **REDUCED**; inherent at LOD2/step-4 distance |
| 3 | "Vertical spikes" / moving cracks on the SN mountain | **Transient seam lag**: LOD transaction prepares 1 chunk/frame, publishes atomically → seam lags ~1.3 s behind a moving camera. Steady-state `near_face≈interior` (not a snap depression). | Diagnosed via camera-height fan; see rejected levers below | **DIAGNOSED**; fix = MC perf path or face-local |
| 4 | SN **perf regression** (`Mesh Dirty p99 ~60 ms`) | Promotion meshes a whole Lod1 ring at **Lod0 (~5–8×)** and re-meshes it as the LOD front moves | Levers tried, all rejected/neutral (see below) | **OPEN** — needs face-local (see Path A) |
| 5 | MC small **holes** + **chunk-square / terrace lines** | MC transition cells are **not watertight**: adjacent fine/coarse chunk meshes have **open seam edges** (10–29 unmatched edges/face) and **seam height delta ≤5.1 voxels**. NOT delta>1 (probe: `skipped_lod_delta_gt_one = []`), NOT transition-coverage gaps (0). | Many real fixes already landed (see MC sub-table) | **OPEN** — needs watertight transition (Path B) |

### SN perf levers tried (Issue 4) — all rejected or neutral

| Lever | Bench result | Verdict |
|-------|-------------|---------|
| Snap-target solid-preserving iso march | probe byte-identical (`near_face≈interior`) | no-op, reverted |
| Dedup `NeighborLod`-only re-meshes (`Chunk::last_terrain_mesh_key`) | live-LOD within noise (continuous motion = genuine churn) | kept (stop-and-go only), `3a6ba8d` |
| LOD transaction prepare rate 1→8 | frame p99 133–136 ms, Mesh Dirty 106 ms | regression, reverted |

Conclusion: the cost is *genuine* Lod0 ring meshing; no cheap lever removes it.

### MC fixes already landed (Issue 5) — from [mc-transvoxel-hole-diagnosis.md](mc-transvoxel-hole-diagnosis.md)

Padded-cell SDF offset (`cell+1+corner`); transition triangle winding (invert handling);
PosZ/NegX/NegY face-frame tangent signs; empty-transition-owner keeps regular row;
non-destructive boundary rows under transition aprons; MC vertex normals from the padded
grid; SDF sign clamp; `enforce_lod_delta_max_one` (refines coarser side, forced changes
bypass the per-update cap). These fixed real bugs but did **not** close the seam.

## Path A — make SN+promotion perf-perfect

**Root cause:** whole-chunk Lod0 promotion of the transition ring is expensive and
re-runs as the camera moves. **Fix = face-local refinement:** keep the chunk body at its
native LOD; refine only the Lod0-facing boundary band. Doing that correctly **is**
Transvoxel-style transition cells — i.e. it converges on Path B. Net: don't build a third
transition mesher; perfect MC instead and retire promotion.

If SN must stay primary: the only safe partial mitigations are (a) accept the perf debt,
or (b) reduce LOD-change frequency (more hysteresis), which trades visual responsiveness.

## Path B — make MC+Transvoxel visually perfect

**Accurate root cause (probe `terrain-hole-probe-spike-20260605-015544.json`):**
transition cells are **not watertight** — `active_seam_face_count = 10`, every face has
**open seam edges** and a **fine/coarse height delta up to 5.1 voxels**. The fine (Lod0)
chunk boundary and the coarse (Lod1) neighbor boundary do not share edges and sit at
different heights.

**Remaining work (the hard part of Transvoxel), in order:**

1. **Watertight transition seam.** The transition cell's low-resolution samples (the side
   facing the coarse neighbor) must reproduce the coarse neighbor's *exact* boundary
   vertices so edges match. Today they diverge → open edges. Build per-cell replay
   fixtures (dumped SDF/case/ray) for the 10 active faces; compare emitted boundary
   vertices against the coarse neighbor mesh; fix the sample/positions until
   `unmatched_seam_edge_count = 0`.
2. **Seam height delta (terrace).** The ≤5 voxel fine/coarse disagreement must drop to
   ≤0.10 vox (MTX-037 gate 4). Likely the same fix as (1) once the transition vertices
   sit on the shared coarse surface.
3. **MC skirt fallback** for any residual unmatched edge (band-aid parity with SN), only
   if (1)/(2) leave a small remainder.
4. Re-run the **MTX-037 A/B** (`morph-seam-spike-probe` + `visual-regression-live-lod`).
   Flip the default to MC only when hole-probe ray fraction ≤5% **and** the perf win both
   hold (criteria in [mctx-decision.md](mctx-decision.md)).

## Recommendation

MC is the convergence point: it already wins perf, so closing its watertight-seam holes
(Path B, items 1–2) makes it both fast and correct and lets promotion be retired. Pursue
Path B as a dedicated continuation using the replay-fixture loop; keep SN+promotion as
production (visually correct) until MC passes the MTX-037 gate.

## Verification tooling (reusable)

- Bench `terrain_debug = { wireframe | normals | iso_band | flat_unlit }` per checkpoint
  (classifies seam artifacts: section colours / normals).
- `morph-seam-spike-probe.toml` — camera-height fan + hole probe at the spike mountain.
- `morph-seam-band-debug.toml`, `morph-seam-spikes*.toml` — band/spike scenes.
- Hole-probe `normalized_summary`: `active_seam_faces_with_open_edges`,
  `max_active_seam_delta_voxels`, `chunks_with_skipped_lod_delta_gt_one`,
  `gap_classification_counts`.
- ImageMagick A/B: `magick compare -metric AE a.png b.png null:`,
  `magick a.png b.png -compose difference -composite -auto-level diff.png`.
- Build/bench gotcha: prefix cargo with `RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER=`
  (project `.cargo/config.toml` forces sccache, which isn't installed here).

## 2026-06-05 Surface Nets geomorph target fix

The GPU morph shader path was verified active: boundary vertices had morph target
rows and the shader moved them. The visible shark-tooth seam was therefore treated
as a target-generation bug, not a shader or normal bug.

Root cause: fractional X/Z boundary vertices were selected correctly, but the
target kept the fine vertex's fractional local coordinate while sampling coarse
height at the seam column. That mixed fine-local and seam-world coordinates and
could produce alternating pulled triangles along a frozen LOD seam.

Changes made:

- `xz_face_coarse_target_local` computes X/Z seam targets in one place.
- X/Z face targets now anchor to the shared boundary plane before upload:
  `+X -> local.x = CHUNK_SIZE`, `-X -> local.x = 0`,
  `+Z -> local.z = CHUNK_SIZE`, `-Z -> local.z = 0`.
- Coarse target height still comes from `coarse_lod_iso_height_for_column`, which
  walks and blurs using the target neighbor LOD step size.
- Visual Lod3 targets are clamped to Lod2 to match `visual_surface_nets_lod`.
- LOD delta > 1, missing coarse targets, invalid values, and targets beyond
  `TerrainMorphConfig::max_stitch_distance` reject to fallback instead of sealing
  with bad morph targets.
- Hole-probe snap stats now expose boundary candidate count, morph target count,
  and missing morph target count.
- `Alt+F11` draws morph vectors from uploaded `POSITION` to uploaded
  `ATTRIBUTE_MORPH_TARGET.xyz`: cyan = valid, red = invalid/oversized.

Verification run:

- `cargo test morph --lib`: 12 passed.
- `cargo test snap --lib`: 25 passed.
- `cargo test terrain_debug --lib`: 5 passed.
- `cargo check --lib`: 0 errors; two unrelated unused-import warnings remain in
  `terrain/tools/apply.rs` and `voxel/mesh_invalidation.rs`.
- Release visual bench: `bench-runs/2026-06-05T13-45-21Z/summary.json`.
- `bench_guard` still fails performance thresholds (`forest_frame_avg 42.283 ms`,
  `forest_frame_p99 95.623 ms`, `forest_mesh_dirty_p99 59.690 ms`), so this is a
  geometry fix, not a perf fix.

Status: target math for the shark-tooth GPU morph seam is fixed. Representative
bench screenshots still show distant blocky shelves, so remaining artifacts are
likely coarse/proxy shape or fallback behavior rather than shader transport.

## 2026-06-05 Surface Nets geomorph wall follow-up

This is the current state after live testing the target fix above. The target
math change was useful, but it did **not** remove the large wall/slab artifact.
The remaining wall had to be diagnosed as a separate base-mesh problem.

### Latest evidence

The latest failing live probe was `debug/terrain-hole-probe-20260605-175423.json`.
The important lines:

- `mesh_status counts Current:49`: stale/pending chunks were not required to
  reproduce the wall in this capture.
- `mesh_section=main_surface count=49`: every camera-height hit was base terrain
  geometry, not `transition_apron`, `vertical_skirt`, or the morph-vector overlay.
- Signed render-vs-voxel errors reached `13.67` voxels on Lod0 near-face/interior
  samples.
- The user confirmed the artifact moved with live LOD seams and was not in a
  water area.

Interpretation: the visible slabs were real Surface Nets `main_surface`
triangles generated by the base SDF, not shader transport, water, stale meshes,
NAADF preview, or skirt geometry.

### Hypotheses and outcomes

- **NAADF/F11 preview conflict:** confirmed as a separate confusion source.
  `Alt+F11` terrain morph debug was also triggering the plain F11 voxel-ray
  preview. Fixed in `ray_tracing.rs` by requiring unmodified F11 for voxel-ray
  preview. This removed NAADF-preview walls from the investigation, but the LOD
  seam wall remained.
- **Skirt/apron wall:** rejected for this artifact. The probe classified the
  geometry as `main_surface`; wire/debug colors showed this was not a transition
  curtain.
- **Stale/pending chunks:** still a valid separate bug class, but not the root
  cause here. One earlier probe reported stale/pending chunks; the later failing
  probe had all current meshes and reproduced the wall.
- **Water-as-solid SDF:** considered because some earlier height hits clustered
  near `WATER_LEVEL`. Deprioritized after live confirmation that the area had no
  water and the wall moved with the LOD seam.
- **Morph target conflict at seam ends:** patched as a safety fix. GPU morph
  target generation now rejects multi-face vertices whose face-local targets
  disagree, matching CPU snap conflict handling. The wall remained unchanged, so
  this was not the primary wall cause.
- **Base SDF formula switch:** confirmed. `generate_sdf` was changing formulas
  inside the LOD0 base extraction array: interior cells used the uniformly fine
  SDF while transition-band cells used `lod_transition_step` and
  `coarse_transition_smoothed_sdf_at_world_pos`. On steep terrain this can create
  an artificial sign change between adjacent cells, so Surface Nets emits a
  vertical/flat `main_surface` slab that exists only because the SDF formula
  changed at the seam band.

### Current fix

The GPU morph architecture now separates base mesh extraction from coarse target
generation:

- Added `BaseSdfTransitionMode::{Uniform, Coarsen}` in `meshing.rs`.
- With `terrain_morph_config().enabled`, Surface Nets base extraction uses
  `Uniform`; the base `POSITION` mesh stays own-LOD/fine right up to the seam.
- Coarse-neighbor sampling stays in morph target generation
  (`coarse_lod_iso_height_for_column` and `meshing_lod.rs`), where it computes
  `ATTRIBUTE_MORPH_TARGET`.
- Legacy coarsened-base behavior remains explicit for morph-off tests and
  MC/Transvoxel support, so this does not silently change the MC spike path.
- Low-LOD SDF generation uses the same explicit transition-mode split, so the
  behavior is no longer hidden inside the default helper.

Regression added:

- `lod0_morph_base_sdf_keeps_transition_band_uniformly_fine`: proves a fixture
  where the legacy coarsened transition band turns solid stays identical to the
  fine SDF when GPU morph base mode is uniform.

Verification after this patch:

- `rtk cargo test voxel::meshing::tests --lib`: 65 passed.
- `rtk cargo test voxel::meshing_lod::tests --lib`: 12 passed.
- `rtk cargo test voxel_ray_backend_toggle_requires_unmodified_f11 --lib`: passed.
- `rtk cargo check`: 0 errors; existing unrelated unused-import warnings remain
  in `terrain/tools/apply.rs` and `voxel/mesh_invalidation.rs`.
- `rtk git diff --check`: clean.

Current status: **unit/check verified, not yet live/bench verified**. Expected
live result is that the large `main_surface` wall/slab at the moving LOD seam
disappears. If smaller cracks or shark teeth remain after this, diagnose them as
morph-target/coarse-proxy issues only after confirming the base wall is gone.
