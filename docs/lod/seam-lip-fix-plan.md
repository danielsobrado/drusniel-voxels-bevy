# LOD seam lip/hole fix plan (audit-driven, resumable)

Living plan for closing the **real** seam artifacts (the lips/holes seen in play), grounded in
the deterministic [seam audit](./lod-seam-audit-implementation.md) rather than screenshots.
Update the **Status log** at the bottom as fixes land so this is resumable anytime.

The separate `InvalidUnsafeTopology` faces are a parked gen-script issue — see
[seam-invalid-topology-gen-bug.md](./seam-invalid-topology-gen-bug.md), not this plan.

---

## 1. Diagnosis (data, not guesses)

Source: hard-case fixture, `bench-runs/2026-06-08T12-20-06Z/seam-audit.json` (schema 3).
Reproduce: `cargo run --release -- --bench bench/scenes/lod-seam-hard-cases.toml`.
(The everyday scene `lod-seam-audit.toml` is a long full-world run; the fixture is the fast,
adversarial signal. Numbers below are worst-case.)

### Mode tally — 83 active X/Z seam faces
| Mode | Count | Note |
|---|---|---|
| StitchGeometry | 47 | stitch ran + bridged |
| NoTransition | 30 | not a real seam |
| InvalidUnsafeTopology | 6 | parked gen bug (separate doc) |
| **GpuMorphOnly** | **0** | the smooth morph-weld path is **never** chosen |

So of 53 real transition faces, **47 stitch and 0 morph-weld**.

### The lips are height steps on a watertight seam
- `open_edge_faces = 0` — **no torn holes**; every seam is closed by the stitch.
- Stitched-face lip height: **avg 0.66, max 1.56 voxels**.
- Only **5 of 47** stitch cleanly (`strip_reject_reason = None`); the rest:
  - `SpanMismatch` 33 — fine/coarse boundaries cover different spans (avg span overlap **0.72**, min 0.31).
  - `DirectedDistanceExceeded` 9 — coarse boundary up to **4.6 voxels** away.
  - `MultiComponentStrip` 1 — the vertical/fold case is a *single face*.

### Worst stitched faces (the visible lips)
| source chunk | face | LOD | reject | span overlap | coarse→fine dist | lip (vox) |
|---|---|---|---|---|---|---|
| `(4,4,21)` | pos_z | L0→L1 | SpanMismatch | 0.81 | 0.0 | **1.56** |
| `(7,6,25)` | pos_z | L0→L1 | DirectedDistanceExceeded | 0.96 | **4.61** | high |
| `(5,6,21)` | pos_z | L0→L1 | SpanMismatch | **0.31** | 0.0 | high |
| `(23,4,27)` | pos_x | L0→L1 | DirectedDistanceExceeded | 0.99 | 0.70 | high |

Note `(4,4,21)`: 0.81 span overlap (well-aligned) yet a 1.56-voxel lip → the lip is a **Y
height difference** between the fine and coarse surfaces at the seam, not just span misalignment.

---

## 2. Root cause

