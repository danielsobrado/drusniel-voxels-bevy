# LOD Seam Audit: Two-Part Implementation

This document explains the two seam-audit implementation phases that landed in this repo:

1. The original deterministic seam-audit framework (geometry contract + runtime detectors + bench/guard wiring).
2. The strip-compatibility oracle extension (segment-set overlap checks in seam-frame space).

It focuses on what was built, where it lives, how it works, and what each signal means.

---

## 1) Part One: Deterministic Seam Audit Framework

### 1.1 Goal

Make LOD seam quality measurable and CI-checkable using deterministic, per-face diagnostics instead of ad-hoc visual inspection.

Primary outcomes:

- Classify every active X/Z seam face at mesh time.
- Confirm seam behavior in bench mode using runtime probes.
- Export structured evidence (`seam-audit.json`) plus stable counters in `summary.json`.
- Gate regressions in `bench_guard`.

### 1.2 Mesh-Time Contract (Per-Face Seam State)

Implemented in:

- `src/voxel/meshing/seam_audit.rs`
- `src/voxel/meshing/lod_seam.rs`
- `src/voxel/meshing/surface_nets.rs`
- `src/voxel/meshing/data.rs`
- `src/voxel/meshing/commit.rs`
- `src/voxel/runtime/mesh_scheduler.rs`

Core concepts:

- `SeamFaceMode` classifies final seam behavior (`StitchGeometry`, `GpuMorphOnly`, `SkirtFallback`, `InvalidUnsafeTopology`, etc).
- `SeamStripStatus` tracks strip availability and staleness (`HitCurrentRevision`, `MissingStrip`, `StaleRevision`, ...).
- `SeamFaceAudit` stores per-face counts and probe metrics.
- `SeamStripRejectReason` records why strip topology blocked stitch-safe modes (`MultiComponentStrip`, `MissingStrip`, `StaleStrip`, distance/span/crossing reasons from the runtime oracle).
- `TerrainSeamStripDebug` caches mesh-time own-boundary strips (sibling to `TerrainMeshDebug`; not `NeighborBoundaryStrips`).

Important detectors:

- **Partial morph unsafe topology**:
  - If `0 < morph_welded < morph_candidate` and no stitch and no skirt, mode becomes `InvalidUnsafeTopology`.
- **Multi-component strip gate** (transition-scoped):
  - When a real LOD transition exists and the face has or needs strip data, `fine_components != 1` or `coarse_components != 1` blocks `StitchGeometry` / `GpuMorphOnly` (→ `SkirtFallback`, `StaleStripFallback`, or `InvalidUnsafeTopology` with `strip_reject_reason`).
  - Empty faces (`fine_components == 0` with no strip need) are not flagged.

### 1.3 Runtime Seam Probe Pass (Bench/Debug)

Implemented in:

- `src/voxel/diagnostics/seam_audit_pass.rs`
- plugin registration in `src/voxel/plugin.rs`

The pass scans all active delta-1 seam faces and enriches the mesh-time audit with runtime evidence:

- **Coverage/lip probe** over seam-plane sample grid.
- **Open edge leak probe** on seam plane.
- **Terrace/lip indicators**.

The pass writes:

- `bench-runs/<run>/seam-audit.json`

And records counters into bench timing summary as:

- `Counter Seam Audit: ...`

### 1.4 Bench Integration

Implemented in:

- `src/diagnostics/bench/mod.rs`
- scene file `bench/scenes/lod-seam-audit.toml`

Bench checkpoints can request seam-audit snapshots at deterministic hold frames. Output becomes part of bench artifacts and CI guard input.

### 1.5 Guard Integration

Implemented in:

- `src/bin/bench_guard.rs`
- `assets/config/bench_guard.toml`

`bench_guard` loads sibling `seam-audit.json`, evaluates seam thresholds, and fails CI on seam regressions.

### 1.6 Part One Limitations

The first implementation was strong on structure and plumbing, but had known detector gaps:

- Edge leak used vertex-index keys (bad with per-triangle duplicated vertices).
- Stitch triangles were section-tagged as main surface instead of transition.
- Face-offset math included world-axis magnitude and over-reported.
- Guard had `max_face_offset_voxels` config but did not enforce it.
- Coverage probe is heightfield-biased and weak for overhang/cave/multi-sheet topology.

---

## 2) Part Two: Accuracy Fixes + Strip Compatibility Oracle

Part two includes two layers:

