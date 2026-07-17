# CLOD construction Phase 4 — transactional terrain integration

Phase 4 makes foundation terrain conformance part of the construction transaction instead of a delayed side effect.

## Runtime contract

- Only pieces listed in `terrain_conform.foundation_categories` may modify terrain. The default is `foundation` only.
- Preview samples a 3x3 footprint against authoritative editable-terrain colliders.
- Every sample must be edit-ready and outside protected regions when a protected-region hook is installed.
- Preview reports estimated fill/cut volume and rejects footprints exceeding configured fill or trim depth.
- Fill and cut are rasterized into one composite voxel transaction and trigger one near-field/CLOD rebuild path.
- Terrain commits before the piece. If piece insertion fails, the terrain transaction is compensated.
- `Ctrl+Z` removes the last placed piece and applies a forward inverse terrain transaction. If terrain changed inside that footprint afterwards, undo fails closed and restores the piece.
- Manual deletion and structural collapse do not undo terrain; they explicitly discard the placement undo receipt.

## Authority and cache ownership

Voxel terrain remains authoritative. CLOD pages, streamed roots, near-field meshes, colliders, vegetation and selection data are derived caches invalidated by the existing terrain dirty-event path. A stale page stays visible until its replacement is ready.

## Acceptance coverage

- Request generation uses the rotated placement proxy bounds and excludes snapped/non-foundation pieces.
- Nine footprint samples drive volume estimates and depth rejection.
- Fill and trim produce one voxel transaction.
- Terrain failure prevents piece insertion.
- Piece insertion failure compensates terrain.
- Undo restores the piece if terrain rollback cannot be safely applied.
