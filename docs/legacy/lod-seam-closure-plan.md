# LOD Seam Closure Plan (Surface Nets) — Vertical + Horizontal

> Created: 2026-05-22 · Status: Historical plan; partially implemented.
> Scope: `src/voxel/meshing.rs`, `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
> `src/rendering/triplanar_material.rs`, `assets/shaders/triplanar_terrain.wgsl`
> Owner: terrain/rendering
>
> **Stale references:** this doc predates the `src/voxel/meshing.rs` → `src/voxel/meshing/`
> module split (now `surface_nets.rs`, `sdf.rs`, `lod_seam.rs`, `data.rs`), the rename
> `lower_detail_transition_step_for_padded_size` → `lod_transition_step_for_padded_size`,
> and the `Shift+F9` → `Alt+F10` hotkey move. The line numbers and several function names
> below no longer resolve. Core pieces have since landed (Y-face SDF coarsening,
> the legacy boundary snap in `lod_seam.rs`, per-vertex snap fallback, boundary strips);
> for current debug behaviour see [`wireframe-debug-guide.md`](wireframe-debug-guide.md).

## Why this plan, not the MC+Transvoxel spike

The MC+Transvoxel spike proposal is a parallel **surface-extraction rewrite** (it
builds Marching Cubes from scratch because Transvoxel transition tables do not
apply to Surface Nets output). A GO on that spike means swapping the extraction
method everywhere — the very rewrite the spike claims to avoid. Before paying
that, we finish the **existing** Surface Nets seam path, which is cheaper, lower
risk, and already ~75% built.

State of the prior fix doc (`lod-visual-artifact-fixes.md`, 2026-05-13),
re-verified against the current tree on 2026-05-22:

| Prior issue | Status today | Evidence |
|---|---|---|
| Vertical `NeighborLods` + skirts | Done | `skirt.rs:251-266`, vertical skirt geometry present |
| PosY overhang boundary check | Done | `meshing.rs:2295-2300` (`above_y`) |
| Low-LOD SDF boundary transition (X/Z) | Done | `generate_low_lod_sdf` takes `neighbor_lods`, `meshing.rs:2452` |
| **Y-face SDF transition smoothing** | **Not done** | `py` ignored as `_py`, `meshing.rs:2401`, `2414-2419` |
| Barycentric wireframe diagnostic | Done | `WireframeDebug` in `triplanar_material.rs`, `triplanar_terrain.wgsl` |

### Root-cause summary

The seam machinery is **heightfield-biased**. It assumes terrain surfaces are
roughly horizontal, so a seam between two horizontally-adjacent chunks of
different LOD is a *height* mismatch along a vertical wall, which it fixes two
ways:

1. SDF boundary coarsening so the finer chunk samples at the coarse neighbor's
   stride on X/Z faces (`lower_detail_transition_step_for_padded_size`).
2. Boundary-vertex Y-snapping to the coarse neighbor's iso height
   (`snap_boundary_vertices_to_lower_detail_neighbor` + `snap_column_for_face`).

Neither path handles **Y boundaries**:

- `lower_detail_transition_step_for_padded_size` only tests `px`/`pz`; `py` is
  unused (`meshing.rs:2401`).
- `snap_column_for_face` returns `None` for `NegY|PosY` (`meshing.rs:2887`), and
  a Y-height snap is the wrong operation for a horizontal boundary plane where
  the surface crosses it (overhang/cave/cliff).
- Vertical skirts exist but the code comments that a straight-down apron cannot
  hide a vertical LOD boundary (`skirt.rs:437`).

So **vertical seams are structurally unhandled**, and **horizontal seams have
residual failure modes** (LOD delta > 1, the per-face snap fallback cascade,
missing-neighbor cases, and normal/material dark bands that are not geometry at
all).

## Success criteria (whole plan)

Measured on the seam bench scenes (SEAM-001), Surface Nets only:

1. No see-through holes/ledges across X/Z **or** Y LOD boundaries at gameplay
   distance in the captured camera views.
2. No dark normal/material band along any LOD boundary under a rotating sun.
3. Chunk edit/regeneration stays local (no global remesh, no stale skirt/snap).
4. No frame spike > 16.6 ms attributable to seam work in the bench scenes, and
   `bench_guard` passes against `assets/config/bench_guard.toml`.
5. Triangle/vertex counts per chunk within +10% of pre-change baseline.

Every perf claim follows CLAUDE.md: name the scene, before/after `summary.json`
numbers, and the counters/timing rows that moved. If a ticket was not benched,
say so.

---

# Epic: SEAM — Surface Nets LOD Seam Closure

## Phase 0 — Diagnose & baseline

### SEAM-001 — Capture and classify the failing seams

**Type:** Test / Benchmark · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Lock the failure scenes and classify each seam before changing meshing,
so we fix the right thing and can prove it later.

**Tasks.**
- Add deterministic seam bench scenes (reuse the live-LOD scene style):
  - `bench/scenes/visual/visual-regression-seam-mountain.toml` (X/Z ridge, Lod0↔Lod1 and a Lod0↔Lod2 corner)
  - `bench/scenes/visual/visual-regression-seam-overhang-cave.toml` (Y boundary, surface crosses a horizontal chunk plane)
  - `bench/scenes/visual/visual-regression-seam-shoreline.toml` (chunk_y at `WATER_LEVEL`)
  - Each: stationary camera, fixed sun, plus one rotating-sun checkpoint.
- For each seam, classify with the existing `WireframeDebug` material and the
  `Shift+F9` hole/seam dump:
  - geometric hole/ledge, vs
  - skirt artifact (dark wall), vs
  - normal seam (dark band, geometry continuous), vs
  - material seam (texture/weight discontinuity).
- Record per scene: triangle counts, mesh-gen ms, terrain LOD per chunk,
  `LodTransitionSnapStats` (snapped vs fallback face mask), and screenshots.

**Acceptance.**
- ≥3 reproducible seams (≥1 vertical, ≥1 horizontal, ≥1 shoreline).
- Each seam labelled geometry / skirt / normal / material in the doc.
- Baseline `summary.json` + screenshots committed before any meshing change.

**Notes.** Do this first. Without classification we cannot tell a hole (Phase 1/2)
from a dark band (Phase 3).

---

## Phase 1 — Vertical (Y) seam closure

### SEAM-010 — Y-face SDF boundary transition coarsening

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1–2 days

**Goal.** Make a finer chunk's SDF agree with a coarser vertical neighbor on the
shared Y plane, the same way X/Z already do.

**Files.** `src/voxel/meshing.rs`

**Tasks.**
- In `lower_detail_transition_step_for_padded_size` (`meshing.rs:2397`) add the
  Y faces to the boundary-band list, using `py` instead of `_py`:
  - `(ChunkFace::NegY, py <= 1)`
  - `(ChunkFace::PosY, py >= padded_size - 2)`
- Confirm `generate_low_lod_sdf` already forwards `py` (it does, `meshing.rs:2471`),
  and that `generate_sdf` (LOD0 path) passes a real `py`.
- Keep the two-outer-plane coarsening rationale (the welding cell straddles the
  boundary) consistent with the X/Z comment at `meshing.rs:2407-2413`.

**Acceptance.**
- New unit test: a LOD0 chunk above a LOD1/LOD2 chunk has boundary-cell SDF on
  the shared Y plane matching what the coarse neighbor samples for the same world
  position (mirror of `lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample`).
- Existing X/Z transition tests unchanged.
- No change when neighbor is equal/higher detail or unknown.

### SEAM-011 — Y-aware boundary vertex stitching

**Type:** Engineering · **Priority:** P0 · **Estimate:** 2–3 days

**Goal.** Weld boundary vertices across a Y LOD boundary. The current Y-height
snap is the wrong operation here (the surface crosses a horizontal plane), so this
needs a boundary-plane stitch, not a height snap.

**Implementation decision (2026-05-22).** Use approach A. SEAM-010 makes the
SDF agree across Y faces; the stitch then keeps Y on the shared boundary plane
and snaps only the X/Z coordinates onto the lower-detail neighbor's lattice.
This avoids applying the heightfield-only iso-height snap to horizontal chunk
planes. X/Z faces continue to use coarse iso-height snapping.

**Files.** `src/voxel/meshing.rs` (`snap_boundary_vertices_to_lower_detail_neighbor`,
`snap_column_for_face`), tests.

**Tasks.**
- Decide approach (document the choice in the ticket):
  - **A (preferred):** rely on SEAM-010 SDF agreement so both chunks place the
    boundary iso-crossing at the same world position, then add a light
    position-weld for the shared Y plane (snap boundary vertices of the finer
    chunk onto the coarse neighbor's grid columns on the X/Z lattice of the
    shared plane). This extends snapping to Y without the heightfield assumption.
  - **B (fallback):** keep relying on vertical skirts but deepen/clip them so no
    background shows; only if A proves too costly.
- Extend `snap_column_for_face` to return a stitch target for `NegY|PosY`
  (currently `None` at `meshing.rs:2887`) consistent with the chosen approach.
- Reuse the existing per-face `LodTransitionSnapStats` plumbing.

**Acceptance.**
- Two-chunk synthetic test (Lod0 over Lod1) over an overhang SDF: no see-through
  pixels through the Y boundary from a fixed camera.
- `overhang-cave` bench scene shows no ledge at the Y boundary.
- Winding/normal length valid; no NaNs.

### SEAM-012 — Vertical skirt apron correctness

**Type:** Engineering · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Make vertical skirts a clean backstop behind SEAM-010/011 rather than a
dark wall.

**Files.** `src/voxel/skirt.rs`

**Tasks.**
- Revisit the vertical apron drop logic (`skirt.rs:437-442`): orient/extrude so it
  fills the gap toward the neighbor rather than dropping straight down.
- Ensure vertical skirt vertices receive the same material weights and
  SDF-gradient normals as the main mesh (avoid the dark-wall artifact).

**Acceptance.**
- With SEAM-010/011 on, disabling them shows the skirt alone still prevents
  see-through (graceful degradation), without an obvious dark wall in the
  `overhang-cave` scene.

---

## Phase 2 — Horizontal (X/Z) residual hardening

### SEAM-020 — Per-vertex snap fallback (stop the per-face cascade)

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1 day

**Goal.** A single failed column currently disables snapping for an entire face
(`failed = true; break;` then `mark_fallback(face)`, `meshing.rs:2933-2941`),
re-opening seams the rest of that face had closed.

**Files.** `src/voxel/meshing.rs`

**Tasks.**
- Change the fallback granularity from per-face to per-vertex: skip only the
  columns where `coarse_lod_iso_height_for_column` returns `None`, snap the rest.
- Keep the conflicting-target guard (`meshing.rs:2952-2956`) but resolve per
  vertex.

**Acceptance.**
- Unit test: one unresolved column leaves the other boundary vertices snapped.
- `mountain` scene: fewer fallback faces in `LodTransitionSnapStats`; no new holes.

### SEAM-021 — LOD delta > 1 policy (Lod0 ↔ Lod2)

**Type:** Engineering / Validation · **Priority:** P0 · **Estimate:** 1–2 days

**Goal.** LOD is concentric distance bands (`plugin.rs:3952-3964`) with no rule
forcing adjacent chunks to differ by ≤1 level, so band corners and vertical stacks
can produce Lod0↔Lod2 neighbors. Both the SDF coarsening and the snap use
`neighbor_lod.step_size()` so they nominally handle any delta, but this is
unverified for delta ≥ 2.

**Implementation decision (2026-05-22).** Keep Lod0<->Lod2 supported in the seam
path instead of forcing an intermediate Lod1 ring. The hole probe now reports
faces whose logical LOD delta is greater than one, and the Y stitch test covers a
Lod0 over Lod2 boundary. Bench validation still needs visual confirmation on the
mountain corner scene.

**Tasks.**
- Add a debug overlay/dump flagging any neighbor with `|lod_index - neighbor| > 1`
  (use logical LOD index, not the convoluted step-size arithmetic).
- Verify SEAM-010 coarsening and SEAM-011/snap produce a closed boundary for a
  real Lod0↔Lod2 case in the `mountain` corner scene.
- If artifacts remain, choose the cheaper of: (a) enforce an intermediate Lod1
  ring near boundaries, or (b) document Lod0↔Lod2 as unsupported and force a ring.

**Acceptance.**
- Overlay reports delta>1 occurrences; the chosen policy closes the corner seam
  in the bench scene; decision recorded in this doc.

### SEAM-022 — Missing / unloaded neighbor handling

**Type:** Engineering · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Avoid transient seams when a neighbor chunk's LOD is unknown/not yet
meshed (the deferral/empty-cap logic exists in `plugin.rs` but seams can still
flash during streaming).

**Tasks.**
- Confirm meshing defers boundary finalization until required neighbors are
  present; if not, defer the snap/skirt rather than emitting an unstitched edge.
- Add a counter for "skipped due to missing neighbor" surfaced in the debug stats.

**Acceptance.**
- Moving the camera through a streaming boundary in the `mountain` scene shows no
  persistent hole after neighbors load; transient state is bounded.

---

## Phase 3 — Normal & material seams (dark bands, not geometry)

### SEAM-030 — Boundary normal consistency

**Type:** Engineering · **Priority:** P0 · **Estimate:** 1–2 days

**Goal.** Remove dark bands where geometry is continuous but normals differ across
the LOD boundary.

**Files.** `src/voxel/meshing.rs`, `src/voxel/baked_ao.rs` if AO contributes.

**Tasks.**
- For boundary vertices, compute normals from the SDF gradient (deterministic
  across LOD) rather than face-averaged normals that diverge by density.
- Ensure snapped/stitched vertices recompute normals after their position moves
  (SEAM-011/020).

**Acceptance.**
- Rotating-sun checkpoint in `mountain` and `overhang-cave`: no seam darkening.
- Unit test: boundary normals unit-length, no NaN, equal for the same world point
  computed from either chunk.

### SEAM-031 — Boundary material-weight consistency

**Type:** Engineering · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Remove triplanar texture/weight discontinuities across boundaries.

**Files.** `src/voxel/meshing.rs` (`compute_vertex_material_weights`).

**Tasks.**
- Verify material weights for boundary vertices are sampled at the welded world
  position (after SEAM-011/020 move them), and are stable across LOD step.
- Document any low-LOD material limitation as known.

**Acceptance.**
- No visible texture seam at gameplay distance in the bench scenes; weights
  recomputed post-snap.

---

## Phase 4 — Validation & gates

### SEAM-040 — Edit-locality regression

**Type:** Test / Gameplay · **Priority:** P1 · **Estimate:** 1 day

**Goal.** Confirm edits near a boundary stay local and refresh stitch/skirt.

**Tasks.**
- Edit a voxel near an X/Z boundary, near a Y boundary, and dig a tunnel crossing
  a boundary; track dirty chunks and that snap/skirt/normals refresh.

**Acceptance.**
- Only local chunk + halo dirty; no global remesh; no stale seam after edit.

### SEAM-041 — Performance & visual gate

**Type:** Performance · **Priority:** P0 · **Estimate:** 1 day

**Goal.** Prove the seam work is within budget per CLAUDE.md.

**Tasks.**
- Run `cargo run --release -- --bench` on the three seam scenes plus
  `visual-regression-live-lod.toml`, before and after the epic.
- Run `cargo run --bin bench_guard -- bench-runs/<run>/summary.json`.
- Report scene, before/after `summary.json` numbers, the counters/timing rows
  that moved, and any visual tradeoff.

**Acceptance.**
- Whole-plan success criteria met; `bench_guard` passes; report committed.

---

# Backlog summary

| ID | Phase | Title | Priority | Estimate |
|---|---|---|---|---|
| SEAM-001 | 0 | Capture & classify failing seams | P0 | 1d |
| SEAM-010 | 1 | Y-face SDF transition coarsening | P0 | 1–2d |
| SEAM-011 | 1 | Y-aware boundary vertex stitching | P0 | 2–3d |
| SEAM-012 | 1 | Vertical skirt apron correctness | P1 | 1d |
| SEAM-020 | 2 | Per-vertex snap fallback | P0 | 1d |
| SEAM-021 | 2 | LOD delta > 1 policy | P0 | 1–2d |
| SEAM-022 | 2 | Missing-neighbor handling | P1 | 1d |
| SEAM-030 | 3 | Boundary normal consistency | P0 | 1–2d |
| SEAM-031 | 3 | Boundary material consistency | P1 | 1d |
| SEAM-040 | 4 | Edit-locality regression | P1 | 1d |
| SEAM-041 | 4 | Performance & visual gate | P0 | 1d |

Roughly **11–15 engineer-days**, one engineer. Phase 1 (vertical) is the largest
gap and the highest-value work; Phase 0 must precede everything.

# Exit / escalation

If after Phase 1–3 a **structural** vertical seam still survives (geometry, not
normals/material) within budget, that is the evidence that justifies the
MC+Transvoxel spike — and the Phase-0 baselines become its A/B reference. Until
then, this path is the lower-risk fix for both seam directions.