1. Immediate correctness fixes to existing detectors.
2. New strip overlap oracle for seam-frame geometric compatibility.

### 2.1 Correctness Fixes Before Oracle

Files:

- `src/voxel/diagnostics/seam_audit_pass.rs`
- `src/voxel/meshing/lod_seam.rs`
- `src/bin/bench_guard.rs`
- `src/diagnostics/bench/mod.rs`
- `src/voxel/meshing/tests.rs`

Fixes made:

- Edge leak keys changed to quantized world endpoints (not vertex IDs).
- Stitch triangles tagged with `TERRAIN_MESH_SECTION_TRANSITION_APRON`.
- `face_offset_delta` now measures seam-normal plane offset correctly.
- `max_face_offset_voxels` wired through summary + guard checks.
- Bench hold/screenshot path adjusted to reduce seam-audit timing race risk.

### 2.2 New Boundary-Strip Compatibility Oracle

Main file:

- `src/voxel/lod/boundary_strip.rs`

Added:

- `StripOverlapStatus`
- `StripOverlapConfig`
- `StripOverlapAudit`
- `audit_projected_strip_overlap(...)`

The old strict function `compare_projected_strips(...)` remains available for exact/equivalence-style checks.

### 2.3 Oracle Algorithm (Compatibility, not Equivalence)

The new oracle compares strips as 2D segment sets in seam-frame (`proj.x`, `proj.y`) and does **not** require equal segment count.

Checks:

1. Strip presence and non-empty segments.
2. Component constraints (single component for full compatibility path).
3. Span overlap ratio.
4. Directed set distance:
   - fine -> coarse
   - coarse -> fine
5. Endpoint nearest-segment distance.
6. Crossing/fold indicators.
7. Unmatched segment counts.

Outputs include:

- `status`
- `compatible`
- max directed distances
- max endpoint distance
- span overlap ratio
- unmatched fine/coarse segment counts
- crossing count

### 2.4 Seam Audit Data Model Extension

File:

- `src/voxel/meshing/seam_audit.rs`

`SeamFaceAudit` now also stores oracle metrics:

- overlap status
- compatibility bool
- directed distances
- endpoint distance
- span overlap ratio
- unmatched segment counts
- crossing count

### 2.5 Strip Oracle Wiring (Mesh-Time First)

Files:

- `src/voxel/diagnostics/seam_audit_pass.rs`
- `src/voxel/meshing/data.rs` (`TerrainSeamStripDebug`)
- `src/voxel/lod/boundary_strip.rs` (`CompactProjectedStrip`, `OwnBoundaryStrips`)

`enhance_audit_with_strip_overlap(...)` compares fine vs coarse neighbour strips using `audit_projected_strip_overlap(...)`.

**Primary input (schema v3):** mesh-time strips cached on each terrain entity as `TerrainSeamStripDebug` — one compact projected strip per X/Z face for **this chunk's own boundary export**. This is separate from `NeighborBoundaryStrips`, which holds coarse neighbour strips consumed by a fine chunk during stitching.

Oracle pairing at audit time (fine chunk, face `F`):

- **Fine strip:** `TerrainSeamStripDebug.strips[face_idx]`
- **Coarse strip:** neighbour entity `strips[opposite_face_idx]`

Each face record exports `strip_overlap_source`: `"mesh_time"` when both cached strips are present, else `"runtime_reextract"`.

**Fallback:** when either entity lacks `TerrainSeamStripDebug` for the paired face, the pass re-extracts from main-surface mesh section 0 at runtime (geometry-only; `StripVertex.normal` zeroed).

Strip overlap classification thresholds load from `assets/config/lod_seam_audit.yaml` via `StripOverlapConfig::load_or_default()` (`StripOverlapSettings` resource in `SeamAuditPassPlugin`). CI guard thresholds remain in `assets/config/bench_guard.toml` `[lod_seam_audit]` and are independent of oracle tuning.

### Runtime extraction caveat

The runtime oracle reconstructs strips from final mesh section 0. This is useful for bench/debug, but it must use the same boundary-band logic as mesh-time strip extraction. Exact face-plane filtering can miss valid Surface Nets boundary vertices inside the outer LOD cell band.

`extract_main_surface_strip_for_face(...)` therefore uses `world_pos_in_face_band(...)` with `lod.step_size()` instead of exact face-plane epsilon matching.

### Guard policy caveat

