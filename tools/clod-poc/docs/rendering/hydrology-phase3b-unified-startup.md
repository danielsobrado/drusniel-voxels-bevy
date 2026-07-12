# Hydrology Phase 3b: unified startup authority

Infinite-islands now uses the traced/tile hydrology field inside and outside the startup world.

## Ownership

- `HydrologySystem.sample()` routes every infinite-islands world coordinate through the tile cache or the identical analytic fallback.
- The startup `HydrologyGrid` is a raster view for water and vegetation GPU textures only.
- Terrain geometry remains owned by the procedural terrain field. Unified mode does not install or serialize a hydrology carved-bed override.
- Startup CLOD pages, streamed roots, live chunks, colliders, and worker builds therefore share the same terrain source.
- The hydrology tile worker disables legacy fake-body terrain carving in unified mode so worker and synchronous tiles remain bit-identical.

## Compatibility

`hydrology.infinite.unified_startup` enables the mode. Finite scenes and tests may keep it disabled; the legacy finite-grid simulation and boundary blend remain available.

## Cache identity

Terrain-source version `world-modes-v4` includes the unified startup authority flag. Enabling this mode invalidates legacy page caches that were built from the serialized finite hydrology carve.

## Validation

`hydrology_unified_startup.test.ts` locks:

- tile-authority parity inside the startup world;
- identical authority immediately inside, on, and outside the old boundary;
- startup raster parity at grid vertices;
- no hydrology terrain carve in unified mode;
- continued availability of legacy mode.

`water:seam` reports `unifiedStartup` and treats its raw seam metrics as raster approximation error when the unified authority is active.
