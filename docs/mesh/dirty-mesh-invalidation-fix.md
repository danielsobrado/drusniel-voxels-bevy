# Terrain Mesh Dirty Invalidation — Issue and Fix

Document status: 2026-06-03. Describes the invalidation blast-radius bug, the surgical fix, and follow-up changes.

Related: [`dirty-mesh-review.md`](dirty-mesh-review.md) (full pipeline review), implementation in [`src/voxel/mesh_invalidation.rs`](../../src/voxel/mesh_invalidation.rs).

---

## Summary

The **dirty mesh scheduler** (`mesh_dirty_chunks_system`) is not the bottleneck. It correctly marks, queues, prioritizes by camera distance, and throttles mesh work per frame.

The performance problem was **how many chunks were marked dirty** after a small voxel change — the **invalidation blast radius**.

---

## The issue

### What should happen

Surface Nets meshing uses a **1-voxel padded halo** around each 16³ chunk. When one voxel changes, only chunks whose padded halo can sample that voxel need a remesh:

- Always the **edited chunk**.
- **Neighbor chunks** only when the edit lies in the halo band on **every axis** the neighbor offset moves along (face, edge, or corner contact — not unrelated diagonals).

Example: edit at local `(15, 8, 8)` → remesh center + `+X` face neighbor only (2 chunks).

Example: edit at corner `(0, 0, 0)` → remesh center + 3 face + 3 edge + 1 corner neighbor (**8 chunks**), not 27.

### What went wrong (OR across axes)

`VoxelWorld::apply_voxel_edit` used a 3×3×3 loop with **OR** conditions:

```rust
// BUG: any matching axis was enough
(dx < 0 && local.x <= 1)
    || (dy < 0 && local.y <= 1)
    || (dz < 0 && local.z <= 1)
    // ...
```

At a **positive corner** `(15, 15, 15)`, offset `(1, 0, -1)` matched `+X` and `+Y` but not `-Z`, yet was still marked dirty.

**Worst case:** center + up to **26 neighbors = 27 full remeshes** for one voxel. With `MAX_DIRTY_CHUNKS_VISITED_PER_FRAME` and mesh-per-frame caps, corner edits could drain the queue over many seconds (visible terrain pop-in).

### Secondary waste

1. **Generation halo** — `mark_chunk_halo_dirty` marked all **26** neighbors on every async chunk insert, even though only **face-shared** halos are required for a newly loaded chunk (same pattern as LOD face halo).
2. **Duplicate marking** — `mark_neighbors_dirty` after `set_voxel` in terrain tools and prop spawner duplicated work already done inside `apply_voxel_edit`.

`apply_edit_and_mark` in player editing did **not** call `mark_neighbors_dirty` (only `set_voxel_with_rules`); duplication was elsewhere.

---

## The solution

### 1. Surgical edit invalidation (`mesh_invalidation.rs`)

New module with **AND** semantics:

```rust
touches_axis(local.x, offset.x)
    && touches_axis(local.y, offset.y)
    && touches_axis(local.z, offset.z)
```

| Edit location | Chunks invalidated (incl. center) |
|---------------|-------------------------------------|
| Interior | 1 |
| Face | 2 |
| Edge | 4 |
| Corner | 8 |
| Old OR corner | Up to **27** |

Wired into:

- `VoxelWorld::apply_voxel_edit`
- `interaction::mark_neighbors_dirty` (for callers that only mark without `set_voxel`)

### 2. Generation: six face neighbors only

`mark_surface_nets_halo_dirty` now calls `VoxelWorld::mark_generation_face_neighbors_dirty`, marking only the **6 face-adjacent** chunk offsets (aligned with `mark_chunk_lod_halo_dirty`).

**Tradeoff:** diagonal neighbors are not dirtied when a chunk appears. They may already defer meshing until face neighbors exist (`count_missing_in_bounds_boundary_neighbors`). If seam issues appear at chunk corners during fast streaming, consider edge/corner invalidation only where the new chunk has boundary surface (future tightening).

### 3. Remove duplicate `mark_neighbors_dirty`

Removed post-`set_voxel` calls in:

- `src/terrain/tools/apply.rs`
- `src/props/spawner.rs`

`set_voxel` → `apply_voxel_edit` already propagates `TerrainMutation` surgically.

### 4. Queue monitoring

`mesh_dirty_chunks_system` logs a **warning** when `dirty_chunks_queued >= 96` after world generation completes. Bench runs already record `Mesh Dirty Chunks Queued` in `summary.json`.

---

## Verification

Unit tests:

- `mesh_invalidation::*` — AND semantics, corner vs unrelated diagonal
- `voxel_edit_corner_does_not_mark_unrelated_diagonal_neighbor` — integration
- `generated_chunk_marks_face_neighbors_dirty` — 6 neighbors, not 26

Suggested manual check:

```bash
rtk cargo test --lib -- mesh_invalidation::
rtk cargo test --lib -- voxel_edit_corner generated_chunk_marks_face
```

For gameplay, enable timing and watch queue depth after corner digs:

```bash
VOXEL_RENDER_TIMING=1 rtk cargo run --release
```

Compare `Mesh Dirty Chunks Queued` before/after on the same edit pattern.

---

## Files changed

| File | Change |
|------|--------|
| `src/voxel/mesh_invalidation.rs` | New surgical + face-offset helpers |
| `src/voxel/world.rs` | `apply_voxel_edit` uses surgical offsets; `mark_generation_face_neighbors_dirty` |
| `src/voxel/plugin.rs` | Generation halo → 6 face; queue warn; removed 26-loop |
| `src/interaction/editing.rs` | `mark_neighbors_dirty` uses surgical helper |
| `src/terrain/tools/apply.rs` | Drop duplicate marking |
| `src/props/spawner.rs` | Drop duplicate marking |

---

## Mental model (unchanged)

```
edit / load → mark_dirty (reason bitmask) → dirty_chunks HashSet
    → mesh_dirty_chunks_system (sort, throttle, generate, clear_dirty)
```

Only the **mark** step became surgical; the consumer pipeline is the same.
