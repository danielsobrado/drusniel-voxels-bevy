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

### A. Route good-segment faces to `GpuMorphOnly` — ❌ DEAD END (do not retry)
Idea was: on a well-matched face, keep the morph and skip the stitch to remove the lip.
**Tried twice (two AIs, two different gates — broad, and strict single-component + complete
weld + ≤0.6-voxel displacement). Both regressed identically into large dark trench/band
artifacts.**

**Root cause (now understood):** the stitch is not only hiding the height-step lip — it
triangulates the **2:1 density T-junction** (the fine boundary has ~2× the verts of the coarse
on a delta-1 seam). The GPU morph welds the fine *vertices* onto the coarse surface but **cannot
close the density mismatch**: the extra fine vertices sit mid-edge on the coarse side, so
dropping the stitch reopens a T-junction crack — **regardless of how small the morph
displacement is.** So the stitch is *structurally required* for watertightness; the lip is the
unavoidable cost of that watertightness, not a routing choice. Leave the un-morph + stitch path
as-is.

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

**2026-06-08 result:** this is not a stale-strip/consume-coverage bug for the over-distance
faces. In `bench-runs/2026-06-08T15-02-43Z/seam-audit.json`, all 9
`DirectedDistanceExceeded` faces use `strip_overlap_source = mesh_time` and
`strip_status = HitCurrentRevision`; `stale_strip_faces = 0` and `lod_delta_gt_one_faces = 0`.
That means the 4.6-voxel case is a real current L0->L1 coarse/fine boundary mismatch, not a
late runtime re-extraction artifact.

The `MissingStrip` bucket is separate: 30 faces are `NoTransition / MissingFineStrip`, and 5
faces are `InvalidUnsafeTopology / MissingCoarseStrip`. Those 5 invalid faces have a fine
runtime-reextracted chain but no coarse chain to stitch to, so there is no safe stitch target to
recover in consume without changing the source geometry/extraction coverage. Treat this as
evidence for Fix D/root surface alignment rather than retrying routing gates.

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
- **2026-06-08 (decisive):** Tried the *strict* Fix A — skip stitch + keep morph only on
  single-component faces with a complete weld and ≤0.6-voxel max displacement (big-lip faces
  excluded by construction). **Still regressed** into the same large dark trench/band artifacts;
  user confirmed it matches the earlier AI's regression. **Conclusion: Fix A is a dead end.** The
  stitch triangulates the 2:1 density T-junction; the morph can't close that, so skipping the
  stitch reopens cracks at *any* displacement. Reverted (`lod_seam.rs` restored). **Do not retry
  morph-vs-stitch routing.** The lip is the unavoidable cost of the watertight stitch.
- **Where to go next (untried, lower-risk):**
  - **Fix B (cosmetic):** soften how the stitch band *reads* without changing topology — blend
    the stitch-band vertex normals toward the surrounding surface so the step is shaded as a
    gradient, not a hard wall. Pure shading, cannot reopen cracks. Measure subjective only
    (`max_lip_height` geometry won't move, and that's fine).
  - **Fix C/D (root):** reduce the *height delta itself* — the lip exists because the coarse
    surface sits up to ~4.6 voxels from the fine at the seam. Tighter LOD distance bands near
    steep terrain, or a better coarse iso there, shrink the delta the stitch must bridge. Has a
    perf cost; bench required.
- **2026-06-08:** Tried Fix B as a normal-only stitch-band shading change: appended stitch
  vertices keep the same positions/indices, but their render normals are blended toward the
  average stitch-band normal. Unit test passed. Partial hard-case run wrote
  `bench-runs/2026-06-08T15-02-43Z/seam-audit.json`: topology unchanged from baseline
  (`StitchGeometry = 47`, `GpuMorphOnly = 0`, `InvalidUnsafeTopology = 6`, `open_edge_faces = 0`,
  `max_lip_height = 1.56`). This is expected because Fix B is cosmetic and does not move
  geometry. The bench was stopped after the audit was written because it stayed in the long
  readiness/reporting phase with stable strip counters, so no `summary.json`/guard result was
  produced for this run.
