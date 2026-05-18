# LOD Terrain Hole Investigation

Status: **seam fix implemented; visual bench pending.** Diagnostics (the
schema-7 signed-height fan + the Alt+0 test) isolated the live defect to **X/Z
LOD-seam transition geometry**, not low-LOD interior sampling. Fix 3 resolved
the interior depression (confirmed by captures `111234`/`111255`). Fix 4 now
makes the X/Z transition apron drape along the surface tangent instead of
forming a horizontal flap. Visual LOD bench verification is still pending.
Last updated: 2026-05-17 (revised after capture 115052 confirmed the apron and the steep-slope clamp follow-up landed)
Scope touched (prior session): `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
`src/interaction/debug.rs`, `src/rendering/naadf/debug.rs`
This investigation: camera-ray/fan diagnostics + hotkey separation, **fix 1**
boundary-cell coarsening and **fix 3** centered low-LOD density kernel in
`src/voxel/meshing.rs`, **fix 2** step-sized X/Z transition aprons and **fix 4**
surface-tangent apron drape in `src/voxel/skirt.rs`.

---

## Current state — read this first

The reported artifact — dark see-through cracks/gashes on distant terrain that
**disappear as the camera gets closer** — was split into **two distinct
problems** that the early probes conflated:

1. **See-through holes** at Lod0/Lod1 chunk-boundary seams (X/Z faces). Real
   missing render geometry. Addressed by fixes 1 + 2.
2. **Low-LOD height depression.** A Lod1 chunk's meshed surface did not sit at
   the same height as its Lod0 neighbour. Addressed by fix 3.

**Where it stands (captures `111234` / `111255`):**

- **Fix 3 worked — the interior depression is resolved.** Lod1 *interior*
  signed height vs Lod0 interior is now −0.33 / −0.13 voxel, inside the ±0.5
  integer-sampling floor. **Stop tuning low-LOD interior sampling.**
- **The live defect is the X/Z LOD seam.** All large errors are in the
  `near_face` buckets — `111255` Lod0 `near_face` spans −0.31 → **+1.78**. The
  artifact is now **transition / apron / skirt geometry at the seam**, not a
  whole Lod1 chunk sitting low. See *Live defect: the X/Z seam*.
- The **Alt+0 test ran**: forcing every chunk to Lod0 and waiting for the
  remesh queue to drain made the artifact **disappear** → it is **LOD
  geometry**, not shading / material / AO.

Fixes 1-4 are **in code; not bench verified.** Current targeted test state:
`cargo test --lib voxel::meshing` → **29 passed** and
`cargo test --lib voxel::skirt` → **8 passed**.

Earlier "decisive findings" that were **wrong** and are corrected here:

- "Uniform Lod0, not a LOD artifact" — disproved by the Alt+K overlay (Lod1
  chunks sit on the cracks).
- "The seam is on the vertical (Y) axis" — disproved by probe `030902`: every
  vertical column is LOD-coherent. The boundaries are on **X and Z faces**.
- "Coarsen more inboard SDF planes" — a broad inboard SDF-band trial made the
  scene visibly worse (`052046`, many blue strips) and was **reverted**. Only
  the two-plane boundary-cell coarsening (fix 1) was kept.

---

## Symptom

- Dark see-through patches / thin gashes on terrain at a distance.
- They **disappear when the camera moves closer.**
- They **churn / flicker while the camera moves**, settle when stationary.
- Legacy mesh renderer (Surface Nets + LOD + skirts). NAADF off.

---

## Root cause

Terrain LOD is **XZ-distance-based** (`terrain_lod_distance_xz`), so a vertical
column shares one LOD — the only LOD boundaries are between horizontally
adjacent columns, i.e. **X/Z chunk faces**. Two coupled defects there:

### A. Low-LOD surface depression (the phase error)

The low-LOD SDF replaced each `step³` voxel block with one density value
(`sample_lod_density_at_world_pos`). The averaging itself is fine — a box filter
is zero-phase — **but the value was stored at the block's lower corner, not its
centre.** `coarse_aligned_lod_sample_base` returned `base` and the block sampled
was `[base, base+step)`, whose true centre is `base + step/2`. The mesh places
the lattice point at `base`, so the reconstructed surface landed `~step/2` voxel
toward −X/−Y/−Z of where the averaged field actually crosses zero. The −Y
component sinks the patch; on a slope the −X/−Z components project onto the
slope and add more apparent drop — measured as ~1–2.5 voxels.

### B. See-through holes at the seam

A Lod1 chunk sat ~2 voxels below its Lod0 neighbour (defect A), and the Lod0
weld mitigation could not bridge it:

- **SDF coarsening was one plane deep.** `lower_detail_transition_step` coarsened
  only the outermost padded plane, so the boundary Surface-Nets *cell* kept its
  inner corner at fine resolution and its vertices did not coincide with the
  fully-coarse Lod1 boundary vertices.
- **The skirt was a decorative lip.** The X/Z transition apron was only
  `step*0.08` wide (clamped `0.16..0.30` voxel), far too thin to back a gap a
  whole voxel inside the coarse side.

"Disappears up close": as the camera nears, the Lod1 chunk promotes to Lod0,
both sides mesh identically, the step and the gap vanish.

---

## Fixes applied (in code; not visually/bench verified)

### Fix 1 — two-plane boundary-cell coarsening (`meshing.rs`)

`lower_detail_transition_step_for_padded_size` coarsens the **two** outermost
padded planes per X/Z face (`px <= 1` / `px >= padded-2`), so the Surface-Nets
cell that welds to a lower-detail neighbour is fully coarse, not half-fine.
Regression test: `lod0_transition_coarsens_full_boundary_band_not_just_outer_plane`.
A broader inboard band was tried and **reverted** (made the artifact worse).

### Fix 2 — step-sized X/Z transition aprons (`skirt.rs`)

X/Z transition aprons now span the coarse sampling step (`2.0` voxels for a
Lod0/Lod1 seam) instead of the old `0.16..0.30` voxel lip, steep side edges emit
the apron too, and the vertical skirt drops from the apron edge.

### Fix 3 — centered low-LOD density kernel (`meshing.rs`)

`coarse_aligned_lod_sample_base*` was renamed `centered_lod_sample_base*` and now
subtracts `step/2`, so the `step³` density footprint is **centred on the lattice
point** instead of starting at it. This removes the phase error of defect A.

It is the **shared** sampler — both `generate_low_lod_sdf` (Lod1/2/3 chunks) and
`generate_sdf`'s transition band ([meshing.rs](../../src/voxel/meshing.rs)) call
it — so the Lod0 transition band and the Lod1 chunk shift **together** and the
weld is preserved. This was the trap; it was avoided.

Regression test: `low_lod_density_filter_is_centered_on_lattice_sample` (centred
kernel yields half-solid density at the true surface plane). Passes.

### Fix 4 — surface-tangent X/Z transition apron drape (`skirt.rs`)

Fix 2's step-sized apron was horizontal. On a steep slope that can form a proud
flap over the lower-detail side. The apron now projects the X/Z face-normal
offset onto the local surface tangent derived from each boundary vertex normal,
then scales that tangent so the apron still spans the coarse sampling step. On
downhill faces it drops as it extends into the lower-detail neighbour instead
of floating horizontally.

**Clamp follow-up.** The first cut of the drape clamped `offset.y` on its own to
`width*2`. That truncated the drop on *steep* slopes while leaving the
horizontal reach full — lifting the apron off the surface again (capture
`115052` still showed +1.90 on a Lod0 `near_face` sample). Corrected: the cap is
now applied to the along-surface *scale*, so a steep apron simply reaches less
far horizontally and stays glued to the slope.

Regression tests:

- `lod_transition_apron_drapes_downhill_instead_of_forming_horizontal_flap`
  locks the skirt-level geometry on a 45° edge.
- `lod_transition_apron_stays_on_steep_slope_without_floating` — a ~70° edge;
  asserts the apron tracks the slope and never floats above it (guards the
  clamp follow-up).
- `steep_lod0_lod1_x_seam_transition_stays_near_reference_surface` meshes a
  synthetic steep Lod0/Lod1 X seam and compares the transition seam against an
  all-Lod0 reference seam with a measured tolerance.

---

## The unavoidable 0.5-voxel residual

Fix 3 does not make Lod1 *match* Lod0 — it **flips the sign** of the flat-terrain
offset:

| | Lod1 flat surface | vs Lod0 (y = 7.5) |
| --- | --- | --- |
| Before fix 3 (corner kernel) | y = **7.0** | 0.5 **below** |
| After fix 3 (centered kernel) | y = **8.0** | 0.5 **above** |

Why exact match is **impossible with integer voxel sampling**:

- Lod0 corner-samples a 1-wide voxel → its surface lands at `face − 0.5` (= 7.5
  for a face at y=8).
- A Lod1 2-wide integer block can place the zero-crossing only at **7.0**
  (window `[P, P+2)`) or **8.0** (window `[P−1, P+1)`) — never 7.5. Hitting 7.5
  needs a window starting at a fractional offset (α = 2/3), which integer voxel
  sampling cannot do.

So a `±0.5` voxel Lod0/Lod1 mismatch is the **floor** for any integer-block
low-LOD sampler. Fix 3 chose the `+0.5` (proud) side. Note this is arguably the
*more accurate* side: centered Lod1 at y=8 sits on the **true terrain face**;
it is Lod0 that renders 0.5 below the face by its own corner convention.

### Retargeted flat-surface test

The old `voxel::meshing::tests::lod1_flat_surface_matches_lod0_mesh_height`
asserted exact Lod0/Lod1 flat-surface agreement within `0.05` voxel. That was
not achievable with integer-block low-LOD sampling. It has been retargeted as
`lod1_flat_surface_stays_within_half_voxel_of_lod0`, guarding the real contract:
Lod1 must stay within the known half-voxel floor instead of matching Lod0
exactly. Do not "fix" this by reverting fix 3.

Eliminating the residual entirely would require moving Lod0 itself onto the true
face (+0.5, i.e. centre-sampling Lod0 too) — a change touching *all* terrain
meshing. Not worth it for 0.5 voxel unless the residual proves visible.

---

## Live defect: the X/Z seam (post-fix-3)

With fix 3 in, the low-LOD *interior* is correct. Captures `111234`/`111255`
localise the remaining artifact entirely to the **X/Z Lod0/Lod1 seam**, and the
error is **bidirectional**:

- Lod1 `near_face` samples run *low* (down to −0.76) — the side-gap / hole side.
- Lod0 `near_face` samples run *high* — up to **+1.78** above voxel truth.

A +1.78 is geometry **sticking up**; a larger or longer skirt cannot fix it.

**Confirmed — the apron is the proud error.** Capture `115052` put the peak
**+1.90** on a Lod0 `near_face` sample, and the Lod0 chunk is exactly the side
that emits the transition apron toward a Lod1 neighbour. The apron extrudes a
~2-voxel offset from the boundary edge; on a steep slope a horizontal — or
clamp-truncated — flap juts out over terrain that is ~`2·slope` lower, so its
outer edge floats well above the true surface ≈ the measured +1.90.

**Fixed (fix 4 + clamp follow-up):** the apron drapes along the surface tangent,
and the steep-slope cap now shortens the along-surface reach instead of
truncating the drop — so the apron stays glued to the slope. This targets
`src/voxel/skirt.rs` apron geometry only — **not** the low-LOD SDF sampler (keep
fix 3) and **not** a bigger skirt.

---

## Known diagnostic limitation — the see-through fan conflates two faults

`camera_ray_fan`'s gap test is `first_voxel_solid + 1.0 < first_front_render_hit`.
A surface that is **depressed but intact** (defect A) makes a grazing camera ray
enter solid voxel data *before* it reaches the lowered render mesh — which trips
the gap test even though there is no hole. So:

- The fan's gap **count is not a hole count** and not an improvement metric.
  A capture reporting "27/81 gaps" may be mostly the depression misread, not 27
  holes.
- A see-through hole and a height depression need **separate** measurements.

Schema 7 now measures **signed surface error** (render-hit height minus
voxel-truth height), not just hole presence. The old `camera_ray_fan` count is
still recorded, but the console now labels it as a solid-before-render
candidate because it can be either a true hole or a depressed intact surface.

---

## Capture history (provenance, condensed)

- `030902` — established X/Z (not Y) Lod0/Lod1 seams; columns LOD-coherent;
  chunks `current`/not-dirty; render grid 1.0–2.5 voxel below truth; one grid
  MISS = a real hole.
- `043621` — inconclusive (center ray hit intact terrain); revealed the
  Shift+F9 / water-reflection-debug hotkey collision (now fixed).
- `045158` — `9/81` fan gaps; pinpointed a side-seam MISS strip one voxel inside
  the coarse side of a `z=400` boundary → motivated fix 2.
- `050853` — gaps remained; one gap in Lod0 `21,4,25` motivated (wrongly) an
  inboard SDF-band expansion.
- `052046` — `20/81` gaps + many blue strips: the inboard SDF-band expansion was
  **falsified visually and reverted**.
- `075633` — schema 6, `27/81` fan gaps but small render-grid errors. This count
  is unreliable (see *Known diagnostic limitation*) and the capture mixes
  hole-detection with height-error questions.
- `100025` / `100037` — schema 7 confirmed an Alt+0 timing trap. Immediately
  after Alt+0, the overlay/current LOD switched to Lod0, but several visible
  meshes still reported `last_meshed_lod=Lod1`, `mesh_status=remesh_pending`,
  `dirty=true`. After waiting for the remesh queue to drain, the artifact
  disappeared. Conclusion: the remaining visible depression is LOD geometry or
  LOD seam behavior, not a persistent material/shading issue. The `100037`
  mislabel also exposed a probe bug — the height-fan summary grouped samples by
  *logical* `lod_level`, not `last_meshed_lod`; fixed.
- `111234` / `111255` — clean schema-7 captures, grouped by `last_meshed_lod` +
  `mesh_status` (`Current` meshes only). Lod1 *interior* vs Lod0 interior
  −0.33 / −0.13 (within the ±0.5 floor → **fix 3 confirmed**). All large errors
  in `near_face`; peak **+1.78** on a Lod0 near-face sample. `camera_ray_fan`
  down to 4–7/81 candidates. → interior fixed, defect isolated to the seam.
- `115052` — Lod1 pristine (interior −0.12 → −0.00); peak **+1.90** on a Lod0
  `near_face` sample. Confirmed the proud error is the Lod0-side transition
  apron, and that the fix-4 drape still floated on steep slopes because of the
  `offset.y` clamp → motivated the clamp follow-up (see *Fix 4*).

---

## Diagnostics available (keys)

- **Shift+F9** — terrain hole probe → `debug/terrain-hole-probe-*.json`
  (schema 7): per-chunk LOD, neighbour LODs, surface-mismatch flags,
  `camera_ray`, `camera_ray_fan`, and an extended `render_mesh_ray_grid`.
  `render_mesh_ray_grid` contains both `sample_kind=target_vertical` samples
  and the 7×7, 6-degree `sample_kind=camera_height_fan` samples with signed
  surface error, hit chunk/local position, nearest faces, and chunk LOD state.
  The `target_*`/`classification` fields describe the voxel-raycast target,
  which can pass *through* a see-through gap onto terrain behind it; for the
  remaining depression, read the signed `camera_height_fan` entries first.
- **Alt+Shift+F9** — water reflection debug cycle (moved off Shift+F9, which had
  been contaminating probe captures).
- **Alt+K** — chunk-border overlay coloured by LOD (Lod0 green, Lod1 yellow,
  Lod2 orange, Lod3 red, Culled grey); logs the LOD histogram on enable. While
  on, crosshair reach is extended to 512 m.
- **Alt+0** — force every loaded chunk to Lod0 (snapshot + restore). Run
  stationary and **wait for the remesh queue to drain** — the overlay turns
  green immediately, but meshes redraw through the dirty queue, so a green
  overlay alone does not prove the rendered mesh changed. Used here to confirm
  the artifact is LOD geometry (it vanished once all chunks re-meshed Lod0).

---

## Decision: fine-boundary snap weld for X/Z Lod0/Lod1 seams

**Current-code note (2026-05-18):** the checked-out meshing code does not have a
`sample_lod_density_at_world_pos` averaged-density path. `generate_low_lod_sdf`
currently samples the coarse lattice with `sample_lod_sdf_at_world_pos` and then
smooths interior SDF values only; boundary samples stay point-sampled for seam
stability. Any plan assuming the Lod1 mesh uses a 2x2x2 centered density sampler
is stale for this checkout.

**Visual verdict (2026-05-17 close-up capture):** the seam artifact is **still
prominent** — many dark notches/ledges across the mountain's Lod0/Lod1
transition band. The direct distance→LOD fix correctly produced proper LOD
rings, which *surfaced the seam defect in more places*, not fewer. Skirts +
SDF-matching are confirmed a dead end: they convert holes into visible ledges
and cannot weld two different-resolution Surface Nets boundaries.

**Approach implemented for V1:** do not build an in-plane ribbon between the
Lod0 and Lod1 boundary polylines. Both polylines lie on the same chunk face, so
that would just recreate a vertical wall. Instead, the Lod0 mesh now performs a
conservative snap pass before skirt extraction: for known X/Z Lod0->Lod1
neighbours, every fine boundary vertex on a face must resolve to a single clean
coarse Lod1 iso-height; if so, its Y is moved to that coarse surface and the
old X/Z skirt/apron for that face is suppressed. If any boundary vertex on the
face has no clean crossing or an ambiguous/multi-crossing column, the whole face
falls back to the existing draped apron/skirt.

Rejected for this pass: the separate post-hoc **stitch-entity** design and the
coplanar boundary-ribbon plan. Both add lifecycle/geometry risk without solving
the wall itself.

### V1 scope and rules

- **X/Z faces only**, Surface Nets only, Lod0->Lod1 only. Y faces, blocky mode,
  and other LOD pairs keep current behaviour.
- Snap is **face-level**: all boundary vertices on that face succeed or none
  are moved.
- On successful snap, suppress the X/Z apron/vertical skirt for that face.
  Skirts remain the strict fallback for snap-failed known X/Z LOD seams.
- The coarse iso-height helper uses the same coarse lattice sampling convention
  as the low-LOD SDF path, scans the vertical coarse column, and accepts exactly
  one solid-to-air crossing.
- Do **not** invent skirts for unknown/missing neighbours (current code already
  doesn't — keep it).
- Render-only: no collider changes.
- Shift+F9 schema 7 now reports `lod_transition_snap` stats on terrain mesh
  debug data: snapped face mask, fallback face mask, and snapped vertex count.

### Verification status

- Unit coverage added for single-crossing interpolation, no-crossing and
  multi-crossing rejection, X/Z snap-to-coarse-height, no proud snap, and
  ambiguous-column fallback.
- Fresh manual capture `20260518-015338` is now considered contaminated by
  startup/load churn and should not be used to judge the snap weld.
- Fresh manual captures `20260518-025230` / `20260518-025317` repeated the same
  probe values, but exposed a different convergence bug: many sampled chunks
  were `mesh_status=Current` while `current_lod` still differed from
  `computed_target_lod` (for example `Lod0 -> Lod2`). The LOD updater was
  skipping its scan while the camera was stationary, so chunks loaded after the
  last movement could remain at stale high detail until the player moved.
  `update_chunk_lod_system` now runs stationary scans only while chunk count
  changes or prior LOD candidates are still draining, then idles again.
- Visual LOD bench run `bench-runs/2026-05-18T03-01-56Z` measured the naive
  always-scan stationary fix and failed live-LOD guard rows:
  `Mesh Dirty:p99` 13.060 / 12.565 / 8.796 ms and `forest-look-sweep`
  frame p99 44.303 ms. This confirmed the convergence fix could not be a
  permanent 4 Hz full-world scan.
- Visual LOD bench run `bench-runs/2026-05-18T03-17-52Z` measured the current
  drain-only stationary scan. It improved `Mesh Dirty:p99` to 10.702 / 11.406 /
  6.378 ms but still failed ridge/jump mesh-dirty p99 and forest frame p99. The
  visual bench remains an honest non-signoff; manual probe recapture is still
  needed to verify the visible mountain seam after LOD convergence.
- Visual LOD bench run `bench-runs/2026-05-17T17-32-24Z` completed and produced
  screenshots, but every checkpoint hit render-ready timeout. `bench_guard`
  passed live-LOD mesh-dirty p99 rows (0.149-0.204 ms) and failed
  `live_lod_frame_p99` for `forest-look-sweep` (35.268 ms > 25 ms fail
  threshold). This is not a clean visual/performance sign-off.
- Discarded experiment note: visual LOD bench run
  `bench-runs/2026-05-18T02-13-00Z` was captured while testing an edge-local
  fallback variant that has since been backed out. It is not verification of the
  current face-level snap implementation.
- Still required before claiming the mountain fixed: fresh manual Alt+K /
  Shift+F9 capture from the main play binary, checking `lod_transition_snap`
  stats and near-face height errors on the actual visible seam.

---

## Hypotheses ruled out

| Hypothesis | Why |
| --- | --- |
| "Uniform Lod0 / base-mesh bug" | Alt+K overlay — Lod1 chunks sit on the cracks. |
| Y-axis (vertical) LOD T-junction | Probe `030902` — every column is LOD-coherent; boundaries are X/Z. |
| Re-mesh staleness / transient backlog | Probe — all chunks `dirty=false`, `status=current`. |
| Missing-neighbour meshing bug | Probe — `missing_boundary_neighbors_at_mesh=0`. |
| "Coarsen more inboard SDF planes" | `052046` — broad inboard band made the artifact worse; reverted. |
| NAADF renderer bug | Cracks on the legacy renderer; NAADF off. |

---

## Related docs

- `docs/lod/lod-visual-artifact-fixes.md` — older planning doc; Issues 1/3/4
  already implemented. Stale; update or archive.