Strip compatibility failures should fail CI only for final modes that claim a sealed/stitch-safe seam (`StitchGeometry`, `GpuMorphOnly`). `SkirtFallback` and `StaleStripFallback` should record the oracle reason but should not fail span/distance compatibility thresholds through raw summary extrema.

`bench_guard` computes min span overlap and max strip distances from face records filtered by `claims_stitch_safe_seam(...)`, and only includes span ratios when the overlap status is geometrically meaningful. It does **not** use the summary block extrema for those threshold checks.

### Summary extrema semantics

`seam-audit.json` → `summary` still aggregates some strip metrics as **raw observed extrema** across every active seam face:

- `max_strip_fine_to_coarse_distance`
- `max_strip_coarse_to_fine_distance`
- `max_strip_endpoint_distance`

Those values can look high on `SkirtFallback` / `StaleStripFallback` faces where strips are missing or topology is ambiguous. That is expected diagnostic signal, not a guard failure by itself.

Stitch-safe compatibility distances are also written to `summary`:

- `max_strip_fine_to_coarse_distance_stitch_safe`
- `max_strip_coarse_to_fine_distance_stitch_safe`
- `max_strip_endpoint_distance_stitch_safe`

Use those fields (not the raw maxima) for dashboards and threshold checks. `bench_guard` reads them when `schema_version >= 2` and falls back to face-record aggregation on older dumps.

`min_strip_span_overlap_ratio` in `summary` already excludes missing/multi-component/early-return overlap statuses.

### 2.6 JSON and Summary Extensions

`seam-audit.json` face records now include strip-compatibility fields:

- `strip_overlap_status`
- `strip_overlap_source` (`mesh_time` | `runtime_reextract`)
- `strip_reject_reason`
- `fine_components` / `coarse_components`
- `strip_compatible`
- `strip_max_fine_to_coarse_distance`
- `strip_max_coarse_to_fine_distance`
- `strip_max_endpoint_distance`
- `strip_span_overlap_ratio`
- `strip_unmatched_fine_segments`
- `strip_unmatched_coarse_segments`
- `strip_crossing_count`

Summary strip distance fields:

- raw observed: `max_strip_fine_to_coarse_distance`, `max_strip_coarse_to_fine_distance`, `max_strip_endpoint_distance`
- stitch-safe: `max_strip_fine_to_coarse_distance_stitch_safe`, `max_strip_coarse_to_fine_distance_stitch_safe`, `max_strip_endpoint_distance_stitch_safe`

Summary also includes counts and policy-filtered `min_strip_span_overlap_ratio`. See **Summary extrema semantics** above.

`seam-audit.json` `schema_version` is `3` (mesh-time strip source, component counts, `strip_reject_reason`). Version `2` added stitch-safe summary distance fields.

### 2.7 Guard Extensions for Oracle

Files:

- `src/bin/bench_guard.rs`
- `assets/config/bench_guard.toml`

Added seam-oracle thresholds such as:

- max incompatible faces
- max missing faces
- max unsupported-topology stitched faces
- max directed distances
- max endpoint distance
- min span overlap ratio
- max crossing count
- `max_stitch_safe_bad_component_faces` (stitch-safe modes with multi-component mesh-time strips)

Guard logic evaluates these from `seam-audit.json`.

Hard-case bench scene: `bench/scenes/lod-seam-hard-cases.toml` with sculpted voxel fixture (`lod_seam_hard_case_fixture = true`, cache `bench-runs/cache/lod-seam-hard-cases-world.bin`).

### 2.8 New Unit Coverage

In `src/voxel/lod/boundary_strip.rs`, tests cover:

- different segment counts still compatible
- span mismatch
- directed distance exceeded
- endpoint distance exceeded

---

## 3) Operational Notes

- Strip overlap distance/span checks remain audit-only; they do not change meshing.
- Mesh-time **multi-component gate** does downgrade stitch-safe `final_mode` at classification time when strip topology is unsafe.
- Guard enforces whether stitch-safe decisions and oracle compatibility are acceptable.
- Own strips (`TerrainSeamStripDebug`) and neighbour-consumed strips (`NeighborBoundaryStrips`) must not be conflated.

---

## 4) Suggested Next Iterations

1. Expand hard-case fixture coverage and per-checkpoint expected `final_mode` / `strip_reject_reason` assertions.
2. Tune `assets/config/lod_seam_audit.yaml` thresholds from hard-case bench evidence.
3. Optional: reduce `CompactProjectedStrip` memory (quantized coords) if strip debug becomes hot in production builds.
