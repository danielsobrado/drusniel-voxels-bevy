# Construction & Biome Systems — Known Limitations

Document status (2026-06-14): current. Captures the intentional v1 trade-offs in
the structural-integrity (construction) and content-driven biome milestones, so
they are not mistaken for bugs. Each entry lists why it exists, the impact, and a
concrete upgrade path.

Relevant code:
- Stability: `src/gameplay/building/stability.rs`
- Placement / ghost: `src/gameplay/building/ghost.rs`
- Building grid: `src/gameplay/building/grid.rs`
- Biome table: `src/voxel/terrain/biome.rs`
- Content validation: `src/content/validate.rs`

---

## 1. Structural graph follows snap topology, not physical adjacency

**Summary.** A placed piece is only linked into the structural graph through the
single snap it was placed against. On placement, `place_building_piece` calls
`grid.connect(entity, snap.target_snap.entity)` exactly once
(`src/gameplay/building/ghost.rs`), so a piece that physically touches several
existing pieces still registers only one structural neighbor.

**Why it exists.** Structural connections are defined as *successful snap
connections* (see the `connections` field doc in `src/gameplay/building/grid.rs`).
This keeps placement cheap and deterministic and avoids a physical-overlap query
on every placement. The stability tests encode this behavior intentionally.

**Impact.** Support propagates through a placement-order tree rather than the full
contact mesh, so structures are more fragile than their real geometry implies:
- Removing an interior piece can drop a branch that is still physically adjacent
  to other supported pieces.
- 2D floor grids (where a tile is supported by multiple neighbors) are
  under-connected compared to Valheim, which links every touching piece.

This only affects the *stability* graph; snapping, rendering, and collision are
unaffected.

**Upgrade path.** At placement, additionally `connect()` to occupied neighbor
cells discovered from the `BuildingGrid` (and/or a small AABB overlap test),
not just the snap target. Re-mark the affected island dirty so the next
`recompute_dirty_stability` pass re-solves with the richer graph. This is purely
additive to the connection set and does not change the solver.

---

## 2. Unsupported pieces are placed and then collapse (no placement gate)

**Summary.** `validate_placement` checks occupancy, protected areas, and terrain
contact, but **not** predicted stability. An unsupported, non-grounded piece is
therefore placed and then collapses on a subsequent stability pass.

**Why it exists.** Validity (can this occupy the cell?) and stability (will it
stay up?) are deliberately separate concerns. The ghost already surfaces the
prediction: `update_building_ghost` tints the preview by predicted support and
shows red below the collapse threshold (`stability_color` /
`ghost_material_handle` in `src/gameplay/building/ghost.rs`), so the player sees
the instability before committing.

**Impact.** Placing a clearly unstable piece looks like "place, then immediately
fall" rather than being blocked at the cursor. With the event-driven pipeline the
collapse can land on the same frame, which can read as "the click did nothing."

**Upgrade path.** If a blocking feel is preferred, gate validity on the predicted
value, e.g. reject when `predicted.value < collapse_threshold` for non-grounded
candidates. Keep it as a config toggle so the build-then-collapse behavior remains
available.

---

## 3. Biome material bands are validated at table-build time, not by the content validator

**Summary.** `src/content/validate.rs` checks biome `legacy_biome_id` range and
uniqueness and that referenced materials resolve, but does **not** pre-check that
`surface_material_ids` / `underground_material_ids` (and their shoreline variants)
are non-empty or within `BIOME_DEPTH_BANDS`. Those constraints are enforced when
`BiomeTable::from_content_registry` builds the depth bands
(`src/voxel/terrain/biome.rs`).

**Why it exists.** The depth-band shape is a concern of the terrain table, not the
generic content schema, so the checks live next to where the bands are built.

**Impact.** A malformed biome (empty band list, or more underground entries than
`BIOME_DEPTH_BANDS - 1`) is reported as a `BiomeTable` build error rather than a
normal content-validation issue. As of the consistency fix in
`src/content/plugin.rs`, this no longer crashes the game: in strict mode it
panics, and in non-strict mode it logs the error and falls back to
`BiomeTable::default()` — the same graceful pattern used for `MaterialCatalog` and
`AtlasMapping`.

**Upgrade path.** Mirror the band constraints as explicit rules in
`validate_content_registry` (non-empty surface/underground bands, length within
`BIOME_DEPTH_BANDS`) so authors get a single, uniform validation report instead of
a separate build-time error.

---

## Out of scope for these milestones (tracked elsewhere)

- **Structural mass/load and breakage tuning beyond support decay** — current model
  is support-distance only; no per-piece weight or directional load.
- **Biome *selection* from data** — selection thresholds still live in
  `src/shared/constants.rs`; only the material bands are data-driven so far. This
  is the planned Phase 2 of the biome milestone.
- **Prop palettes and ambient/weather per biome** — `prop_palette_ids` is carried
  in `BiomeContent` but not yet consumed.
