# MC + Transvoxel Implementation Plan

> Created: 2026-05-23 · Status: Planning
> Supersedes (for the LOD-seam direction): [`docs/lod/lod-seam-closure-plan.md`](lod-seam-closure-plan.md)
> Scope: `src/voxel/mc_transvoxel/` (new), `src/voxel/meshing.rs`, `src/voxel/plugin.rs`,
> `src/rendering/triplanar_material.rs`, `assets/shaders/`, `bench/scenes/visual/`
> Owner: terrain/rendering
>
> Decision context: after extending Surface-Nets smoothing across all LODs and
> widening the boundary snap, the residual LOD-boundary seams persist in production
> scenes at visually unacceptable levels (see `debug/terrain-hole-probe-*` dumps
> and screenshots dated 2026-05-23). The SN path has been iterated; the
> remaining seams are mesh-topology mismatches that Surface Nets has no first-class
> machinery to bridge. Transvoxel's transition cells are the published, intended
> solution to exactly this problem.

## Why this plan, and what it is not

This is a **bounded spike**, executed behind a feature flag, that produces visual
and performance evidence for one decision: **does modified MC + Transvoxel
transition cells close the LOD seams that Surface Nets cannot, within budget,
without regressing the rest of the terrain pipeline?**

It is **not** a green light to rewrite the terrain renderer. The Surface Nets
path stays default until the spike's go/no-go memo (MTX-037) says otherwise.

If the spike succeeds, full adoption (mesher swap, material/normal/water/edit/
collider parity at production quality) is **separate downstream work** estimated at
**8–14 engineer-weeks plus 2–4 weeks stabilization** per the original research
the user shared. The spike itself targets **3 engineer-weeks (1 senior engineer)**.

## Scope

**In scope (spike):**

- Modified / case-disambiguated Marching Cubes (Lengyel tables) at LOD0/1/2/3.
- Transvoxel transition cells for **2:1 LOD boundaries** on **X/Z faces and Y faces** (Y is non-optional — failing scenes are vertical).
- One terrain material mode (single triplanar) — quality parity is post-spike.
- One collider path — visual-mesh collider only, validated for player walkability.
- A/B visual comparison against Surface Nets in the seam bench scenes.
- Integration with the existing hole-probe diagnostics so we can quantify seam closure.

**Out of scope:**

- Tearing out Surface Nets. SN remains the default path; MC runs only when `mc_transvoxel_spike.enabled = true`.
- Full material / triplanar / weight-blend parity across all LODs.
- Water-mesh changes (continue to use the existing water mesher; MC produces terrain only).
- Foliage / props / building system changes.
- NAADF renderer changes — the new terrain meshes must consume the same vertex attributes the NAADF and triplanar pipelines already expect.
- Dual Contouring or any other extractor.
- Chained Lod0↔Lod2 transitions. Spike enforces 2:1 (delta ≤ 1) only.

## Constraints already verified in the current tree

The spike inherits these facts from the codebase as of this commit:

