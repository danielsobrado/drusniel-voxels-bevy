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

Important detector at this stage:

- **Partial morph unsafe topology**:
  - If `0 < morph_welded < morph_candidate` and no stitch and no skirt, mode becomes `InvalidUnsafeTopology`.

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

### 2.5 Runtime Oracle Wiring

File:

- `src/voxel/diagnostics/seam_audit_pass.rs`

Added `enhance_audit_with_strip_overlap(...)`.

Current implementation extracts seam strips from **main-surface mesh section** at runtime and compares:

- fine face strip
- coarse neighbor opposite-face strip

using `audit_projected_strip_overlap(...)`.

This keeps the oracle in audit/bench path (not hot meshing path), so production behavior is not changed by oracle decisions.

### 2.6 JSON and Summary Extensions

`seam-audit.json` face records now include strip-compatibility fields:

- `strip_overlap_status`
- `strip_compatible`
- `strip_max_fine_to_coarse_distance`
- `strip_max_coarse_to_fine_distance`
- `strip_max_endpoint_distance`
- `strip_span_overlap_ratio`
- `strip_unmatched_fine_segments`
- `strip_unmatched_coarse_segments`
- `strip_crossing_count`

Summary includes aggregate strip metrics (counts/extrema/min overlap ratio).

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

Guard logic evaluates these from `seam-audit.json`.

### 2.8 New Unit Coverage

In `src/voxel/lod/boundary_strip.rs`, tests cover:

- different segment counts still compatible
- span mismatch
- directed distance exceeded
- endpoint distance exceeded

---

## 3) Operational Notes

- This oracle is audit-only in current form.
- Meshing still decides stitch/fallback as before.
- Guard enforces whether those decisions are acceptable.
- This separation is intentional: it allows oracle hardening without destabilizing runtime meshing decisions.

---

## 4) Suggested Next Iterations

1. Add config loading for `StripOverlapConfig` from asset config instead of defaults.
2. Add explicit multi-component fallback policy checks tied to `final_mode`.
3. Consider projected-strip debug caching from mesh-time extraction to avoid runtime re-extraction variability.
4. Expand integration scenes focused on caves/overhangs/multi-sheet seam cases.