- **2026-06-08:** User reported Fix B regressed visually in the same way as the Fix A attempt.
  Reverted the stitch-normal blend and restored stitch vertices to use their original generated
  normals. Treat normal-only stitch-band blending as a dead end unless a future pass can prove it
  does not create the dark trench/band artifact.
- **2026-06-08:** Completed Fix C investigation against
  `bench-runs/2026-06-08T15-02-43Z/seam-audit.json`. Findings:
  `DirectedDistanceExceeded = 9`, and all 9 are current mesh-time strips
  (`strip_overlap_source = mesh_time`, `strip_status = HitCurrentRevision`), with
  `stale_strip_faces = 0` and `lod_delta_gt_one_faces = 0`. The remaining `MissingStrip` cases
  split into `30 NoTransition / MissingFineStrip` and `5 InvalidUnsafeTopology /
  MissingCoarseStrip`. Conclusion: C rules out stale consume coverage as the root cause of the
  large lip; continue with Fix D/root coarse-fine surface alignment.
  - Or accept: seams are watertight (`open_edge_faces = 0`), avg lip 0.66 voxel.
- **2026-06-10: Fix E — coarse-side iso apron (No Man's Sky over-polygonization, coarse-only
  variant).** New, untried lever that is *orthogonal* to the dead-end Fix A/B: it touches only the
  **coarse** field, never the fine stitch/normals, so it should not reproduce the dark trench/band
  regression. On a coarse chunk, the boundary band facing a *finer* neighbour gets a small outward
  iso bias (subtract ε from the SDF), inflating the coarse iso-surface so it bulges outward and
  **overlaps** the finer surface — a terrain-shaped overlap apron that covers the seam crack/lip.
  The watertight stitch on the fine side is left exactly as-is.
  - **Why coarse-only, and what it does/does not fix:** seams are already watertight
    (`open_edge_faces = 0`); the artifact is a *visual* height-step lip. The apron covers that step
    with an overlap instead of removing it, so success here is **coverage + visual**, not the
    fine-side `max_lip_height_voxels` metric (which is measured on the fine stitch we don't touch
    and will likely not move — do not read "lip unchanged" as failure).
  - **Implementation (Stage 1, landed, env-gated OFF by default):**
    - `apron_band_depth_for_finer_neighbor(...)` in `sdf.rs` — mirrors
      `lod_transition_step_for_padded_size` but fires when the neighbour's `lod_index()` is lower
      (finer). Returns band depth (0 = outermost plane) for a graded ramp.
    - `coarse_lod_apron_bias()` in `sdf.rs` — env gate `VOXELS_COARSE_LOD_APRON=1` (default off),
      magnitude `VOXELS_COARSE_LOD_APRON_BIAS` (default 0.3, clamped [0,1]); cached `OnceLock`,
      mirrors `coarse_terrain_sdf_smooth_enabled` / `terrain_morph_config`.
    - `generate_low_lod_sdf_with_smoothing_and_transition_mode(...)` gained an `apron_bias` arg.
      Applied as a **clamped subtract** (NOT `preserve_sdf_sign` — the apron deliberately flips
      near-surface air cells negative to push the surface out; floor-clamped at -1). Falloff: full
      ε on the outermost plane, ε/2 one cell in.
    - **SN coarse path passes the configured bias; MC/Transvoxel path
      (`generate_low_lod_sdf_with_smoothing`, consumed by `mc_support.rs`) and the unit tests pass
      `0.0`** — MC's case index is sign-sensitive, so the apron stays off there until validated
      separately.
  - **Invariant:** apron only fires toward a finer neighbour, so two equal-LOD coarse chunks never
    apply it → no new coarse↔coarse seam. Deterministic from world occupancy + neighbour LOD.
  - **Known Stage-1 edge case:** triple-junction corner cells shared by a finer-neighbour face and
    a coarse-neighbour face get the apron on both → a possible hairline mismatch at that shared
    edge. Accept for Stage 1; if it shows in the audit/visual, restrict the band to face interiors.
  - **Not yet built (gated by Stage-1 measurement):** Stage 2 = push apron-band coarse verts under
    by δ + tag `TERRAIN_MESH_SECTION_TRANSITION_APRON` if Z-fighting is visible. Stage 3 = widen
    the coarse extraction band (touches compile-time `ConstShape` sizes) if ε-in-band can't reach a
    tall lip.
  - **How to measure (run on the normal Windows/dev setup — this WSL box lacks `libudev` +
    `sccache` and cannot compile):**
    1. A/B: `cargo run --release -- --bench bench/scenes/lod-seam-hard-cases.toml` with
       `VOXELS_COARSE_LOD_APRON=0` then `=1`.
    2. Win conditions: `open_edge_faces` stays 0, `InvalidUnsafeTopology` does not rise, coverage
       probe shows no see-through gap on coarse-side delta-1 faces; visually the lip reads as a
       covered overlap with **no** dark trench/band (the Fix A/B regression signature).
    3. Perf: also run `visual-regression-live-lod.toml`; compare `summary.json` + `bench_guard`.