- Chunk size: **16** world voxels (`CHUNK_SIZE`), padded 18 for LOD0 ([constants.rs:268](../../src/constants.rs#L268)).
- LOD step sizes: **1 / 2 / 4 / 8** ([constants.rs:268-289](../../src/constants.rs#L268-L289)) — adjacent levels are 2:1, the Transvoxel assumption.
- Mesh mode per LOD comes from `target_terrain_mesh_mode_for_lod` ([plugin.rs:1917](../../src/voxel/plugin.rs#L1917)). On integrated GPU `low_detail_mode = Blocky`; the spike runs only when LODs are on `SurfaceNets` (which it replaces with `McTransvoxel`).
- Hole-probe diagnostics exist (`debug/terrain-hole-probe-*.json` via Shift+F9, `LodTransitionSnapStats`, `lod_delta_gt_one_face_mask`). Reuse them.
- Bench guardrails: `cargo run --release -- --bench`, `bench_guard`, `assets/config/bench_guard.toml`, deterministic visual scenes per [CLAUDE.md](../../CLAUDE.md).

## Whole-spike success criteria (MTX-037 inputs)

Measured on the seam bench scenes (MTX-002) with `McTransvoxel` on:

1. **Visual seam closure.** No visible ledges/holes at LOD0↔LOD1 X/Z **or** Y boundaries at gameplay distance in the prepared camera views. Equivalent or better than the Surface Nets reference shots from the same chunks.
2. **No dark normal/material seam** under a rotating sun in the same scenes.
3. **Hole-probe ray fraction** (`solid-before-render` rays) on the seam scenes drops to **≤ 5 %** in the LOD ring band (current SN: ~20–25 %).
4. **LOD step magnitude** (`Lod1 interior median - Lod0 interior median` from the height-fan log) is **≤ 0.10 voxels** in the same scenes. (Current SN with snap fix: ~0.07; this gate confirms parity at minimum.)
5. **Performance:**
   - Regular MC triangle count ≤ **2.5×** Surface Nets on the same chunk.
   - MC+transition total triangles ≤ **3.0×** Surface Nets.
   - Mesh generation ms ≤ **2.5×** Surface Nets.
   - No frame spike > 16.6 ms attributable to transition rebuilds in the bench scenes.
   - `bench_guard` passes against the current `assets/config/bench_guard.toml`.
6. **Edit locality.** Voxel edits near a LOD boundary dirty only the local chunk + halo; no global remesh; transition faces refresh correctly.

A **NO-GO** is acceptable if (5) or (6) fail badly even after the spike closes the seam. The point is to learn, not to ship at any cost.

---

# Epic: MTX — MC + Transvoxel Spike

## Phase 0 — Charter, scaffolding, baseline (Sprint 0, ~1 week)

### MTX-000 — Spike Charter And Exit Criteria

**Type:** Planning · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** Lock the contract for the spike so it can't quietly become a rewrite.

**Tasks.**
- Commit this file as the authoritative scope and gate definition.
- Add a one-paragraph entry in `docs/rendering/README.md` linking to it.
- Record the **default-off** policy in code (MTX-001 enforces it).

**Acceptance.**
- This doc committed, linked from `docs/rendering/README.md`.
- Go/no-go metrics explicit and quantified (Section above).
- Production SurfaceNets path remains default; no production behavior changes when `mc_transvoxel_spike.enabled = false`.

---

### MTX-001 — Module Skeleton, Feature Flag, Runtime Toggle

**Type:** Engineering · **Priority:** P0 · **Estimate:** 0.5–1 day

**Goal.** Create an isolated, off-by-default code path so the rest of the work has somewhere to land without touching production hot paths.

**Files (new):**
```
src/voxel/mc_transvoxel/mod.rs        — module root, public types, plugin registration
src/voxel/mc_transvoxel/config.rs     — McTransvoxelSettings + parsing
src/voxel/mc_transvoxel/tables.rs     — regular MC + transition cell tables
src/voxel/mc_transvoxel/mc.rs         — regular MC mesher
src/voxel/mc_transvoxel/transvoxel.rs — transition cell mesher
src/voxel/mc_transvoxel/normals.rs    — SDF-gradient normal helpers
src/voxel/mc_transvoxel/stats.rs      — McTransvoxelStats (mirrors LodTransitionSnapStats)
src/voxel/mc_transvoxel/debug.rs      — debug overlay hooks
tests/mc_transvoxel_*.rs              — unit + golden tests (TBD)
```

**Files (update):**
```
Cargo.toml                                    — add feature `mc_transvoxel` (off by default)
src/voxel/mod.rs                              — pub mod mc_transvoxel;
src/voxel/plugin.rs                           — register settings resource; route LOD when enabled
src/voxel/meshing.rs                          — add MeshMode::McTransvoxel variant + route in generate_chunk_mesh_with_mode
assets/config/mc_transvoxel.yaml              — default off, all knobs
```

**Required config (`mc_transvoxel.yaml`):**
```yaml
mc_transvoxel:
  enabled: false                        # master switch
  mode: sandbox                         # sandbox | selected_chunks | replace_surface_nets
  max_chunks_per_frame: 2               # rate-limit for fairness
  lod_delta_policy: max_one             # spike enforces 2:1 only
  use_secondary_positions: false        # opt-in; see MTX-024
  generate_colliders: false             # smoke test only; see MTX-035
  material_mode: single_triplanar       # spike-only simplification
  debug_draw_transition_faces: false
  debug_log_transition_stats: false
```

**Acceptance.**
- `cargo check` and `cargo test --lib` pass.
- With `enabled = false`, no chunk mesh changes and zero new entities/components — verified by a hole-probe dump diff before/after merging the skeleton.
- The new `MeshMode::McTransvoxel` variant compiles but only routes when `enabled = true`.
- Feature `mc_transvoxel` in `Cargo.toml` is **off by default** to avoid CI cost when nobody is on the spike.

---

### MTX-002 — Baseline The Failing Seams

**Type:** Test/Benchmark · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Lock the failure scenes BEFORE meshing changes, so the A/B is real.

**Tasks.**
- Use the existing seam bench scenes already on disk (uncommitted in your tree):
  - `bench/scenes/visual/visual-regression-seam-mountain.toml`
  - `bench/scenes/visual/visual-regression-seam-overhang-cave.toml`
  - `bench/scenes/visual/visual-regression-seam-shoreline.toml`
  - Commit them as the baseline reference.
- Add **vertical-seam** dedicated camera angles to each (the failing case is vertical; X/Z-only scenes don't exercise it).
- Capture, with current SurfaceNets (default):
  - `bench-runs/<run>/summary.json`
  - Fixed-checkpoint screenshots.
  - Shift+F9 hole-probe dumps from each scene's primary camera position.
  - Height-fan log lines (the `Camera height fan: rendered_lod=...` rows we already use).
- Tabulate per scene in this doc:
  - `Lod1 interior median - Lod0 interior median` (the LOD step).
  - `solid-before-render` ray fraction.
  - Triangle / vertex counts per chunk.
  - Mesh-gen ms.

**Acceptance.**
- ≥ 3 reproducible failing camera positions (≥ 1 vertical Y boundary, ≥ 1 horizontal X/Z corner, ≥ 1 shoreline).
- Baseline `summary.json` + screenshots + hole-probe JSONs committed to `bench-runs/baseline-mctx/`.
- Baseline numbers written into Section "Baseline reference" of this doc (added below by this ticket).
- Pre-change `bench_guard` run captured for the chosen scenes.

**Notes.** Without this, the spike can "feel better" without proving anything. The baseline numbers ARE the bar for MTX-037.

---

### MTX-003 — LOD Policy Audit For The 2:1 Transvoxel Constraint

**Type:** Engineering/Validation · **Priority:** P0 · **Estimate:** 0.5–1 day

**Goal.** Verify the LOD selector can guarantee `|lod_index(a) - lod_index(b)| ≤ 1` between any two adjacent chunks the spike will mesh. The codebase has **no enforcement** of this today — LODs are concentric distance bands, so band corners and especially **vertical stacks** can produce Lod0↔Lod2 neighbors.

**Tasks.**
- Use `lod_delta_gt_one_face_mask` (already in `TerrainMeshDebug`, [meshing.rs:2643](../../src/voxel/meshing.rs#L2643)) — count chunks with non-zero mask in the seam scenes.
- For each scene, dump (logical) `(chunk_pos, lod, neighbor_lods)` for any chunk with `lod_delta_gt_one_face_mask != 0` and record locations.
- Decide the spike policy. **Recommended: Option A** (enforce intermediate-LOD ring near boundaries):
  - When LOD selection would place Lod0 next to Lod2 on any face, force the intermediate chunk to Lod1 within a hysteresis band.
  - Implement as an additive pass on the LOD distance bands in `plugin.rs:3952-3964`; OFF for non-spike chunks.
- Alternative (rejected for spike, captured here): allow Lod0↔Lod2 directly but skip Transvoxel for that face. Cheaper but creates exactly the seam class we are trying to remove. Document refusal.

**Acceptance.**
- Debug overlay/dump shows zero `lod_delta_gt_one_face_mask != 0` in spike scenes when `mc_transvoxel.lod_delta_policy = max_one`.
- Unit test: synthetic distance bands that would place Lod0↔Lod2 directly are forced to insert a Lod1 ring.
- If delta > 1 cannot be eliminated for some scene, spike falls back to non-transvoxel on that face and logs once (no per-frame spam).

---

## Phase 1 — Modified Marching Cubes core (Sprint 1, ~1 week)

### MTX-010 — Import / Generate Disambiguated MC Tables

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1–2 days

**Goal.** Add a disambiguated MC case table. **Do not** ship raw 1987 MC tables — they leave ambiguous cases unresolved and can produce holes/non-manifold geometry that look like the same seam class we're trying to fix.

**Tasks.**
- Source: Lengyel's Transvoxel project provides a Rust-friendly publication of both regular and transition tables (his `transvoxel.h`/`.c` is the canonical reference). Vendor under `src/voxel/mc_transvoxel/tables.rs` as `pub(super)` constants. **Cite source + license** in a header comment.
- Generate the regular tables (256 cases) as static arrays.
- Validation tests:
  - All 256 case indices resolve to a triangle list.
  - Triangle index counts are valid (each triangle 3 indices, each index < 12 = number of cube edges).
  - Winding consistent across the table (single chosen orientation).
  - Edge-vertex map matches the standard cube-edge numbering.
  - **Ambiguous cases (3, 6, 7, 10, 12, 13)** have an explicit policy comment: which face-resolution choice was made and why.

**Acceptance.**
- Unit tests pass for all 256 cases.
- Generated triangle counts match a published reference (assert mean/max in test).
- No hand-written partial table without test coverage.
- License/source header present in `tables.rs`.

---

### MTX-011 — Regular MC Chunk Mesher (LOD0 first)

**Type:** Engineering · **Priority:** P0 · **Estimate:** 2–3 days

**Goal.** Generate regular MC terrain for one LOD0 chunk in isolation. Reuse the existing SDF helpers — do NOT introduce a parallel SDF source.

**API sketch (`mc.rs`):**
```rust
pub struct McMeshInput<'a> {
    pub world: &'a VoxelWorld,
    pub chunk: &'a Chunk,
    pub chunk_pos: IVec3,
    pub lod: LodLevel,
    pub neighbor_lods: NeighborLods,
    pub settings: &'a McTransvoxelSettings,
}

pub struct McMeshOutput {
    pub mesh: MeshData,          // same MeshData type the SN path produces
    pub stats: McTransvoxelStats,
}

pub fn generate_mc_chunk_mesh(input: McMeshInput<'_>) -> McMeshOutput;
```

**Tasks.**
- Sample the world SDF via the **existing** `smoothed_terrain_sdf_at_world_pos` and `coarse_aligned_lod_sample_base_with_stride`. Don't fork a new SDF. (This guarantees MC sees the same field as SN, so the spike isolates extractor choice, not SDF choice.)
- For LOD0: walk the 18³ padded grid as cell corners, look up the regular MC case per cell, emit triangles per the table.
- Compute per-vertex normals from the SDF gradient (MTX-012).
- Fill the existing `MeshData` schema (positions / normals / uv0 / colors / indices) so the triplanar material pipeline consumes it unchanged.
- **No** transition cells yet — same-LOD chunk only. Boundary cells use the chunk's own stride.

**Acceptance.**
- Empty chunk emits zero triangles.
- Fully-solid chunk emits zero triangles (no interior).
- Sphere fixture: triangle count and bounding box within tolerance of analytic reference.
- Sine-wave heightfield fixture: surface area within tolerance of analytic reference.
- Mesh attributes valid and aligned (positions.len == normals.len == uvs.len == colors.len, indices % 3 == 0).
- SN production path completely untouched (verified by running existing SN tests, all green).

---

### MTX-012 — MC Normal Strategy For The Triplanar Pipeline

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Make MC normals deterministic and seam-free, since triplanar shading is sensitive to small normal variation.

**Tasks.**
- Implement per-vertex normals from the SDF gradient using central differences at the vertex world position. Reuse / adapt `sdf_gradient_normal_at_local` ([meshing.rs:2618](../../src/voxel/meshing.rs#L2618)) — extend if needed; do not duplicate.
- Reject face-averaged normals as the default; they diverge across LOD and reintroduce dark bands.

**Acceptance.**
- Unit test: boundary normal computed from chunk A equals the normal computed at the same world point from chunk B (within `1e-4`).
- Unit test: no NaN, all unit length.
- Triplanar material visibly does not smear or band under a rotating sun in the sphere/sine-wave fixtures.

---

### MTX-013 — Minimal Material Weight Sampling

**Type:** Engineering · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Get something on screen that the triplanar shader accepts. Quality parity is post-spike.

**Tasks.**
- Reuse `compute_vertex_material_weights` ([meshing.rs:3194](../../src/voxel/meshing.rs#L3194)) at the MC vertex's world position. Document as prototype-only — known to mis-blend in deep low-LOD cells.
- Single mode: `material_mode = single_triplanar`. No new shader.

**Acceptance.**
- MC mesh renders with the production triplanar material; no missing-attribute panic.
- Known degradations (deep low-LOD material mis-blend) noted in this doc as known issues.

---

### MTX-014 — Sandbox Render Mode

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Get MC chunks rendering side-by-side with SN chunks for A/B without touching production routing.

**Modes (config-selected):**
- `sandbox` — selected debug positions only, identified by a small `IVec3` allowlist or radius around the camera. Default for the spike.
- `selected_chunks` — chunks in a band (e.g., the LOD0 ring) use MC, everything else stays SN. For seam scene comparison.
- `replace_surface_nets` — every SurfaceNets chunk routes through MC. Reserved for final-week perf measurement; do not flip casually.

**Tasks.**
- Route in `generate_chunk_mesh_with_mode` ([meshing.rs:5344](../../src/voxel/meshing.rs#L5344)) under `MeshMode::McTransvoxel`.
- Add a debug-overlay color or material to distinguish MC chunks visually when `debug_draw_transition_faces = true` (use `WireframeDebug`-style hook).

**Acceptance.**
- Same camera shot of the mountain in each mode produces a comparable screenshot.
- SN remains default; flipping `mode = sandbox` does not crash; switching back to `enabled = false` returns the scene to exact SN output.

---

## Phase 2 — Transvoxel transition cells (Sprint 2, ~1 week)

### MTX-020 — Import Transvoxel Transition Tables

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1–2 days

**Goal.** Add the Transvoxel transition-cell tables (Lengyel 2010). These are the explicit machinery that makes a 2:1 boundary connectable.

**Tasks.**
- Vendor transition tables (512 cases, mapped via 73 equivalence classes) into `tables.rs`. License/citation header.
- Validation tests:
  - All 512 cases load.
  - Triangle index counts within published ranges.
  - Vertex indices within the transition cell's vertex set (10 high-res vertices + 3 low-res vertices in the canonical Lengyel layout).
  - Winding consistent per face.

**Acceptance.**
- Tables compile as static data, no runtime generation.
- All 512 case-resolution tests pass.

---

### MTX-021 — Transition Face Mask System

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Decide per chunk per face whether a transition cell mesh is needed.

**Rules for the spike:**
```
enable transition face if and only if neighbor_lod_index == my_lod_index + 1
otherwise no transition for that face
```
Direct Lod0↔Lod2 must not occur (MTX-003 enforces the intermediate ring); if one slips through, log once and skip the transition.

**Data:**
```rust
#[derive(Clone, Copy, Debug, Default)]
pub struct TransvoxelFaceMask {
    pub neg_x: bool,
    pub pos_x: bool,
    pub neg_y: bool,
    pub pos_y: bool,
    pub neg_z: bool,
    pub pos_z: bool,
}
```

**Acceptance.**
- Face mask matches the neighbor LOD configuration of test fixtures.
- All six faces supported (X/Z **and** Y — Y is mandatory).
- Delta > 1 emits warning + skips transition for that face.

---

### MTX-022 — Generate Transvoxel Transition Meshes For X/Z Faces

**Type:** Engineering · **Priority:** P0 · **Estimate:** 2–3 days

**Goal.** Generate transition geometry for `+X`/`-X`/`+Z`/`-Z` 2:1 boundaries on the high-resolution side. Stitch them to the regular MC mesh.

**Acceptance.**
- Two-chunk synthetic scene (Lod0 next to Lod1, X face): zero see-through pixels through the seam from a fixed camera in the WireframeDebug overlay.
- Transition triangles connect to regular MC vertices with consistent winding and valid normals.
- Edit/regenerate the Lod1 chunk → only that chunk + neighbor halo dirty; no global remesh.
- Stats counter records `transition_triangles_xz`.

---

### MTX-023 — Generate Transvoxel Transition Meshes For Y Faces — **HARD GATE**

**Type:** Engineering · **Priority:** P0 · **Estimate:** 2–3 days

**Goal.** Generate transition geometry for `+Y`/`-Y` 2:1 boundaries.

**Why this is non-optional and ranked higher than the original spike plan suggested.**
The current failing scenes are vertical: the visible dark ring is the LOD0↔LOD1 boundary stacked in Y (verified in the hole-probe dumps — every chunk with snap activity in the latest dump fires on `pos_y`, none on X/Z). Transvoxel's Y-face is its asymmetric, awkward case in standard implementations; doing X/Z without Y reproduces the original failure. **Sprint 2 does not pass if Y transitions are not implemented and tested.**

**Tasks.**
- Adapt the transition table to Y-face geometry (Lengyel's tables are defined per-face; Y uses the same case table with reoriented vertex layout).
- Compose the transition cell at the high-resolution side: 10 dense vertices on the Y boundary plane, 3 coarse vertices into the low-resolution chunk.
- Match the regular MC vertex positions at the shared edges.

**Acceptance.**
- Two-chunk synthetic scene with **Lod0 above Lod1** and an overhang SDF: zero see-through pixels through the Y seam from a fixed camera (WireframeDebug + standard render).
- Cave/overhang fixture (heightfield can't represent overhangs — use a hand-built SDF) renders with no Y-seam.
- The cave seam scene from MTX-002 — the current SN failure mode — renders with the LOD step ≤ 0.1 voxels (hole-probe height-fan log).
- Edit a voxel near the Y boundary → only local rebuild, transition cell refreshed.

---

### MTX-024 — Secondary Boundary Positions / Smoothing (OPT-IN)

**Type:** Engineering · **Priority:** P1 · **Estimate:** 1–2 days

**Goal.** Test whether the spike needs Lengyel's "secondary position" attribute (or shader-side boundary smoothing) for sub-voxel parity. Recent literature is mixed; some implementations need it, some don't.

**Tasks.**
- Add an optional `secondary_position` vertex attribute behind `mc_transvoxel.use_secondary_positions`.
- Compare three variants in the seam bench scenes:
  1. No smoothing.
  2. CPU-baked secondary positions.
  3. Shader-side boundary smoothing.

**Acceptance.**
- If a variant reduces measurable LOD step in the hole-probe dump without breaking normals/material, keep it behind config (default off, opt-in for final A/B).
- If none help (or all regress normals/material), document and remove the attribute.
- No default production shader behavior changes — entire feature behind `use_secondary_positions`.

---

### MTX-025 — Stats + Diagnostics Integration

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Make the spike measurable using the existing diagnostic surface.

**Tasks.**
- Define `McTransvoxelStats` per the original plan plus integration with `LodTransitionSnapStats`:

```rust
pub struct McTransvoxelStats {
    pub regular_chunks_meshed: u32,
    pub transition_faces_meshed: [u32; 6],    // per ChunkFace
    pub transition_triangles_total: u32,
    pub skipped_lod_delta_gt_one: u32,
    pub skipped_missing_neighbor: u32,
    pub mesh_generation_ms_total: f32,
    pub triangle_count_regular: u32,
    pub triangle_count_transition: u32,
}
```
- Surface them in:
  - `TerrainMeshDebug` (per chunk).
  - The hole-probe dump (`hole_probe.rs` — add a `McTransvoxelStatsProbe` next to `LodTransitionSnapStatsProbe`).
  - The F3/debug overlay numeric panel.
- Logs are once-per-N-frames, never per-frame spam.

**Acceptance.**
- A Shift+F9 dump from a seam scene contains the new stats for every MC chunk.
- Bench `summary.json` includes the aggregated counters so MTX-036 can compare.

---

## Phase 3 — Validation + go/no-go (Sprint 3, ~1 week)

### MTX-030 — Controlled Two-Chunk Synthetic Scene

**Type:** Test/Benchmark · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Prove the algorithm works on a minimal, deterministic input before stressing it with the real world.

**Scene (in code, not a bench scene):**
```
Chunk A: Lod0, 16³ voxels, sphere SDF intersecting boundary
Chunk B: Lod1, 8³ effective voxels, same sphere
Boundary tested separately for: +X, +Y (mandatory), +Z
SDF variants: sphere, sine ridge, vertical cliff, near-tangent plane, overhang
Camera: stationary, lit by a directional light
```

**Acceptance.**
- No holes, no cracks, no major concavity dips across each boundary.
- No dark seam under a rotating sun.
- Triangle counts recorded; screenshots emitted.
- A scripted `cargo test` variant runs this scene headless and emits a fingerprint JSON for CI.

---

### MTX-031 — Mountain Seam A/B Scene

**Type:** Test/Visual regression · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Test the actual user-visible failure scene.

**Tasks.**
- Reuse `visual-regression-seam-mountain.toml` from MTX-002.
- Render in `sandbox` (MC ring only) and `replace_surface_nets`, plus the SN baseline.
- Capture: screenshots + summary.json + hole-probe JSON for each.

**Acceptance.**
- MC+Transvoxel **closes** the ring seam at the user's standard camera position. Hole-probe `solid-before-render` rays ≤ 5 % (SN today: ~25 %).
- No new dark transition band visible at gameplay distance.
- No normal/triplanar discontinuity visible at gameplay distance.

---

### MTX-032 — Shoreline / Water-Level A/B Scene

**Type:** Test · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Verify the WATER_LEVEL interaction does not regress.

**Tasks.**
- Same as the SN seam plan: chunks where `chunk_y * CHUNK_SIZE` brackets `WATER_LEVEL`.
- Confirm water mesh is unchanged (the water mesher is out of scope), and terrain mesh's contact line with water is no worse than SN.

**Acceptance.**
- No blue cracks at shoreline (terrain mesh visibly contains water below WATER_LEVEL).
- Water reflection/refraction unchanged in the bench scene fingerprint.
- Known water limitations documented if any new ones surface.

---

### MTX-033 — Cave / Overhang Seam A/B Scene (Y boundary)

**Type:** Test · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Verify the case that the current SN path can't close — vertical LOD boundary with surface crossing it.

**Tasks.**
- Use `visual-regression-seam-overhang-cave.toml` from MTX-002.
- Render same three configs as MTX-031.

**Acceptance.**
- The vertical-band seam visible in the SN reference is **closed** in `replace_surface_nets`.
- Hole-probe `nearest_faces=neg_y` heights show step ≤ 0.1 voxels.
- No bleed of cave geometry through the boundary.

---

### MTX-034 — Edit Locality Regression

**Type:** Test/Gameplay · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Verify Transvoxel's local-data promise holds in this codebase.

**Tasks.**
- Edit a voxel:
  - Far from any LOD boundary.
  - On a LOD0↔LOD1 X/Z boundary.
  - On a LOD0↔LOD1 Y boundary.
  - Dig a one-voxel tunnel crossing both boundary types.
- Track dirty chunks via the existing dirty-chunk diagnostic.

**Acceptance.**
- Edits dirty only the local chunk + halo (≤ 27 chunks for a single-voxel edit, ≤ 64 for the tunnel).
- No global remesh, no full-world freeze.
- Transition face masks refresh in the same frame the SDF refreshes; no stale masks observed in stats.

---

### MTX-035 — Collider Smoke Test

**Type:** Physics/Gameplay · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Determine whether MC+Transvoxel can support gameplay collision at all without full collider parity. Production collider is out of scope.

**Scope (one path only):**
- Visual-mesh collider for regular MC; no separate transition collider (transition geometry shares the visual mesh).

**Acceptance.**
- Player can walk over a small test region meshed with MC.
- No fall-through observed at the LOD ring seam in the test region.
- Collider generation ms recorded and compared to SN baseline.
- Production collider path remains unchanged for non-spike chunks.

---

### MTX-036 — Performance Budget Report

**Type:** Performance · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Per CLAUDE.md: name the scene, paste before/after `summary.json` numbers, name the moved counters/timing rows, name visual tradeoffs.

**Tasks.**
- For each of MTX-031/032/033, run `cargo run --release -- --bench bench/scenes/visual/visual-regression-seam-*.toml`.
- Run `cargo run --bin bench_guard -- bench-runs/<run>/summary.json` against the SN baseline guard thresholds. If the spike requires raising thresholds, that's a separate, documented decision — do not bury it in this ticket.
- Aggregate against the **whole-spike success criteria** table at the top of this doc.

**Acceptance.**
- All metrics in the success-criteria table populated for the three seam scenes.
- `bench_guard` either passes against current thresholds, or proposes new thresholds with explicit before/after numbers + justification.
- Report committed under `docs/lod/mctx-perf-report.md`.

---

### MTX-037 — Go / No-Go Decision Memo

**Type:** Decision · **Priority:** P0 · **Estimate:** 0.5–1 day

**Goal.** Make the decision explicit and reversible.

**Required sections in the memo (`docs/lod/mctx-decision.md`):**
1. Visual result (per-scene screenshots and hole-probe deltas).
2. Seam result (LOD step number per scene, before/after).
3. Normal/material result.
4. Water result.
5. Collider result.
6. Performance result (vs criteria 5 above).
7. Engineering risk for full adoption.
8. Recommendation.

**Outcomes:**

- **GO (full adoption):** all criteria met. Spawns the 8–14-week full-adoption epic.
- **PARTIAL GO (one more sprint):** visual is strong but ≥ 1 criterion missed by a margin worth chasing. Plan the targeted follow-up; spike stays sandboxed.
- **NO-GO:** keep Surface Nets as default. Capture the residual SN seams as known limitations and treat the spike's diagnostics + bench scenes as durable assets even if the code is removed.

The memo must include the explicit numbers, not a vibe.

---

## Optional Sprint 4 — Parity work, only if PARTIAL GO

Pursue **only** if MTX-037 says "PARTIAL GO." Each ticket targets a specific gap surfaced by the memo.

### MTX-040 — Chained Lod0↔Lod1↔Lod2 Transitions (no direct Lod0↔Lod2)

**Priority:** P1 · **Estimate:** 2–3 days

Enforce the intermediate-ring policy from MTX-003 as a permanent invariant outside spike code paths.

### MTX-041 — Material-Weight Parity

**Priority:** P1 · **Estimate:** 3–5 days

Bring MC material blending visually comparable to SN. Includes vertex duplication for conflicting attributes at transition cells (Lengyel's standard approach).

### MTX-042 — Transition Normal Parity

**Priority:** P1 · **Estimate:** 2–4 days

Eliminate any remaining dark transition bands. SDF-gradient normals on both regular and transition cells; secondary-position smoothing only if it doesn't break normals.

### MTX-043 — Collider Parity

**Priority:** P2 · **Estimate:** 3–5 days

Decide whether transition cells participate in collision. Start with regular-MC-only collider; promote only if visible physics mismatch appears.

---

# Backlog summary

| ID | Phase | Title | Priority | Estimate |
|---|---|---|---|---|
| MTX-000 | 0 | Spike charter & exit criteria | P0 | 0.5d |
| MTX-001 | 0 | Module skeleton + feature flag | P0 | 0.5–1d |
| MTX-002 | 0 | Baseline failing seams | P0 | 1d |
| MTX-003 | 0 | LOD policy audit (2:1) | P0 | 0.5–1d |
| MTX-010 | 1 | Disambiguated MC tables | P0 | 1–2d |
| MTX-011 | 1 | Regular MC chunk mesher | P0 | 2–3d |
| MTX-012 | 1 | MC normal strategy | P0 | 1d |
| MTX-013 | 1 | Minimal material weights | P1 | 1d |
| MTX-014 | 1 | Sandbox render mode | P0 | 1d |
| MTX-020 | 2 | Transvoxel transition tables | P0 | 1–2d |
| MTX-021 | 2 | Transition face mask system | P0 | 1d |
| MTX-022 | 2 | X/Z transition meshes | P0 | 2–3d |
| MTX-023 | 2 | **Y transition meshes (HARD GATE)** | P0 | 2–3d |
| MTX-024 | 2 | Secondary positions (opt-in) | P1 | 1–2d |
| MTX-025 | 2 | Stats + probe integration | P0 | 1d |
| MTX-030 | 3 | Two-chunk synthetic test | P0 | 1d |
| MTX-031 | 3 | Mountain seam A/B | P0 | 1d |
| MTX-032 | 3 | Shoreline A/B | P0 | 1d |
| MTX-033 | 3 | Cave/overhang Y seam A/B | P0 | 1d |
| MTX-034 | 3 | Edit locality regression | P1 | 1d |
| MTX-035 | 3 | Collider smoke test | P1 | 1d |
| MTX-036 | 3 | Performance budget report | P0 | 1d |
| MTX-037 | 3 | Go/no-go decision memo | P0 | 0.5–1d |
| MTX-040 | 4 (opt) | Chained Lod0↔Lod2 policy | P1 | 2–3d |
| MTX-041 | 4 (opt) | Material parity | P1 | 3–5d |
| MTX-042 | 4 (opt) | Normal parity | P1 | 2–4d |
| MTX-043 | 4 (opt) | Collider parity | P2 | 3–5d |

Total spike (Sprints 0–3): **15–22 engineer-days** (≈ 3 weeks for 1 senior engineer).
Optional Sprint 4: 10–17 engineer-days, only on PARTIAL GO.

# Differences from the prior MC+Transvoxel proposal

This version differs from the original spike plan we reviewed in the following intentional ways:

1. **Y transitions are a hard P0 in Sprint 2, not an opt-in for Sprint 4.** The failing scenes are vertical; doing X/Z only reproduces the failure mode.
2. **`use_secondary_positions` defaults `false`.** The original plan had it default `true` while also treating it as an experimental P1 ticket — internally contradictory.
3. **The LOD-delta audit assertion is just `|a - b| ≤ 1` on logical indices**, not the convoluted step-size arithmetic in the original draft.
4. **Reuses existing diagnostics** (`hole_probe`, `LodTransitionSnapStats`, `lod_delta_gt_one_face_mask`) rather than inventing a parallel set. The SN seam work produced the diagnostic surface we need.
5. **Success criteria are quantitative**, anchored to numbers we already measure (hole-probe ray fraction, height-fan LOD step). The original draft's gates were qualitative.
6. **Renderer integration is constrained**: MC produces the existing `MeshData` schema so the NAADF and triplanar pipelines consume it unchanged. No new render passes in the spike.
7. **Sandbox/selected_chunks/replace_surface_nets modes** are explicit so the A/B is staged and reversible, not all-or-nothing.

# Definition of Done for the spike

The spike is complete when the memo (MTX-037) can answer:

> Does modified MC + Transvoxel close the LOD seams the Surface Nets path leaves
> open in `visual-regression-seam-{mountain,overhang-cave,shoreline}.toml`,
> within the performance budget defined above, without regressing material /
> normal / water / edit / collider behavior in observable ways?

Minimum evidence in the memo:

- Three A/B image triplets (SN baseline, sandbox MC, replace_surface_nets).
- Three hole-probe JSONs per scene (SN, sandbox, replace), with the LOD step number and `solid-before-render` ray fraction tabulated.
- Three `summary.json` files with triangle counts, mesh-gen ms, and frame time.
- Two-chunk synthetic test fingerprint from MTX-030.
- Edit-locality dirty-chunk log from MTX-034.
- A `bench_guard` run report — passing, or proposing thresholds.

If those are not produced, the spike is incomplete and **the decision defaults to NO-GO** regardless of any subjective impression. That is the discipline the spike exists to enforce.
