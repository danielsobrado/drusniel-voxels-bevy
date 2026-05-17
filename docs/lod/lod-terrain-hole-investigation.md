# LOD Terrain Hole Investigation

Status: **root cause identified** (Lod0↔Lod1 X/Z chunk-boundary seam) — **fix 1
applied; visual + bench verification pending.**
Last updated: 2026-05-17 (revised after Shift+F9 probe `20260517-030902`)
Scope touched (prior session): `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
`src/interaction/debug.rs`, `src/rendering/naadf/debug.rs`
This revision: investigation, a diagnostic-reach tweak
(`src/interaction/targeting.rs`, `src/interaction/debug.rs` key move), and
**fix 1** — full boundary-band coarsening in `src/voxel/meshing.rs`.

---

## Current state — read this first

The reported artifact — dark see-through cracks/gashes on distant terrain that
**disappear as the camera gets closer** — is **not fixed**, but is now
**root-caused** from a Shift+F9 terrain-hole probe.

**Root cause: a Lod0↔Lod1 chunk-boundary seam on an X or Z chunk face.** A Lod1
chunk meshes its surface ~1–2.5 voxels *below* the true voxel surface; its Lod0
neighbour meshes at the true surface. The Lod0 side's weld mitigation (one-plane
SDF coarsening + a straight-down skirt) does not close that step on steep
terrain, so a see-through gap opens at the seam.

Two earlier "decisive findings" were **both wrong** and are corrected here:

- The first handoff claimed "uniform Lod0, not a LOD artifact." Disproved by the
  Alt+K overlay (Lod1 chunks sit on the cracks).
- The previous revision of this doc claimed the seam was on the **vertical
  (Y) axis**. Disproved by the probe: every vertical column in the probed
  neighbourhood is LOD-coherent. **The boundaries are on X and Z faces.**

---

## Symptom

- Dark see-through patches and thin gashes on terrain at a distance.
- They **disappear when the camera moves closer.**
- They **churn / flicker while the camera moves** and tend to settle when
  stationary.
- Seen on the **legacy mesh renderer** (Surface Nets + LOD + skirts). NAADF off.

---

## Probe evidence (`debug/terrain-hole-probe-20260517-030902.json`)

Target voxel `(152,74,349)` = Sand, chunk `(9,4,21)` local `(8,10,13)`.

**LOD map of the 27-chunk neighbourhood:**

| Axis | Observation | Meaning |
| --- | --- | --- |
| Y | Each column holds one LOD at y=3,4,5 (`x9,z21`=Lod1; `x10`=Lod0; `x9,z22`=Lod0) | **No Y-axis LOD boundary.** Columns are LOD-coherent. |
| X | Lod1 at x≤9, Lod0 at x=10 | Lod0↔Lod1 seam on an **X face**. |
| Z | Lod1 at z≤21, Lod0 at z=22 | Lod0↔Lod1 seam on a **Z face**. |

- Every chunk: `dirty=false`, `mesh_status=current`, `mesh_lod_mismatch=false`
  → **not staleness, not a transient remesh backlog.**
- `missing_boundary_neighbors_at_mesh=0` everywhere → not a missing-neighbour
  meshing bug.
- 5×5 render-ray grid (all inside the Lod1 chunk `9,4,21`): the rendered
  surface is **1.0–2.5 voxels below `expected_surface_y`** (the voxel-data
  truth) in *all* 24 cells; 5 cells exceed the 2.0 mismatch threshold.
- One grid cell (`wz=350.5`, ~1.5 voxels from the z=352 Lod0/Lod1 seam)
  **returned no triangle hit in the whole 27-chunk set — a genuine mesh hole.**
- `classification.mesh_surface_mismatch=false` is a false negative: the
  classifier tests only the exact crosshair pixel (error 1.93, just under 2.0).
  The crosshair landed mid-chunk; the grid around it shows the real mismatch.

---

## Mechanism

1. Terrain LOD is **XZ-distance-based** (`terrain_lod_distance_xz`), so a whole
   vertical column shares one LOD — hence no Y boundary, and the only LOD
   boundaries are between **horizontally adjacent columns** (X/Z faces).
2. A **Lod1** chunk samples density over 2×2×2 blocks; its Surface-Nets
   isosurface sits up to ~one step (≈2 voxels) off the true surface — measured
   here as a systematic ~2-voxel **downward** offset.
3. Its **Lod0** neighbour meshes at the true surface. So across the shared X/Z
   face the two meshes disagree in height by ~2 voxels.
4. The intended weld: the finer **Lod0** chunk, toward a lower-detail neighbour,
   (a) coarsens its boundary SDF and (b) emits a skirt. Both are inadequate:
   - **SDF coarsening is one plane deep.** `lower_detail_transition_step`
     ([meshing.rs:2280](../../src/voxel/meshing.rs#L2280)) coarsens only the
     outermost padded plane (`px==1` / `px==padded-1`). The boundary
     Surface-Nets *cells* still have their inner corners at fine resolution, so
     the Lod0 boundary vertices do not coincide with the fully-coarse Lod1
     boundary vertices — the overlap geometry does not match.
   - **The skirt is a straight-down curtain.** For X/Z faces `generate_skirts`
     ([skirt.rs:375](../../src/voxel/skirt.rs#L375)) drops `(0,-depth,0)`. On a
     steep mountain face the seam is in a near-vertical surface; a vertical
     curtain runs parallel to the gap instead of covering it.
5. Result: an unwelded ~2-voxel step → the see-through crack.
6. **"Disappears up close"**: as the camera nears, the Lod1 chunk promotes to
   Lod0; both sides mesh at the true surface; the step vanishes; the seam welds.

---

## Candidate fixes (ranked)

1. **Coarsen the finer chunk's full boundary band, not one plane.** ✅ **DONE**
   — `lower_detail_transition_step_for_padded_size` now coarsens the two
   outermost padded planes per X/Z face (`px <= 1` / `px >= padded-2`) instead
   of only the outermost one, so the Surface-Nets cell that welds to a
   lower-detail neighbour is fully coarse and its boundary edge drops to the
   coarse neighbour's surface height. Regression test:
   `lod0_transition_coarsens_full_boundary_band_not_just_outer_plane`
   (`voxel::` suite 112 → 113 passing). Visual + bench verification pending.
2. **Make the skirt cover the real step.** Extrude the X/Z skirt along the
   surface normal (or size it to the measured LOD height offset, ~step voxels)
   instead of a fixed straight-down curtain — the same reasoning that motivated
   the Y-face apron, applied to X/Z faces on steep terrain.
3. **Reduce the Lod1 surface offset** (e.g. bias the low-LOD density sampling so
   the isosurface tracks the true surface more closely). Helps everywhere but
   does not by itself guarantee a weld.

`1` + `2` together are likely needed: `1` removes the geometric step, `2`
guarantees no daylight if any residual mismatch remains.

**Note:** the previous revision's candidate "per-column atomic LOD update" is
**dropped** — the probe shows columns are already LOD-coherent and the meshes
are current, so there is no transient column split to fix.

---

## Patches from the prior session — honest status

| # | Patch | File(s) | Status |
| --- | --- | --- | --- |
| 1 | Vertical (Y-face) skirt apron | `skirt.rs` | **Off-target.** The probe shows the seam is X/Z, not Y. Harmless; leave it, but it does not touch this bug. |
| 2 | `Alt+0` force-Lod0 toggle | `interaction/debug.rs` | Diagnostic. Direct-sets every chunk to Lod0 with snapshot/restore. |
| 3a | Chunk-border overlay + LOD histogram | `interaction/debug.rs` | Diagnostic. Toggle key **moved from Alt+B to Alt+K** (Alt+B collided with building mode + prop-bounds debug and locked out movement/aiming). This overlay + Shift+F9 produced the root cause. |
| 3b | LOD coherence pass + `MAX_LOD_CHANGES_PER_UPDATE` 4→32 | `plugin.rs` | Reduces transition backlog. Not the crack (the crack is steady-state). |
| 4 | NAADF debug overlay recoloured | `rendering/naadf/debug.rs` | Cleanup; avoids overlay confusion. |
| 5 | Crosshair reach extended to 512 m while the chunk-border overlay is on | `interaction/targeting.rs` | Diagnostic — lets distant cracks be targeted for Shift+F9. (This revision.) |

---

## Hypotheses ruled out

| Hypothesis | Why |
| --- | --- |
| "Uniform Lod0 / base-mesh bug" | Disproved by Alt+K overlay — Lod1 chunks sit on the cracks. |
| Y-axis (vertical) LOD T-junction | Disproved by probe — every column is LOD-coherent; boundaries are X/Z. |
| Re-mesh staleness / transient backlog | Probe: all chunks `dirty=false`, `status=current`. |
| Missing-neighbour meshing bug | Probe: `missing_boundary_neighbors_at_mesh=0`. |
| NAADF renderer bug | Cracks on the legacy renderer; NAADF off. |
| Ray-distance / step-budget cutoff | Legacy cull distance (320) exceeds visible range. |

---

## Diagnostics available (keys)

- **Shift+F9** — terrain hole probe; dumps `debug/terrain-hole-probe-*.json`
  (schema 4) with per-chunk LOD, neighbour LODs, surface-mismatch flags, a
  render-ray grid, and a **`camera_ray`** block: the camera look-ray cast
  against the render meshes. `camera_ray.see_through_gap` is set when the ray
  enters solid voxel data with no render surface there — the crack, captured
  directly (a `SEE-THROUGH GAP` `warn!` is logged too). Use this for
  see-through cracks: the voxel-raycast target passes through the gap and locks
  onto terrain behind it, so the `target_*`/`classification` fields describe
  healthy terrain, not the crack — read `camera_ray` instead.
- **Alt+K** — chunk-border overlay; box per terrain chunk coloured by LOD
  (Lod0 green, Lod1 yellow, Lod2 orange, Lod3 red, Culled grey); logs the LOD
  histogram on enable. While it is on, the crosshair reach is extended to 512 m
  so distant cracks can be targeted.
- **Alt+0** — force every loaded chunk to Lod0 (snapshot + restore). Run
  stationary. Cracks vanishing under Alt+0 is direct confirmation of a
  LOD-boundary artifact.

---

## Open threads for the next conversation (ranked)

1. **Verify fix 1 visually.** With Alt+K on, return to the probed seam (mountain
   shoulder near chunk `9,4,21`) and check the crack is gone or much reduced.
   Re-probe with Shift+F9 aimed **exactly on the seam** and confirm the
   render-ray-grid surface-error collapses and the mesh hole at `wz≈350.5` is
   filled.
2. **Bench fix 1** on `visual-regression-naadf-live-lod.toml`; per `CLAUDE.md`,
   capture before/after `summary.json` — the extra boundary-band coarse
   sampling adds some meshing cost (one more padded plane per X/Z face sampled
   as a 2×2×2 block instead of a single voxel).
3. **If a hairline seam remains, implement candidate fix 2** (normal-aligned /
   step-sized X/Z skirt) as the backstop. Fix 1 drops the fine chunk's boundary
   edge to the coarse height but cannot make a fine 1-unit cell and a coarse
   2-unit cell place vertices identically; any residual sub-voxel gap is the
   skirt's job.

## Related docs

- `docs/lod/lod-visual-artifact-fixes.md` — older planning doc; Issues 1/3/4
  already implemented. Stale; update or archive.