- **2026-06-10: Fix E measured (A/B on hard-case fixture) — NET REGRESSION, leave gated OFF.**
  Ran the deterministic A/B under WSL software rendering (Mesa lavapipe + an env-gated 80×60
  bench window, `VOXELS_BENCH_TINY_WINDOW`, since 1920×1080 llvmpipe stalls the frame-budgeted
  gen). **Baseline reproduced the documented `13-24-30Z` run exactly** (StitchGeometry=17,
  InvalidUnsafeTopology=2, `max_lip=1.4437`, `open_edge_faces=0`) → the rig is deterministic, so
  the apron deltas below are real, not llvmpipe noise.

  | metric | OFF (baseline) | apron 0.1 | apron 0.3 |
  |---|---|---|---|
  | `open_edge_faces` | 0 | **0** | **1** ❌ |
  | `max_lip_height_voxels` | 1.44 | **4.31** ❌ | **4.95** ❌ |
  | `min_strip_span_overlap_ratio` | 0.30 | 0.54 ✅ | 0.54 ✅ |
  | modes (stitch/invalid/no-transition) | 17/2/10 | 25/1/3 | 25/1/3 |

  **Mechanism (confirmed from per-face data):** the apron-on top-lip faces (lip ~4.95) are all
  `new=True` Lod1→**Lod2** `pos_x` faces absent from the baseline audit. Inflating the coarse
  (Lod2) boundary outward **manufactures new Lod1↔Lod2 stitch transitions**, and the still-active
  stitch bridges their large height steps → big lips. So the coarse apron fights the stitch the
  same way the Fix A/B levers did: moving boundary geometry while the stitch is live makes the lip
  worse. Bias is nearly irrelevant (0.1 ≈ 0.3 in mode tally and lip); 0.1 stays watertight, 0.3
  tears one edge. The only win — span overlap 0.30→0.54 — does not offset the lip/tear regression.
  **Conclusion:** Fix E joins A/B as a characterized dead end *as implemented*. Code stays in,
  gated OFF by default (`VOXELS_COARSE_LOD_APRON` unset → bias 0.0). Untried refinement if
  revisited: forbid the apron from *creating* new transitions (apply only where a delta-1
  transition already exists, or clamp the bulge so it can't extend the coarse mesh into a new
  Lod1↔Lod2 overlap) — but that is speculative and not pursued here.
  - Rig artifacts (not committed): `bench-runs/apron-ab/{test-tiny(off),on,on-010}`. WSL Vulkan via
    locally-extracted lavapipe in `~/vklocal` (no sudo); see also the `VOXELS_BENCH_TINY_WINDOW`
    env knob added to `src/app/mod.rs` for software-render benching.
- _(append the next entry here)_