The stitch (Stage 4) **un-morphs the fine boundary and bridges from its Surface-Nets height to
the coarse boundary**. Where the fine surface sits higher/lower than the coarse surface at the
seam (always, to some degree — that's what LOD coarsening does), the bridge is a near-vertical
strip = the lip. It is watertight (good) but stepped (the artifact).

The smooth alternative — **morph the fine boundary band down/up to the coarse height
(`GpuMorphOnly`)** — is never selected (0 faces). That path removes the lip by blending the fine
surface to meet the coarse, but historically left **holes** when the morph target was missing or
over-distance, which is exactly why the stitch was added.

**The tension, now quantified:**
- Stitch = watertight, but ~0.66 avg / 1.56 max voxel lip.
- Morph = smooth (no lip), but hole-risk when the target is missing/over-distance.

The fix is not "morph vs stitch" — it is **route each face to the right one using the audit
signals we now have** (span overlap, directed distance, component count, strip presence).

---

## 3. Fix plan (ranked)

### A. Route good-segment faces to `GpuMorphOnly` (primary, biggest lip win)
For a face with a **single-component**, **in-distance**, **high-span-overlap** coarse segment,
prefer the morph weld (pull fine boundary to the coarse height) instead of un-morph + stitch.
This converts the well-aligned `SpanMismatch` faces (span ≥ ~0.8) from lip-stitches into smooth
welds. Keep stitch as the fallback when the segment is over-distance or multi-component.
- **Where:** `lod_seam.rs` `append_seam_stitches` / the seam-mode classification in
  `seam_audit.rs` already computes the inputs (`strip_span_overlap_ratio`,
  `strip_max_*_distance`, `*_components`). Gate un-morph on "stitch is actually needed".
- **Verify:** mode tally shifts StitchGeometry→GpuMorphOnly; `max_lip_height` drops;
  `open_edge_faces` stays 0.

### B. Reduce the height step the stitch bridges (for the stitch-fallback faces)
When a face must still stitch (over-distance), the lip is the unavoidable LOD height delta.
Options to soften it: morph the fine boundary band *part way* toward the coarse height before
stitching (lip becomes a graded ramp, not a wall), or shade the stitch band so the step reads
less harshly (cosmetic). Measure `max_lip_height` before/after.

### C. Improve consume coverage (`MissingStrip` / over-distance)
`DirectedDistanceExceeded` (9 faces, up to 4.6 voxels) means the coarse segment is too far to
weld/stitch cleanly. Investigate whether these are real LOD-delta-1 neighbours whose strip is
stale/missing at mesh time, or genuinely a 4-voxel coarse displacement. Cross-check
`strip_overlap_source` (`mesh_time` vs `runtime_reextract`) and `strip_status`.

### D. Span alignment in boundary extraction (the `SpanMismatch` root)
Avg span overlap 0.72 means fine/coarse boundary polylines don't cover the same seam extent.
Check `extract_lod_boundary_strips` band/clipping so both sides report the same along-seam span
on a shared face. Higher overlap → the stitch/morph has a real target to match.

---

## 4. How to measure any fix

1. `cargo run --release -- --bench bench/scenes/lod-seam-hard-cases.toml`
2. Read the new `seam-audit.json`; compare to the baseline (Section 1):
   ```powershell
   $j = Get-Content '<run>\seam-audit.json' -Raw | ConvertFrom-Json
   $j.faces | Group-Object final_mode | Select Count,Name
   $j.summary | Select max_lip_height_voxels, open_edge_faces, min_strip_span_overlap_ratio,
     max_strip_coarse_to_fine_distance_stitch_safe
   ```
3. **Win conditions:** `max_lip_height_voxels` down, `min_strip_span_overlap_ratio` up,
   `open_edge_faces` still 0, no rise in `InvalidUnsafeTopology`. Gate with
   `cargo run --bin bench_guard -- bench-runs/<run>/summary.json`.
4. Also run the live perf bench (CLAUDE.md) — routing changes touch meshing.

## 5. Baseline snapshot (fill in as fixes land)

| date | change | stitch/morph/invalid | max_lip | min_span_overlap | open_edge |
|---|---|---|---|---|---|
| 2026-06-08 | baseline (post Stage 5 + cleanup merge) | 47 / 0 / 6 | 1.56 | 0.31 | 0 |

## 6. Status log / continue-from-here

- **2026-06-08:** Audit baseline captured (above). Confirmed: artifacts are watertight
  height-step lips, not torn holes; the vertical/multi-component case is 1 face. Next concrete
  step is **Fix A** — add the morph-vs-stitch routing gate in `lod_seam.rs` so well-aligned,
  in-distance, single-component faces take `GpuMorphOnly` (smooth) instead of un-morph+stitch
  (lip). Start by reading the per-face inputs already computed in `seam_audit.rs` and
  thresholding on `strip_span_overlap_ratio` + `strip_max_coarse_to_fine_distance`.
- **2026-06-08:** Attempted a runtime Fix A gate that skipped stitch for single-component
  strips passing a relaxed span-overlap check when all face boundary verts had morph targets.
  User visual check regressed badly with new large stepped/open-looking terrain bands, so the
  code change was reverted. Partial hard-case run wrote
  `bench-runs/2026-06-08T13-24-30Z/seam-audit.json`: `open_edge_faces = 0`, `max_lip_height`
  `1.44`, modes `StitchGeometry = 17`, `GpuMorphOnly = 0`, `InvalidUnsafeTopology = 2`.
  Do not re-try this broad gate as-is; next attempt needs a stricter per-face proof that the
  rendered morph path actually covers the seam and should be validated visually before keeping
  it.
- _(append the next entry here)_
