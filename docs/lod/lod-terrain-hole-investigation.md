# LOD Terrain Hole Investigation

Status: **cracks NOT fixed** — but root-cause hypothesis substantially corrected
Last updated: 2026-05-17 (revised after Alt+B screenshot review)
Scope touched (prior session): `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
`src/interaction/debug.rs`, `src/rendering/naadf/debug.rs`
This revision: investigation only, no code changed.

---

## Current state — read this first

The reported artifact — dark see-through cracks/gashes on distant terrain that
**disappear as the camera gets closer** — is **not fixed.**

**The previous handoff's central finding was wrong.** It claimed:

> The cracked terrain is uniform Lod0. Every chunk at and around the cracks
> drew green (Lod0).

A fresh Alt+B screenshot disproves this:

- The on-enable histogram logged **`Lod0=2609 Lod1=79 …`** — Lod1 chunks exist.
- **Yellow (Lod1) chunk boxes are visibly intermixed with green inside the
  red-circled crack regions** (clearest in the right-hand circle; also along
  the upper-left mountain shoulder).
- The dominant crack is a **roughly horizontal band** across the mountain plus
  notches — *not* the "vertical gashes" the old doc asserted.

So the cracks **do** sit on Lod0/Lod1 chunk boundaries. This is a **LOD-boundary
artifact** after all. The old doc's "ruled out: LOD boundary / Y-boundary
T-junction" rows are **re-opened** — they were dismissed on the strength of a
bad overlay read.

---

## Symptom

- Dark see-through patches and thin gashes on terrain at a distance.
- They **disappear when the camera moves closer.**
- They **churn / flicker while the camera moves** and tend to settle when
  stationary.
- Seen on the **legacy mesh renderer** (Surface Nets + LOD + skirts). NAADF off.

---

## Corrected root-cause hypothesis

**A Lod0↔Lod1 chunk-boundary T-junction crack, predominantly on the vertical
(Y-axis) chunk boundary, left open because vertical LOD transitions are
deliberately excluded from SDF boundary-matching.**

Four independent pieces of evidence converge on this:

1. **The overlay** shows Lod1 chunks at the cracks (above).
2. **The crack is horizontal** → it lies on a constant world-Y plane → a chunk
   **Y-axis** boundary, not an X/Z one.
3. **The code confirms vertical LOD transitions are not SDF-matched.**
   `lower_detail_transition_step_for_padded_size`
   ([meshing.rs:2249](../../src/voxel/meshing.rs#L2249)) iterates **only**
   `NegX/PosX/NegZ/PosZ` — `NegY`/`PosY` are not in the loop. Both
   `generate_sdf` (Lod0) and `generate_low_lod_sdf` (Lod1–3) depend on it.
   The test `lod0_vertical_transition_boundary_ignores_lower_lod_neighbor_sample`
   ([meshing.rs:3702](../../src/voxel/meshing.rs#L3702)) *explicitly asserts*
   that a `neg_y: Lod1` neighbour leaves the Lod0 SDF unchanged. So when a Lod0
   chunk meets a Lod1 chunk across a horizontal boundary, each meshes the shared
   surface at its own resolution; the two surfaces do not weld → a horizontal
   T-junction crack.
4. **"Disappears up close" is now explained.** As the camera nears, the whole
   column promotes to Lod0; both chunks then mesh with identical SDF and weld;
   the crack closes. The old doc could not explain the distance dependence only
   because it wrongly assumed uniform Lod0.

### Why a *vertical* Lod0/Lod1 boundary even exists

Terrain LOD is **XZ-distance-based** (`terrain_lod_distance_xz`). A chunk and
the chunk directly above/below it share the same XZ distance, so in steady
state a whole vertical column holds **one** LOD — there should be no vertical
LOD boundary at all.

A vertical Lod0/Lod1 boundary therefore arises **transiently**: the LOD update
is rate-limited (`MAX_LOD_CHANGES_PER_UPDATE`) and camera-movement-gated, so
during a transition one chunk in a column flips while the chunk above it has
not yet drained from the backlog. This matches the observed behaviour exactly —
cracks **churn while moving** (backlog constantly refilled) and **settle when
stationary / up close** (backlog drains, column becomes uniform).

The horizontal X/Z Lod0↔Lod1 boundaries (the normal LOD ring between columns)
**are** SDF-matched by the transition loop and additionally get a vertical
skirt curtain — that is the handled case. The screenshot's notch-shaped cracks
*may* be imperfect X/Z matches, but the dominant horizontal band is the
unhandled Y boundary.

### Why the existing mitigation is insufficient

The only thing covering a Y boundary is the **apron skirt**
([skirt.rs:375](../../src/voxel/skirt.rs#L375)): for `NegY`/`PosY` edges it
extrudes a flap along ±Y bounded to `clamp(VOXEL, VOXEL*3)` — at most 3 voxels.
A Lod0/Lod1 surface step on a steep slope can exceed that, so the apron only
partially backs the gap. It also fires only when `neighbor_lods` carries a
valid lower-detail Y neighbour at mesh time, which a mid-transition column may
not yet have.

---

## Confidence and what is still unconfirmed

This is a **strong hypothesis, not an empirically nailed root cause.** It rests
on the Alt+B screenshot plus code reading; the game was not run and no crack
voxel was probed. Before patching, confirm with the **terrain hole probe**
already in the codebase:

- Aim the crosshair at a crack, press **Shift+F9**
  ([hole_probe.rs:337](../../src/voxel/hole_probe.rs#L337)). It writes
  `debug/terrain-hole-probe-*.json` containing, for the 3×3×3 chunk
  neighbourhood: each chunk's `lod_level`, `neighbor_lods_at_mesh`,
  `missing_boundary_neighbors_at_mesh`, `mesh_surface_mismatch`, and
  `vertical_chunk_boundary_surface`.
- Confirm a crack voxel sits between a Lod0 chunk and a Lod1 chunk stacked on
  the Y axis, and that `mesh_surface_mismatch` is set.

If the probe instead shows the crack on an X/Z Lod0/Lod1 pair, pivot to
auditing the X/Z transition match (`coarse_aligned_lod_sample_base` alignment
between the fine chunk's outermost padding plane and the coarse neighbour's
boundary plane).

---

## Candidate fixes (ranked — do not implement before Shift+F9 confirms)

1. **Eliminate the vertical LOD mismatch at its source.** Since terrain LOD is
   per-column (XZ), a column should never split across LOD levels. Make the LOD
   update apply per *column* atomically — exempt same-column chunks from the
   per-chunk `MAX_LOD_CHANGES_PER_UPDATE` budget, or commit a column's LOD
   change all-or-nothing. This removes the transient vertical boundary entirely
   and is the cleanest match for the existing XZ-distance LOD model. Preferred.
2. **SDF-match vertical transitions too.** Extend
   `lower_detail_transition_step_for_padded_size` to handle `NegY`/`PosY`. But
   the test at meshing.rs:3702 shows this was *intentionally* excluded — find
   out why (likely an earlier artifact) before reversing it.
3. **Strengthen the apron** (raise the `VOXEL*3` clamp, scale with the LOD step
   difference). A cover-up, not a cure; only worth it if 1 and 2 are blocked.

---

## Patches from the prior session — honest status (unchanged)

| # | Patch | File(s) | Status |
| --- | --- | --- | --- |
| 1 | Vertical skirt apron for Y-face LOD boundaries | `skirt.rs` | **On-target after all** — the prior session built this, then wrongly concluded the crack was not a LOD boundary and demoted it. It is the right area; it is just too small/conditional (see "mitigation insufficient"). Unverified visually. |
| 2 | `Alt+0` force-Lod0 toggle | `interaction/debug.rs` | Diagnostic. Direct-sets every chunk to Lod0 with snapshot/restore; recomputes if the camera moves. |
| 3a | `Alt+B` chunk-border overlay + LOD histogram | `interaction/debug.rs` | Diagnostic. **This overlay produced the corrected finding** once read properly. |
| 3b | LOD coherence pass + `MAX_LOD_CHANGES_PER_UPDATE` 4→32 | `plugin.rs` | Targets LOD island scatter. The 4→32 bump *reduces* transition backlog and so should reduce vertical-mismatch crack churn — partially relevant to the real bug, not a full fix. |
| 4 | NAADF debug overlay recoloured to a cool palette | `rendering/naadf/debug.rs` | Cleanup; avoids overlay confusion. |

---

## Hypotheses still genuinely ruled out

| Hypothesis | Why |
| --- | --- |
| NAADF renderer bug | Cracks are on the legacy mesh renderer; NAADF was off. |
| NAADF "single-chunk" trace | False claim; `trace_naadf_world` is multi-chunk. Irrelevant. |
| Ray-distance / step-budget cutoff | Legacy cull distance (320) exceeds the visible range. |
| Re-mesh staleness | `set_lod_level` dirties the chunk and the 26-neighbour halo. |

**No longer ruled out (corrected this revision):** "LOD-boundary artifact" and
"Y-boundary T-junction" — see *Corrected root-cause hypothesis*.

---

## Diagnostics available (keys)

- **Shift+F9** — terrain hole probe; dumps `debug/terrain-hole-probe-*.json`
  with per-chunk LOD, neighbour LODs, and surface-mismatch flags. **Use this to
  confirm the hypothesis.**
- **Alt+B** — chunk-border overlay, box per terrain chunk coloured by LOD
  (Lod0 green, Lod1 yellow, Lod2 orange, Lod3 red, Culled grey); logs the LOD
  histogram on enable.
- **Alt+0** — force every loaded chunk to Lod0 (snapshot + restore). Run it
  stationary. If the cracks vanish under Alt+0, that is direct confirmation
  they are a LOD-boundary artifact.

---

## Secondary finding — LOD distribution

Histogram this session: `Lod0=2609 Lod1=79 Lod2=0 Lod3=0` (non-empty chunks).
**0 Lod2 / 0 Lod3** across the loaded region — either the region is entirely
within the Lod1 band, or stepping never drives chunks past Lod1. Worth a
glance, but it is not the crack and is lower priority than the Shift+F9
confirmation above.

---

## Open threads for the next conversation (ranked)

1. **Confirm the corrected hypothesis with Shift+F9** on a crack voxel — verify
   a Lod0/Lod1 pair stacked on Y and `mesh_surface_mismatch` set.
2. **Implement candidate fix 1** (per-column atomic LOD update) once confirmed.
3. Visually verify the apron skirt and coherence pass on the LOD bench
   (`visual-regression-naadf-live-lod.toml`); per `CLAUDE.md`, capture
   before/after `summary.json` for any perf-affecting change.
4. Decide whether "0 Lod2/Lod3" is correct or a stepping starvation bug.

## Related docs

- `docs/lod/lod-visual-artifact-fixes.md` — older planning doc; Issues 1/3/4
  already implemented. Stale; update or archive.
